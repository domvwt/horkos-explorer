const express = require("express");
const router = express.Router();
const logger = require("./utils/Logger");
const MODES = require("./utils/Constants").MODES;
const database = require("./utils/Database");
const QueryValidator = require("./middleware/QueryValidator");
const { sendErrorResponse } = require("./utils/errorResponse");
let sessionDb;
const queryMap = new Map();
try {
  sessionDb = require("./utils/SessionDatabase");
} catch (err) { }

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
  const conn = database.getConnection();
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
      if (req.body.progress) {
        queryMap.delete(req.body.uuid);
      }
    } else {
      const preparedStatement = await conn.prepare(query);
      result = await conn.execute(preparedStatement, params);
    }
    let isSchemaChanged = false;
    if (mode === MODES.READ_WRITE) {
      const currentSchema = await database.getSchema();
      isSchemaChanged =
        JSON.stringify(schema) !== JSON.stringify(currentSchema);
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
