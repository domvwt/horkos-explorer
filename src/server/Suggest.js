const express = require("express");
const router = express.Router();
const duckdb = require("./utils/DuckDB");
const logger = require("./utils/Logger");

const ENTITY_TYPES = {
  Company: {
    table: "company_names",
    disambiguators: ["company_number", "status"],
  },
  Person: {
    table: "person_names",
    disambiguators: ["birth_date", "nationality", "record_count"],
  },
  Address: {
    table: "address_names",
    disambiguators: ["post_code", "city"],
  },
};

// Columns the graph build (TASK-093) adds to the search tables. Older
// DuckDB files without them degrade to name-only suggestions.
const CONTRACT_COLUMNS = ["doc_id", "cluster_id", "canonical_name"];

// True when a query was shed by the DuckDB pool's admission gate (pool + queue
// full). The route maps this to 503 + Retry-After so the client backs off,
// distinct from a genuine query failure (500). Never echo the internal message.
function isShedError(err) {
  return err && (err.status === 503 || err.name === "LoadShedError");
}

// Emit the standard 503 shed response. Retry-After: 1 tells the client the
// backpressure is short-lived (a busy pool frees within seconds).
function sendShed(res) {
  res.set("Retry-After", "1");
  return res.status(503).json({ error: "Search is busy, please retry shortly" });
}

/**
 * Hybrid ranked query: BM25 full-text score from the table's FTS index,
 * unioned with LIKE-prefix matches so partially-typed tokens still hit
 * ("john smi" -> "John Smith"). Prefix matches rank first (existing
 * autocomplete UX), then BM25 score. One row per cluster: the
 * best-ranked name variant represents the cluster, but distinct clusters
 * sharing a name are never collapsed - disambiguators tell them apart.
 * Tiebreaks are deterministic (LENGTH(name), name, cluster_id).
 *
 * BM25 scores are only comparable within one table, so queries are
 * strictly per-type.
 *
 * `conjunctive := 1` requires every query term to appear in a document
 * for it to score (AND semantics). This matches the "all typed words
 * must be present" intent of multi-token autocomplete and is materially
 * cheaper than the default disjunctive scan, because far fewer documents
 * survive the term intersection. This match_bm25 scan is the ~0.6-1.7s
 * national-scale cost that the /api/suggest staging (stage=fast vs
 * stage=rank) keeps out of the keystroke path.
 */
function buildRankedSql(config) {
  const disambiguatorCols = config.disambiguators.join(", ");
  return `
    WITH scored AS (
      SELECT s.*,
             fts_search_${config.table}.match_bm25(doc_id, ?, conjunctive := 1) AS fts_score,
             (s.name_normalized LIKE ? OR s.name_normalized LIKE ?) AS prefix_match
      FROM search.${config.table} s
    )
    SELECT cluster_id, name, canonical_name, ${disambiguatorCols},
           COALESCE(fts_score, 0) AS score, prefix_match
    FROM scored
    WHERE fts_score IS NOT NULL OR prefix_match
    QUALIFY row_number() OVER (
      PARTITION BY cluster_id
      ORDER BY prefix_match DESC, COALESCE(fts_score, 0) DESC, LENGTH(name), name
    ) = 1
    ORDER BY prefix_match DESC, score DESC, LENGTH(name), name, cluster_id
    LIMIT ?
  `;
}

/**
 * LIKE-only fallback for files whose search tables carry the contract
 * columns but no usable FTS index (extension failed to load, or index
 * schemas absent). Same response shape as the ranked query, score 0.
 *
 * This cheap prefix/word-boundary scan (~30ms) is also the `stage=fast`
 * path: /api/suggest serves it immediately so typing is never blocked on
 * match_bm25, with the ranked query following as an asynchronous upgrade.
 */
function buildLikeSql(config) {
  const disambiguatorCols = config.disambiguators.join(", ");
  return `
    WITH matched AS (
      SELECT s.*, (s.name_normalized LIKE ?) AS prefix_start
      FROM search.${config.table} s
      WHERE s.name_normalized LIKE ? OR s.name_normalized LIKE ?
    )
    SELECT cluster_id, name, canonical_name, ${disambiguatorCols},
           0.0 AS score, prefix_start
    FROM matched
    QUALIFY row_number() OVER (
      PARTITION BY cluster_id
      ORDER BY prefix_start DESC, LENGTH(name), name
    ) = 1
    ORDER BY prefix_start DESC, LENGTH(name), name, cluster_id
    LIMIT ?
  `;
}

/**
 * Legacy fallback for pre-TASK-093 search tables (name/name_normalized
 * only, no cluster ids).
 */
