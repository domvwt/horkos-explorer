const express = require("express");
const router = express.Router();
const duckdb = require("./utils/DuckDB");
const logger = require("./utils/Logger");

/**
 * GET /api/suggest
 *
 * Prefix-matching autocomplete endpoint for node names.
 *
 * Uses LIKE-based search on normalized names for prefix matching
 * (typing "smi" finds "Smith").
 *
 * Query Parameters:
 *   - q: Search query (required, min 2 characters)
 *   - type: Entity type - "Company" | "Person" | "Address" (required)
 *   - limit: Maximum results to return (default: 10, max: 50)
 *
 * Returns:
 *   - 200: Array of matching name strings
 *   - 400: Invalid parameters
 *   - 404: Search not available (DUCKDB_PATH not configured)
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

  const entityType = req.query.type;
  const tableMap = {
    "Company": "search.company_names",
    "Person": "search.person_names",
    "Address": "search.address_names",
  };
  const table = tableMap[entityType];
  if (!table) {
    return res.status(400).json({
      error: "Invalid entity type",
      valid: Object.keys(tableMap),
    });
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

  // Normalize query to match name_normalized column (lowercase alphanumeric only)
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9 ]/g, "");

  try {
    // LIKE-based prefix matching on normalized names
    // Matches names starting with query OR containing query after a space
    // This provides prefix matching: "smi" finds "Smith", "Smiling", etc.
    const sql = `
      SELECT name
      FROM ${table}
      WHERE name_normalized LIKE ? OR name_normalized LIKE ?
      ORDER BY
        CASE WHEN name_normalized LIKE ? THEN 0 ELSE 1 END,
        LENGTH(name),
        name_normalized
      LIMIT ?
    `;
    const startPattern = `${normalizedQuery}%`;
    const wordPattern = `% ${normalizedQuery}%`;
    const rows = await duckdb.query(sql, startPattern, wordPattern, startPattern, limit);
    return res.json(rows.map((r) => r.name));
  } catch (err) {
    logger.error(`Suggest query failed: ${err.message}`);
    return res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
