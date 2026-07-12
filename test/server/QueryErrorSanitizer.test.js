import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

// Unit tests for the pure Kuzu-error sanitizer. The fixtures below are REAL
// error messages captured from the Kuzu Node binding running queries against
// the dev graph in read-only mode (e.g. `RETURN`, `RETURN foo`,
// `MATCH (n:NoSuchTable) RETURN n`, `MATCH (a)-[r]-(b) RETURN r`), plus the
// exact class prefixes from the Kuzu source
// (src/include/common/exception/*.h). This proves the allowlist relays only
// Parser/Binder feedback about the user's own query text and masks everything
// else, and that no filesystem path can survive into a relayed message.

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const { sanitizeQueryError, MAX_RELAY_LENGTH } = require(
  path.join(repoRoot, "src/server/utils/QueryErrorSanitizer.js")
);

describe("QueryErrorSanitizer.sanitizeQueryError", () => {
  describe("(a) Parser exceptions are relayed with caret/position info intact", () => {
    it("relays a syntax error and keeps the echoed offending line", () => {
      const raw =
        'Parser exception: Invalid input <RETURN>: expected rule oC_RegularQuery (line: 1, offset: 6)\n"RETURN"\n       ';
      const result = sanitizeQueryError(raw);
      expect(result.relay).toBe(true);
      expect(result.message).toContain("Parser exception:");
      expect(result.message).toContain("expected rule oC_RegularQuery");
      // Position feedback about the user's own text is preserved.
      expect(result.message).toContain("(line: 1, offset: 6)");
    });

    it("relays a syntax error with a caret underline", () => {
      const raw =
        'Parser exception: Invalid input <MATCH (n RETURN>: expected rule oC_SingleQuery (line: 1, offset: 9)\n"MATCH (n RETURN n"\n          ^^^^^^';
      const result = sanitizeQueryError(raw);
      expect(result.relay).toBe(true);
      expect(result.message).toContain("^^^^^^");
    });
  });

  describe("(b) Binder exceptions about the user's identifiers are relayed", () => {
    it("relays a 'variable not in scope' error verbatim", () => {
      const result = sanitizeQueryError(
        "Binder exception: Variable foo is not in scope."
      );
      expect(result).toEqual({
        relay: true,
        message: "Binder exception: Variable foo is not in scope.",
      });
    });

    it("relays a 'table does not exist' error verbatim", () => {
      const result = sanitizeQueryError(
        "Binder exception: Table NoSuchTable does not exist."
      );
      expect(result.relay).toBe(true);
      expect(result.message).toBe(
        "Binder exception: Table NoSuchTable does not exist."
      );
    });

    it("relays a 'cannot find property' error verbatim", () => {
      const result = sanitizeQueryError(
        "Binder exception: Cannot find property notARealProp for p."
      );
      expect(result.relay).toBe(true);
      expect(result.message).toContain("notARealProp");
    });
  });

  describe("(c) filesystem paths are never relayed", () => {
    it("does NOT relay an IO exception embedding an absolute path (class not allowlisted)", () => {
      const result = sanitizeQueryError(
        "IO exception: could not open /database/horkos.kuzu"
      );
      expect(result).toEqual({ relay: false });
    });

    it("redacts an absolute POSIX path that appears inside an allowlisted Binder message", () => {
      // Real capture: a binder exception CAN echo a path the user typed.
      const result = sanitizeQueryError(
        "Binder exception: No file found that matches the pattern: /database/horkos.kuzu."
      );
      expect(result.relay).toBe(true);
      expect(result.message).not.toContain("/database/horkos.kuzu");
      expect(result.message).not.toContain("horkos.kuzu");
      expect(result.message).toContain("[redacted]");
    });

    it("redacts a Windows drive path inside an allowlisted Binder message", () => {
      const result = sanitizeQueryError(
        "Binder exception: Cannot open C:\\Users\\svc\\data\\graph.kuzu for reading."
      );
      expect(result.relay).toBe(true);
      expect(result.message).not.toContain("C:\\Users");
      expect(result.message).not.toContain("graph.kuzu");
      expect(result.message).toContain("[redacted]");
    });

    it("redacts multiple paths in one message", () => {
      const result = sanitizeQueryError(
        "Binder exception: copying /srv/a.csv to /var/lib/b.parquet failed"
      );
      expect(result.relay).toBe(true);
      expect(result.message).not.toContain("/srv/a.csv");
      expect(result.message).not.toContain("/var/lib/b.parquet");
    });

    it("does not mistake dotted property access for a path", () => {
      const result = sanitizeQueryError(
        "Binder exception: Cannot find property x for p.name."
      );
      expect(result.relay).toBe(true);
      expect(result.message).toContain("p.name");
      expect(result.message).not.toContain("[redacted]");
    });
  });

  describe("(d) interrupt/timeout is generic", () => {
    it("does NOT relay the InterruptException message", () => {
      // Kuzu InterruptException == exactly "Interrupted." (no class prefix).
      expect(sanitizeQueryError("Interrupted.")).toEqual({ relay: false });
    });
  });

  describe("(e) buffer/memory and other non-allowlisted classes are generic", () => {
    it("does NOT relay a buffer-manager exception", () => {
      expect(
        sanitizeQueryError("Buffer manager exception: Unable to allocate memory.")
      ).toEqual({ relay: false });
    });

    it("does NOT relay a Runtime exception", () => {
      expect(
        sanitizeQueryError("Runtime exception: Divide by zero.")
      ).toEqual({ relay: false });
    });

    it("does NOT relay a Conversion exception (leaks internal STRUCT schema)", () => {
      expect(
        sanitizeQueryError(
          "Conversion exception: Unsupported casting function from STRUCT(role STRING) to STRUCT(role STRING, control_type STRING)."
        )
      ).toEqual({ relay: false });
    });

    it("does NOT relay a Catalog exception", () => {
      expect(
        sanitizeQueryError("Catalog exception: Table Foo already exists.")
      ).toEqual({ relay: false });
    });

    it("does NOT relay a Storage exception", () => {
      expect(
        sanitizeQueryError("Storage exception: Corrupt page detected.")
      ).toEqual({ relay: false });
    });

    it("does NOT relay a Copy exception", () => {
      expect(
        sanitizeQueryError("Copy exception: could not read column.")
      ).toEqual({ relay: false });
    });

    it("does NOT relay an allowlisted-prefix message that mentions internal memory vocabulary", () => {
      // Belt-and-braces: even a Binder-prefixed message is withheld if it
      // references buffer/memory/storage internals.
      expect(
        sanitizeQueryError(
          "Binder exception: something about the buffer manager and mmap page size"
        )
      ).toEqual({ relay: false });
    });

    it("does NOT relay an unprefixed error string that happens to contain a path", () => {
      expect(
        sanitizeQueryError("Some random error with no prefix /etc/passwd")
      ).toEqual({ relay: false });
    });
  });

  describe("(f) length cap", () => {
    it("truncates a message that exceeds the cap and marks it clipped", () => {
      const raw =
        "Binder exception: Variable " + "x".repeat(800) + " is not in scope.";
      const result = sanitizeQueryError(raw);
      expect(result.relay).toBe(true);
      // Truncated to MAX_RELAY_LENGTH chars plus a single ellipsis marker.
      expect(result.message.length).toBeLessThanOrEqual(MAX_RELAY_LENGTH + 1);
      expect(result.message.endsWith("…")).toBe(true);
    });

    it("leaves a short message untruncated (no ellipsis)", () => {
      const result = sanitizeQueryError(
        "Binder exception: Variable foo is not in scope."
      );
      expect(result.message.endsWith("…")).toBe(false);
    });
  });

  describe("(g) empty/undefined/non-string input never crashes and is generic", () => {
    it("returns generic for undefined", () => {
      expect(sanitizeQueryError(undefined)).toEqual({ relay: false });
    });
    it("returns generic for null", () => {
      expect(sanitizeQueryError(null)).toEqual({ relay: false });
    });
    it("returns generic for a number", () => {
      expect(sanitizeQueryError(42)).toEqual({ relay: false });
    });
    it("returns generic for an object", () => {
      expect(sanitizeQueryError({ message: "Parser exception: x" })).toEqual({
        relay: false,
      });
    });
    it("returns generic for an empty / whitespace-only string", () => {
      expect(sanitizeQueryError("")).toEqual({ relay: false });
      expect(sanitizeQueryError("   \n  ")).toEqual({ relay: false });
    });
  });

  describe("prefix matching is case-insensitive but anchored at the start", () => {
    it("matches a lowercase prefix", () => {
      expect(sanitizeQueryError("parser exception: bad").relay).toBe(true);
    });
    it("does NOT relay when the prefix is not at the very start", () => {
      // A non-allowlisted class whose detail merely mentions the words.
      expect(
        sanitizeQueryError("Runtime exception: caused by Binder exception: x")
      ).toEqual({ relay: false });
    });
  });
});
