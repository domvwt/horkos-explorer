const express = require("express");
const router = express.Router();
const logger = require("./utils/Logger");
const MODES = require("./utils/Constants").MODES;
const database = require("./utils/Database");
const QueryValidator = require("./middleware/QueryValidator");
const rowBudget = require("./middleware/RowBudget");
const { sendErrorResponse } = require("./utils/errorResponse");
const uuid = require("uuid");
let sessionDb;
const queryMap = new Map();
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

const processSingleResult = async (result) => {
  let rows;
  const resultSize = result.getNumTuples();
  if (!querySizeLimit || resultSize <= querySizeLimit) {
    rows = await result.getAll();
  } else {
    rows = [];
    for (let i = 0; i < querySizeLimit; ++i) {
      rows.push(await result.getNext());
    }
  }
  const columnTypes = await result.getColumnDataTypes();
  const columnNames = await result.getColumnNames();
  const dataTypes = {};
  columnNames.forEach((name, i) => {
    dataTypes[name] = columnTypes[i];
  });
  return { rows, dataTypes };
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
  if (!query || !typeof query === "string") {
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
  if (params && !typeof params === "object") {
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
    queryMap.set(req.body.uuid, {
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
    let responseBody;
    if (!Array.isArray(result)) {
      responseBody = await processSingleResult(result);
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
        const singleResultBody = await processSingleResult(singleResult);
        responseBody.results.push(singleResultBody);
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
    // Do not echo raw Kuzu/binder error text to public clients; log the full
    // detail server-side and return a generic message (info-disclosure policy).
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
