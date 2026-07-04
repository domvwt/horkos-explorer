#!/usr/bin/env node
/**
 * Cypher parser drift guard.
 *
 * The server-side read-only QueryValidator loads a CommonJS transpile of the
 * ANTLR-generated Cypher parser from this directory
 * (CypherParser.js / CypherLexer.js). Those twins are produced from the
 * committed TypeScript parser at src/utils/CypherParser/*.ts, which
 * `npm run generate-grammar[-prod]` regenerates on a grammar change — but that
 * command does NOT rebuild these CJS twins. If someone bumps the Cypher grammar
 * and forgets to regenerate the twins, the security-critical parser silently
 * desyncs from the grammar the app actually parses with. That could over-block
 * legitimate reads or, worse, fail to recognize a NEW dangerous construct and
 * reopen the LOAD-FROM-style exfiltration hole.
 *
 * This script re-transpiles the committed *.ts to a temp dir and compares the
 * emitted CODE BODY (ignoring the checked-in banner) against the committed
 * twins. It exits non-zero on any difference, so a grammar change that forgets
 * to regenerate the twins FAILS THE BUILD/CI. It is wired into the `pretest`
 * npm script and the lint CI workflow.
 *
 * Run: `npm run check-cypher-parser-sync`
 */
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Repo root = four levels up from src/server/middleware/cypher-parser/.
const repoRoot = path.resolve(__dirname, "../../../..");
const srcDir = path.join(repoRoot, "src/utils/CypherParser");
const twinDir = __dirname;
const tscBin = path.join(repoRoot, "node_modules/typescript/bin/tsc");
const FILES = ["CypherParser", "CypherLexer"];

// Strip a leading run of `//` banner comment lines plus any following blank
// lines, so the comparison is over the transpiled code body only.
function stripBanner(code) {
  const lines = code.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i].startsWith("//") || lines[i].trim() === "")) {
    i++;
  }
  return lines.slice(i).join("\n");
}

function main() {
  for (const f of FILES) {
    if (!fs.existsSync(path.join(srcDir, f + ".ts"))) {
      console.error(
        `Cannot check parser sync: missing ${path.join(srcDir, f + ".ts")}. ` +
        `Run \`npm run generate-grammar\` first.`
      );
      process.exit(2);
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cypher-twin-"));
  try {
    // tsc returns a non-zero exit for the pre-existing type errors in the
    // ANTLR-generated parser, but still EMITS the JS (noEmitOnError false).
    // We only need the emitted output, so tolerate the exit code and instead
    // assert the expected files were written.
    try {
      execFileSync(
        "node",
        [
          tscBin,
          "--module", "commonjs",
          "--target", "es2020",
          "--moduleResolution", "node",
          "--skipLibCheck",
          "--noEmitOnError", "false",
          "--outDir", tmp,
          path.join(srcDir, "CypherParser.ts"),
          path.join(srcDir, "CypherLexer.ts"),
        ],
        { cwd: srcDir, stdio: "ignore" }
      );
    } catch (e) {
      // Expected: type-error exit. Emit still happens; verified below.
    }

    let drift = false;
    for (const f of FILES) {
      const emitted = path.join(tmp, f + ".js");
      if (!fs.existsSync(emitted)) {
        console.error(`Transpile did not emit ${f}.js — cannot verify sync.`);
        process.exit(2);
      }
      const fresh = stripBanner(fs.readFileSync(emitted, "utf8"));
      const committedPath = path.join(twinDir, f + ".js");
      if (!fs.existsSync(committedPath)) {
        console.error(`Missing committed twin: ${committedPath}`);
        drift = true;
        continue;
      }
      const committed = stripBanner(fs.readFileSync(committedPath, "utf8"));
      if (fresh !== committed) {
        console.error(
          `DRIFT: src/server/middleware/cypher-parser/${f}.js differs from a ` +
          `fresh transpile of the committed src/utils/CypherParser/${f}.ts.`
        );
        drift = true;
      }
    }

    if (drift) {
      console.error(
        "\nThe server-side Cypher parser twins are out of sync with the " +
        "grammar.\nRegenerate them (see the banner in " +
        "src/server/middleware/cypher-parser/*.js) and re-run this check."
      );
      process.exit(1);
    }
    console.log("Cypher parser twins are in sync with the committed grammar.");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
