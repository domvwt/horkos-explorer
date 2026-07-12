#!/usr/bin/env node
/**
 * Staged /api/suggest latency benchmark.
 *
 * Measures server-side query latency for the two suggest stages against a
 * DuckDB search file, using the SAME modules the server executes at runtime
 * (src/server/utils/DuckDB.js and the SQL builders exported by
 * src/server/Suggest.js), so the numbers are the endpoint's own query cost
 * without HTTP overhead or rate-limit interference.
 *
 *   - stage=fast : LIKE prefix/word scan — the keystroke path.
 *                  Target: median well under 100ms.
 *   - stage=rank : BM25 (match_bm25, conjunctive := 1) — the async upgrade
 *                  staged out of the keystroke path. Informational.
 *
 * The query set includes the national-scale worst cases (high-frequency
 * tokens like LIMITED / LONDON / SMITH / STREET and 2-character prefixes,
 * which match the most rows) plus selective multi-token names.
 *
 * Usage:
 *   node scripts/benchmark-suggest.js [duckdb-file] [--runs N] [--limit N] [--json]
 *
 *   duckdb-file  Path to the search DuckDB file. Defaults to $DUCKDB_FILE
 *                (or the legacy $DUCKDB_PATH).
 *   --runs N     Timed runs per query after one cold run (default 5).
 *   --limit N    LIMIT passed to the suggest queries (default 10, the
 *                endpoint's default).
 *   --json       Also print the raw results as JSON (for records/tickets).
 *
 * Exit codes: 0 = fast path meets the sub-100ms median target for every
 * query; 1 = at least one fast-path median missed the target; 2 = setup
 * error (no file, connection failed, no search tables).
 */

const { performance } = require("perf_hooks");

const FAST_TARGET_MS = 100;

// Per-type query sets: worst-case high-frequency tokens, a 2-character
// prefix (the minimum the endpoint accepts, matching the most rows), and
// selective multi-token names. Zero result rows are fine — cost is in the
// scan, not the result.
const QUERY_SETS = {
  Company: ["li", "limited", "london", "smith", "royal mail group"],
  Person: ["sm", "smith", "john", "john smith", "david john williams"],
  Address: ["st", "street", "london", "high street london", "10 downing street"],
};

