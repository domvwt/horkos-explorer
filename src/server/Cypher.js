const express = require("express");
const router = express.Router();
const logger = require("./utils/Logger");
const MODES = require("./utils/Constants").MODES;
const database = require("./utils/Database");
const QueryValidator = require("./middleware/QueryValidator");
const rowBudget = require("./middleware/RowBudget");
const { sendErrorResponse } = require("./utils/errorResponse");
const { sanitizeQueryError } = require("./utils/QueryErrorSanitizer");
const uuid = require("uuid");
let sessionDb;
const queryMap = new Map();
// Hard cap on live progress entries. queryMap is keyed by client-supplied uuid
// for progress polling; without a bound a client could register unbounded
// distinct uuids (each progress query leaves an entry until its request
// finishes) and grow the map without limit. At capacity we skip registering
// NEW keys but still let in-flight queries update their existing entry, so a
// full map never starves a query already being tracked.
const MAX_QUERY_MAP_ENTRIES = 1000;
try {
  sessionDb = require("./utils/SessionDatabase");
} catch (err) {
  // SessionDatabase is optional (absent in stateless deployments); sessionDb stays undefined.
}

const DEMO_MODE = MODES.DEMO;

// Fail-closed default: if KUZU_QUERY_SIZE_LIMIT is unset or invalid, results are
// still hard-capped to a finite number of rows so a broad MATCH cannot stream the
// whole graph (exfiltration). Operators can raise the cap via the env var.
const DEFAULT_QUERY_SIZE_LIMIT = 10000;

const parsedQuerySizeLimit = parseInt(process.env.KUZU_QUERY_SIZE_LIMIT);
// Treat unset / non-numeric / zero / negative as invalid and fall back to the
// safe default, so the cap loop in processSingleResult always runs.
const querySizeLimit =
  !isNaN(parsedQuerySizeLimit) && parsedQuerySizeLimit > 0
    ? parsedQuerySizeLimit
    : DEFAULT_QUERY_SIZE_LIMIT;
if (querySizeLimit) {
  logger.info(`Query size limit: ${querySizeLimit}`);
}
let schema = null;

// `remaining` is the per-REQUEST row budget still available (see the statement
// loop below): the cap is shared across every statement in one request, not
// applied per statement, so N statements can no longer each ship querySizeLimit
// rows. A statement reads at most `remaining` rows; if that clips its result
// short of getNumTuples(), `truncated` is set so the UI can flag it (a fully
// budget-exhausted downstream statement reads 0 rows but still carries the flag
// when its result had tuples to give). Single-statement requests pass
// remaining === querySizeLimit, so their behaviour is unchanged by construction.
const processSingleResult = async (result, remaining) => {
  let rows;
  const resultSize = result.getNumTuples();
  // `!querySizeLimit` is the historical unset/unbounded guard, preserved
  // verbatim: read everything, ignore the request budget. Otherwise the row
  // cap for THIS statement is the smaller of the per-response limit and the
  // rows still left in the shared request budget (`remaining == null` means no
  // budget was threaded, i.e. the unbounded case, so fall back to the limit).
  const cap = remaining == null ? querySizeLimit : Math.min(querySizeLimit, remaining);
  if (!querySizeLimit || resultSize <= cap) {
    rows = await result.getAll();
  } else {
    rows = [];
    for (let i = 0; i < cap; ++i) {
      rows.push(await result.getNext());
    }
  }
  const columnTypes = await result.getColumnDataTypes();
  const columnNames = await result.getColumnNames();
  const dataTypes = {};
  columnNames.forEach((name, i) => {
    dataTypes[name] = columnTypes[i];
  });
  const body = { rows, dataTypes };
  // Only emit the indicator when the shipped rows are genuinely fewer than the
  // result held, so a non-truncated response stays byte-identical to before.
  if (resultSize > rows.length) {
    body.truncated = true;
  }
  return body;
};

// This is a workaround for the JSON stringify issue with BigInt values.
const int128Replacer = (_, value) => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
};

