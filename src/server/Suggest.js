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
 */
function buildRankedSql(config) {
  const disambiguatorCols = config.disambiguators.join(", ");
  return `
    WITH scored AS (
      SELECT s.*,
             fts_search_${config.table}.match_bm25(doc_id, ?) AS fts_score,
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
    // DuckDB returns BIGINT columns (e.g. record_count) as JS bigint,
    // which JSON.stringify rejects
    disambiguators[col] = typeof value === "bigint" ? Number(value) : value;
  }
  return {
    name: row.name,
    cluster_id: row.cluster_id,
    canonical_name: row.canonical_name,
    disambiguators,
    score: row.score,
  };
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
 * Query Parameters:
 *   - q: Search query (required, min 2 characters)
 *   - type: Entity type - "Company" | "Person" | "Address" (required)
 *   - limit: Maximum results to return (default: 10, max: 50)
 *
 * Returns:
 *   - 200: Array of suggestion objects:
 *          { name, cluster_id, canonical_name, disambiguators, score }
 *          cluster_id/canonical_name are null on legacy search tables.
 *   - 400: Invalid parameters
 *   - 404: Search not available (no DuckDB file or no search tables)
 *   - 500: Query error
 */
router.get("/", async (req, res) => {
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

  try {
    if (hasContractColumns && tableCaps.fts) {
      try {
        const rows = await duckdb.query(
          buildRankedSql(config), query, startPattern, wordPattern, limit
        );
        return res.json(rows.map((r) => toSuggestion(r, config)));
      } catch (err) {
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
    logger.error(`Suggest query failed: ${err.message}`);
    return res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