function parseArgs(argv) {
  const args = { file: null, runs: 5, limit: 10, json: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--runs") args.runs = parseInt(argv[++i], 10);
    else if (arg === "--limit") args.limit = parseInt(argv[++i], 10);
    else if (arg === "--json") args.json = true;
    else if (!arg.startsWith("--") && !args.file) args.file = arg;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) args.runs = 5;
  if (!Number.isInteger(args.limit) || args.limit < 1) args.limit = 10;
  return args;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function timeQuery(duckdb, sql, params, runs) {
  // One cold run first (includes any disk/page-cache misses), then `runs`
  // timed warm runs.
  const result = { coldMs: null, warmMs: [], rows: null, error: null };
  try {
    const coldStart = performance.now();
    const coldRows = await duckdb.query(sql, ...params);
    result.coldMs = performance.now() - coldStart;
    result.rows = coldRows.length;
    for (let i = 0; i < runs; i++) {
      const start = performance.now();
      await duckdb.query(sql, ...params);
      result.warmMs.push(performance.now() - start);
    }
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

function fmt(ms) {
  if (ms === null || ms === undefined) return "-";
  return ms >= 100 ? String(Math.round(ms)) : ms.toFixed(1);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.file) {
    process.env.DUCKDB_FILE = args.file;
  }
  if (!process.env.DUCKDB_FILE && !process.env.DUCKDB_PATH) {
    console.error("No DuckDB file: pass a path or set DUCKDB_FILE");
    process.exit(2);
  }

  // Load the real server modules so the benchmark runs exactly the SQL the
  // endpoint runs (same connection setup, same capability detection).
  const duckdb = require("../src/server/utils/DuckDB");
  const {
    buildRankedSql,
    buildLikeSql,
    buildLegacySql,
    ENTITY_TYPES,
  } = require("../src/server/Suggest");

  await duckdb.init();
  if (!duckdb.isEnabled()) {
    console.error("DuckDB connection failed (see log above)");
    process.exit(2);
  }
  const capabilities = await duckdb.getCapabilities();
  if (Object.keys(capabilities.tables).length === 0) {
    console.error("No search.* tables in this DuckDB file");
    process.exit(2);
  }

  console.log(
    `\nSuggest latency benchmark: ${process.env.DUCKDB_FILE || process.env.DUCKDB_PATH}` +
    `\n${args.runs} warm runs per query after 1 cold run, LIMIT ${args.limit}, ` +
    `fast-path target: median < ${FAST_TARGET_MS}ms\n`
  );

  const results = [];
  for (const [type, config] of Object.entries(ENTITY_TYPES)) {
    const tableCaps = capabilities.tables[config.table];
    if (!tableCaps) {
      console.log(`${type}: search.${config.table} missing — skipped`);
      continue;
    }
    const hasContractColumns = ["doc_id", "cluster_id", "canonical_name"].every(
      (c) => tableCaps.columns.has(c)
    );

    for (const rawQuery of QUERY_SETS[type]) {
      // Mirror handleSuggest's normalization and parameter order exactly.
      const query = rawQuery.trim();
      const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
      const startPattern = `${normalizedQuery}%`;
      const wordPattern = `% ${normalizedQuery}%`;

      const stages = [];
      if (hasContractColumns) {
        stages.push({
          stage: "fast",
          sql: buildLikeSql(config),
          params: [startPattern, startPattern, wordPattern, args.limit],
        });
        if (tableCaps.fts) {
          stages.push({
            stage: "rank",
            sql: buildRankedSql(config),
            params: [query, startPattern, wordPattern, args.limit],
          });
        }
      } else {
        // Pre-contract file: the endpoint serves the legacy LIKE query as
        // its fast path and has no ranked stage.
        stages.push({
          stage: "fast (legacy)",
          sql: buildLegacySql(config),
          params: [startPattern, wordPattern, startPattern, args.limit],
        });
      }

      for (const { stage, sql, params } of stages) {
        const timing = await timeQuery(duckdb, sql, params, args.runs);
        results.push({ type, query: rawQuery, stage, ...timing });
      }
    }
    if (hasContractColumns && !tableCaps.fts) {
      console.log(`${type}: no FTS index — rank stage skipped`);
    }
  }

  // Report.
  const header =
    "type".padEnd(9) + "query".padEnd(22) + "stage".padEnd(15) +
    "rows".padStart(5) + "cold".padStart(9) + "min".padStart(9) +
    "median".padStart(9) + "max".padStart(9);
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    if (r.error) {
      console.log(
        r.type.padEnd(9) + r.query.padEnd(22) + r.stage.padEnd(15) +
        `  ERROR: ${r.error}`
      );
      continue;
    }
    console.log(
      r.type.padEnd(9) + r.query.padEnd(22) + r.stage.padEnd(15) +
      String(r.rows).padStart(5) + fmt(r.coldMs).padStart(9) +
      fmt(Math.min(...r.warmMs)).padStart(9) +
      fmt(median(r.warmMs)).padStart(9) +
      fmt(Math.max(...r.warmMs)).padStart(9)
    );
  }

  const fastResults = results.filter((r) => r.stage.startsWith("fast") && !r.error);
  const fastMisses = fastResults.filter((r) => median(r.warmMs) >= FAST_TARGET_MS);
  const errors = results.filter((r) => r.error);
  const worstFast = fastResults.length
    ? fastResults.reduce((a, b) => (median(a.warmMs) > median(b.warmMs) ? a : b))
    : null;

  console.log("");
  if (worstFast) {
    console.log(
      `Worst fast-path median: ${fmt(median(worstFast.warmMs))}ms ` +
      `(${worstFast.type} "${worstFast.query}")`
    );
  }
  if (fastMisses.length === 0 && errors.length === 0 && fastResults.length > 0) {
    console.log(`PASS: every fast-path median is under ${FAST_TARGET_MS}ms`);
  } else {
    for (const r of fastMisses) {
      console.log(
        `FAIL: ${r.type} "${r.query}" fast median ${fmt(median(r.warmMs))}ms >= ${FAST_TARGET_MS}ms`
      );
    }
    for (const r of errors) {
      console.log(`ERROR: ${r.type} "${r.query}" ${r.stage}: ${r.error}`);
    }
  }

  if (args.json) {
    console.log("\n" + JSON.stringify(results.map((r) => ({
      ...r,
      coldMs: r.coldMs === null ? null : Math.round(r.coldMs * 10) / 10,
      warmMs: r.warmMs.map((ms) => Math.round(ms * 10) / 10),
    })), null, 2));
  }

  duckdb.close();
  process.exit(fastMisses.length > 0 || errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Benchmark failed: ${err.message}`);
  process.exit(2);
});