router.post("/", QueryValidator.middleware(database), async (req, res) => {
  const mode = database.getAccessModeString();
  if (!schema && mode === MODES.READ_WRITE) {
    try {
      schema = await database.getSchema();
    } catch (err) {
      return sendErrorResponse(res, err, {
        clientMessage: "Failed to load schema",
        logContext: "Cypher schema fetch failed",
      });
    }
  }
  // Validate the request synchronously BEFORE acquiring a connection. Every
  // early return below must run before getConnection() so a rejected request
  // never increments the admission-control counter (and the connection's use
  // count) without a matching release — otherwise repeated 400s would leak the
  // in-flight slot until the server permanently sheds all load.
  const query = req.body.query;
  if (!query || typeof query !== "string") {
    return res
      .status(400)
      .send({ error: "The query must be a string with length > 0" });
  }
  const isQueryCopy = query.trim().toUpperCase().startsWith("COPY");
  if (mode === DEMO_MODE && isQueryCopy) {
    return res
      .status(400)
      .send({ error: "COPY command is not allowed in demo mode" });
  }
  const params = req.body.params;
  if (params && typeof params !== "object") {
    return res.status(400).send({ error: "Params must be an object" });
  }
  // uuid is client-controlled and used as a Map key (progress tracking) and as
  // the history upsert key. Reject a non-string / non-UUID / over-long value
  // BEFORE getConnection() (a rejected request must never leak the admission
  // slot — see the note above). Only validate when uuid is actually provided:
  // a normal non-progress query legitimately omits it.
  const clientUuid = req.body.uuid;
  if (clientUuid !== undefined && clientUuid !== null) {
    if (typeof clientUuid !== "string" || !uuid.validate(clientUuid)) {
      return res.status(400).send({ error: "uuid must be a valid UUID" });
    }
  }
  // Per-IP row-budget pre-check (anti-bulk-scrape). The per-response size cap
  // bounds one response and the rate limiter bounds request COUNT, but neither
  // bounds the CUMULATIVE rows one IP can paginate out across requests. This
  // check is placed AFTER the synchronous validation early-returns and BEFORE
  // getConnection() so a rejected (429) request never touches the admission
  // counter / connection pool — preserving the same invariant as the 400 paths
  // above. Debit happens in the success path only (rows actually shipped).
  // Enforced for every mode except explicit READ_WRITE (fail closed).
  const budgetKey = rowBudget.keyForRequest(req);
  if (rowBudget.isEnforced(mode)) {
    const budgetCheck = rowBudget.check(budgetKey);
    if (!budgetCheck.allowed) {
      const retryAfterSeconds = Math.ceil(budgetCheck.retryAfterMs / 1000);
      logger.warn(`Row budget exceeded for IP: ${req.ip}`);
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "Row budget exceeded, please try again later.",
        code: "ROW_BUDGET_EXCEEDED",
        retryAfter: new Date(Date.now() + budgetCheck.retryAfterMs),
      });
    }
  }
  let conn;
  try {
    conn = database.getConnection();
  } catch (err) {
    // Admission control sheds load once too many queries are in flight. Map the
    // LoadShedError to its carried HTTP status (503) so the client can back off,
    // rather than letting it escape as an unhandled rejection (hangs the client).
    return sendErrorResponse(res, err, {
      status: err && err.status ? err.status : 503,
      clientMessage: "Server is at capacity, please retry shortly",
      logContext: "Cypher query admission control shed load",
    });
  }
  const progressCallback = (pipelineProgress, numPipelinesFinished, numPipelines) => {
    const key = req.body.uuid;
    // No client uuid -> nothing to poll against; never write an `undefined`
    // key (concurrent no-uuid queries would clobber a single junk slot). When
    // the map is at capacity, only allow updates to an already-tracked key.
    if (key == null) {
      return;
    }
    if (!queryMap.has(key) && queryMap.size >= MAX_QUERY_MAP_ENTRIES) {
      return;
    }
    queryMap.set(key, {
      pipelineProgress: pipelineProgress,
      numPipelinesFinished: numPipelinesFinished,
      numPipelines: numPipelines
    });
  }
  try {
    let result;
    if (!params || Object.keys(params).length === 0) {
      result = req.body.progress ? await conn.query(query, progressCallback) : await conn.query(query);
    } else {
      const preparedStatement = await conn.prepare(query);
      result = await conn.execute(preparedStatement, params);
    }
    let isSchemaChanged = false;
    if (mode === MODES.READ_WRITE) {
      const currentSchema = await database.getSchema();
      isSchemaChanged =
        JSON.stringify(schema) !== JSON.stringify(currentSchema);
      if (isSchemaChanged) {
        // A DDL statement changed the schema; drop any cached schema so the
        // next read recomputes it (no-op unless a schema is currently cached).
        database.invalidateSchemaCache();
      }
    }
    if (sessionDb && req.body.updateHistory) {
      try {
        await sessionDb.upsertHistoryItem({
          uuid: req.body.uuid,
          isQueryGenerationMode: Boolean(req.body.isQueryGenerationMode),
          cypherQuery: query,
        });
      } catch (err) {
        // Ignore the error. It fails to record the history, but the query is
        // still executed.
      }
    }
    // Per-REQUEST row budget: querySizeLimit is spent across ALL statements in
    // this request, not per statement, so a multi-statement batch can no longer
    // ship N x querySizeLimit rows. `null` preserves the legacy unbounded case
    // when querySizeLimit is falsy (unset). Single-statement requests get the
    // full budget, so they behave exactly as before.
    let remaining = querySizeLimit ? querySizeLimit : null;
    let responseBody;
    if (!Array.isArray(result)) {
      responseBody = await processSingleResult(result, remaining);
      result.close();
      responseBody.isSchemaChanged = isSchemaChanged;
      responseBody.isMultiStatement = false;
    } else {
      responseBody = {
        isSchemaChanged,
        isMultiStatement: true,
        results: [],
      };
      for (const singleResult of result) {
        const singleResultBody = await processSingleResult(singleResult, remaining);
        responseBody.results.push(singleResultBody);
        // Debit the shared budget by the rows this statement actually read, so
        // once it hits 0 every downstream statement reads nothing (but still
        // reports truncated when it had tuples to give).
        if (remaining != null) {
          remaining -= singleResultBody.rows.length;
        }
      }
      result.forEach((singleResult) => singleResult.close());
    }
    // Debit the per-IP row budget with the rows ACTUALLY shipped (post-cap),
    // not getNumTuples() — we account for what left the server. Only debit when
    // the budget is enforced (not READ_WRITE). This runs on the success path
    // only; an errored / timed-out query throws before here and debits nothing.
    if (rowBudget.isEnforced(mode)) {
      let shippedRows;
      if (responseBody.isMultiStatement) {
        shippedRows = responseBody.results.reduce(
          (sum, r) => sum + (r.rows ? r.rows.length : 0),
          0
        );
      } else {
        shippedRows = responseBody.rows ? responseBody.rows.length : 0;
      }
      rowBudget.debit(budgetKey, shippedRows);
    }
    responseBody = JSON.stringify(responseBody, int128Replacer);
    return res.send(responseBody);
  } catch (err) {
    // A query interrupted by the per-connection wall-clock timeout surfaces as a
    // Kuzu "interrupt" error. Classify it as 408 with a fixed body so the client
    // (PathFinder) can distinguish a timeout from a generic failure. The message
    // is a fixed string — the raw error text is never echoed (info-disclosure
    // policy), it is only inspected here. This runs on an errored path, so (like
    // every other error branch) the row budget is not debited.
    if (err && typeof err.message === "string" && /interrupt/i.test(err.message)) {
      logger.warn(`Cypher query timed out: ${err.message}`);
      return res.status(408).send({ error: "Query timed out" });
    }
    // Info-disclosure policy: by default the raw Kuzu error text is never echoed
    // to public clients — DB/filesystem/storage strings can leak internal detail
    // (file paths, buffer/memory internals). The ONE exception is feedback about
    // the user's OWN query text: a public user who mistypes Cypher needs to see
    // WHY it failed. QueryErrorSanitizer is an allowlist that relays ONLY Parser
    // and Binder exception classes (syntax errors, unknown variable/table/
    // property in the text the user typed), and only after redacting any
    // filesystem path and capping the length. Every other class (Runtime,
    // Conversion, Catalog, IO, Buffer manager, Storage, etc.) returns
    // { relay: false } and falls through to the generic message below. The full
    // error is always logged server-side regardless.
    const relay = err && sanitizeQueryError(err.message);
    if (relay && relay.relay) {
      logger.error(`Cypher query execution failed: ${err && err.message}`);
      return res.status(400).send({ error: relay.message });
    }
    // Not an allowlisted class (or not sanitizable): log the full detail
    // server-side and return the fixed generic message.
    return sendErrorResponse(res, err, {
      clientMessage: "Query execution failed",
      logContext: "Cypher query execution failed",
    });
  } finally {
    // Always drop the progress entry, on every path (success, error, or an
    // error after a progress tick). A progress query that emits a tick then
    // throws would otherwise leak its queryMap entry until restart. delete is
    // idempotent, so this is a no-op when no entry was ever set. Guard on the
    // progress flag so non-progress queries never touch the map.
    if (req.body.progress) {
      queryMap.delete(req.body.uuid);
    }
    database.releaseConnection(conn);
  }
});

router.get("/progress/:uuid", (req, res) => {
  let progress = queryMap.get(req.params.uuid);
  if (progress) {
    return res.send(progress);
  } else {
    return res.status(404).end();
  }
});

module.exports = router;