function buildLegacySql(config) {
  return `
    SELECT name
    FROM search.${config.table}
    WHERE name_normalized LIKE ? OR name_normalized LIKE ?
    ORDER BY
      CASE WHEN name_normalized LIKE ? THEN 0 ELSE 1 END,
      LENGTH(name),
      name_normalized
    LIMIT ?
  `;
}

function toSuggestion(row, config) {
  const disambiguators = {};
  for (const col of config.disambiguators) {
    const value = row[col];
    if (value === null || value === undefined) continue;
    // DuckDB returns BIGINT columns (e.g. record_count) as JS bigint and DECIMAL
    // as a wrapper object, neither of which JSON.stringify accepts. Coerce those
    // numeric wire-types to a plain number, but leave string disambiguators
    // (birth_date, nationality, …) untouched — Number("British") would be NaN.
    disambiguators[col] =
      typeof value === "bigint" || isDuckDbNumericWrapper(value)
        ? Number(value)
        : value;
  }
  return {
    name: row.name,
    cluster_id: row.cluster_id,
    canonical_name: row.canonical_name,
    disambiguators,
    // The LIKE/fast path selects `0.0 AS score`, which @duckdb/node-api returns
    // as a DuckDBDecimalValue wrapper object backed by a bigint (the ranked path
    // returns a plain DOUBLE number). JSON.stringify walks into the wrapper,
    // hits the bigint and throws "Do not know how to serialize a BigInt",
    // failing the whole response. Coerce to a plain JS number: a number passes
    // through unchanged, the decimal wrapper resolves to its numeric value.
    score: coerceNumber(row.score),
  };
}

/**
 * Coerce a DuckDB numeric cell to a plain JS number for JSON serialization.
 * @duckdb/node-api returns BIGINT as JS bigint and DECIMAL as a
 * DuckDBDecimalValue wrapper (backed by a bigint) — neither is JSON-serializable
 * as-is. Number() unwraps both via their numeric valueOf/toString; a value that
 * is already a number is returned unchanged. null/undefined pass through.
 */
function coerceNumber(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return value;
  return Number(value);
}

/**
 * True for the wrapper objects @duckdb/node-api uses to represent exact numeric
 * types (DECIMAL, and the wide-integer HUGEINT/UBIGINT family). These carry a
 * bigint internally, so they must be unwrapped to a plain number before JSON
 * serialization. Matched by constructor name so genuine strings/dates are left
 * alone. A plain number/bigint is NOT a wrapper (callers test those first).
 */
function isDuckDbNumericWrapper(value) {
  if (value === null || typeof value !== "object") return false;
  const name = value.constructor && value.constructor.name;
  return (
    name === "DuckDBDecimalValue" ||
    name === "DuckDBHugeIntValue" ||
    name === "DuckDBUHugeIntValue"
  );
}

/**
 * GET /api/suggest
 *
 * Ranked autocomplete endpoint for entity names.
 *
 * Hybrid search over the DuckDB search tables: BM25 full-text ranking
 * (multi-token, roughly-remembered-name lookups) combined with
 * LIKE-prefix matching (typing "smi" finds "Smith"). Degrades to
 * LIKE-only when the FTS extension or index schemas are unavailable,
 * and to name-only suggestions on pre-contract DuckDB files.
 *
 * Staged responsiveness: the match_bm25 scan is ~0.6-1.7s at national
 * scale, so the client stages it out of the keystroke path via the
 * `stage` parameter:
 *   - stage=fast : cheap LIKE-prefix/word query only (~30ms) so typing is
 *                  never blocked on BM25. Served immediately.
 *   - stage=rank : the full BM25-ranked query, fired as an asynchronous
 *                  upgrade and merged into the dropdown when it arrives.
 *   - (absent)   : today's capability-driven behaviour (ranked when FTS is
 *                  available, else LIKE, else legacy) - preserved for
 *                  back-compat and the legacy pre-contract path.
 * A stage=rank failure is isolated: it does NOT flip the process-wide FTS
 * capability flag, so one slow/timed-out upgrade cannot disable ranking
 * for every user for the process lifetime.
 *
 * Query Parameters:
 *   - q: Search query (required, min 2 characters)
 *   - type: Entity type - "Company" | "Person" | "Address" (required)
 *   - limit: Maximum results to return (default: 10, max: 50)
 *   - stage: "fast" | "rank" (optional; omit for capability-driven behaviour)
 *
 * Returns:
 *   - 200: Array of suggestion objects:
 *          { name, cluster_id, canonical_name, disambiguators, score }
 *          cluster_id/canonical_name are null on legacy search tables.
 *   - 400: Invalid parameters
 *   - 404: Search not available (no DuckDB file or no search tables)
 *   - 500: Query error
 */
async function handleSuggest(req, res) {
  if (!duckdb.isEnabled()) {
    return res.status(404).json({ error: "Search not available" });
  }

  const query = req.query.q?.trim();
  if (!query || query.length < 2) {
    return res.status(400).json({ error: "Query too short (min 2 characters)" });
  }

  const config = ENTITY_TYPES[req.query.type];
  if (!config) {
    return res.status(400).json({
      error: "Invalid entity type",
      valid: Object.keys(ENTITY_TYPES),
    });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

  const stage = req.query.stage;
  if (stage !== undefined && stage !== "fast" && stage !== "rank") {
    return res.status(400).json({
      error: "Invalid stage",
      valid: ["fast", "rank"],
    });
  }

  const capabilities = await duckdb.getCapabilities();
  const tableCaps = capabilities.tables[config.table];
  if (!tableCaps) {
    return res.status(404).json({ error: "Search not available" });
  }

  // Normalize query to match name_normalized column (lowercase alphanumeric
  // only). This also strips LIKE wildcards (% and _) from the patterns.
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (!normalizedQuery) {
    return res.json([]);
  }
  const startPattern = `${normalizedQuery}%`;
  const wordPattern = `% ${normalizedQuery}%`;

  const hasContractColumns = CONTRACT_COLUMNS.every((c) => tableCaps.columns.has(c));

  // stage=rank: BM25 upgrade only. Requires the contract columns and a
  // usable FTS index; otherwise there is no ranked query to run, so the
  // client's fast stage already carries the best result and we return an
  // empty upgrade rather than re-running LIKE. Failures here are isolated:
  // a rank-stage error/timeout must NOT flip the process-wide FTS flag
  // (unlike the non-staged path below), because rapid typing can time a
  // single upgrade out without FTS being genuinely broken.
  if (stage === "rank") {
    if (!(hasContractColumns && tableCaps.fts)) {
      return res.json([]);
    }
    try {
      const rows = await duckdb.query(
        buildRankedSql(config), query, startPattern, wordPattern, limit
      );
      return res.json(rows.map((r) => toSuggestion(r, config)));
    } catch (err) {
      if (isShedError(err)) {
        return sendShed(res);
      }
      logger.error(`Ranked suggest upgrade failed (${err.message}) - keeping fast results`);
      return res.status(500).json({ error: "Search failed" });
    }
  }

  // stage=fast: cheap LIKE-only path so typing is never blocked on BM25.
  // Falls through to legacy for pre-contract tables that have no cluster ids.
  if (stage === "fast" && hasContractColumns) {
    try {
      const rows = await duckdb.query(
        buildLikeSql(config), startPattern, startPattern, wordPattern, limit
      );
      return res.json(rows.map((r) => toSuggestion(r, config)));
    } catch (err) {
      if (isShedError(err)) {
        return sendShed(res);
      }
      logger.error(`Fast suggest query failed: ${err.message}`);
      return res.status(500).json({ error: "Search failed" });
    }
  }

  // No stage (capability-driven default) or stage=fast on a legacy table.
  try {
    if (stage === undefined && hasContractColumns && tableCaps.fts) {
      try {
        const rows = await duckdb.query(
          buildRankedSql(config), query, startPattern, wordPattern, limit
        );
        return res.json(rows.map((r) => toSuggestion(r, config)));
      } catch (err) {
        // A shed error is transient backpressure, not a broken FTS index: do
        // not flip the process-wide FTS flag off, just tell the client to retry.
        if (isShedError(err)) {
          return sendShed(res);
        }
        // e.g. FTS index dropped/rebuilt out from under us - degrade for
        // the rest of this process lifetime rather than failing every call
        logger.error(`Ranked suggest query failed (${err.message}) - degrading to LIKE-only`);
        tableCaps.fts = false;
      }
    }

    if (hasContractColumns) {
      const rows = await duckdb.query(
        buildLikeSql(config), startPattern, startPattern, wordPattern, limit
      );
      return res.json(rows.map((r) => toSuggestion(r, config)));
    }

    const rows = await duckdb.query(
      buildLegacySql(config), startPattern, wordPattern, startPattern, limit
    );
    return res.json(rows.map((r) => ({
      name: r.name,
      cluster_id: null,
      canonical_name: null,
      disambiguators: {},
      score: 0,
    })));
  } catch (err) {
    if (isShedError(err)) {
      return sendShed(res);
    }
    logger.error(`Suggest query failed: ${err.message}`);
    return res.status(500).json({ error: "Search failed" });
  }
}

router.get("/", handleSuggest);

module.exports = router;
// Additive named exports for unit testing the staged builders and route
// logic without breaking the default router export above.
module.exports.handleSuggest = handleSuggest;
module.exports.buildRankedSql = buildRankedSql;
module.exports.buildLikeSql = buildLikeSql;
module.exports.buildLegacySql = buildLegacySql;
module.exports.toSuggestion = toSuggestion;
module.exports.ENTITY_TYPES = ENTITY_TYPES;
