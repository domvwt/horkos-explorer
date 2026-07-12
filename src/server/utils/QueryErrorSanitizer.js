// Sanitizes raw Kuzu query-execution error messages for relay to public,
// unauthenticated clients on the read-only deployment.
//
// Policy: by DEFAULT the /api/cypher route masks every execution error as a
// generic string (info-disclosure policy — Kuzu/DB/filesystem strings can leak
// internal detail: file paths, buffer/memory internals, storage layout). The
// one legitimate exception is feedback about the user's OWN query text: when a
// public user mistypes Cypher, a bare "Query execution failed" gives them zero
// signal on their own mistake. Parser and Binder exceptions are exactly that
// feedback — they describe a syntax error or an unknown variable/table/property
// in the text the user themselves typed.
//
// This module is an ALLOWLIST: it relays ONLY Parser and Binder exception
// classes, and only after sanitizing the text (path/config redaction + length
// cap). Every other class (Runtime, Conversion, Catalog, IO, Buffer manager,
// Storage, Interrupt/timeout, Copy, Overflow, Connection, Transaction, and any
// unprefixed Internal/NotImplemented text) falls through to { relay: false } and
// the route keeps emitting the generic message. Kuzu error `what()` strings are
// shaped "<Class> exception: <detail>" (verified against the Kuzu source:
// src/include/common/exception/*.h — e.g. ParserException uses the prefix
// "Parser exception: ", BinderException "Binder exception: ", RuntimeException
// "Runtime exception: ", etc.). The Node binding rejects with
// `new Error(what())`, so err.message carries the prefix verbatim.
//
// It is a pure function (raw message string in, decision object out) so it can
// be unit-tested in isolation against representative Kuzu error fixtures.

// Only these class prefixes are safe to relay: they describe the user's own
// query text and never (by design) internal server state. Matched
// case-insensitively at the very start of the message. Everything else stays
// generic — see the module header for the full excluded list and why.
const RELAYABLE_PREFIXES = ["Parser exception:", "Binder exception:"];

// Hard cap on the relayed message length. A Parser exception echoes back the
// offending line of the user's query with a caret underline, and a Binder
// exception can embed a very long user-supplied identifier; neither needs to be
// unbounded. 500 chars is comfortably enough for a syntax/binder message plus a
// short echoed line while bounding response size and any pathological input.
const MAX_RELAY_LENGTH = 500;

// Redaction: even inside an allowlisted (Parser/Binder) message, strip anything
// that could carry server-side detail. Defense-in-depth: on this deployment
// QueryValidator already rejects LOAD FROM / COPY (the queries that would make a
// binder echo a filesystem path) before execution, so these patterns should not
// fire on the live path — but a Binder exception provably CAN echo back an
// absolute path the user typed (e.g. "No file found that matches the pattern:
// /database/horkos.kuzu."), so we redact unconditionally rather than trust the
// upstream guard.
const REDACTION = "[redacted]";

// Absolute / drive-letter / UNC filesystem paths. Matches POSIX absolute paths
// ("/database/horkos.kuzu"), Windows drive paths ("C:\\data\\x"), and
// backslash paths. A "path" here is a leading slash or drive-letter/backslash
// followed by a run of non-space path characters — deliberately broad so no
// path segment survives. Ordinary Cypher identifiers and dotted property access
// (p.name) never begin with a slash or "X:\\", so they are untouched.
const PATH_PATTERNS = [
  // Windows drive path: C:\... or C:/...
  /[A-Za-z]:[\\/][^\s"']*/g,
  // UNC path: \\server\share...
  /\\\\[^\s"']+/g,
  // POSIX absolute path: a leading slash followed by at least one path segment
  // (/foo, /a/b.kuzu). Requires a non-slash char after the first slash so a bare
  // "/" (e.g. a division operator context) is not swallowed.
  /(?<![^\s"'(])\/[^\s"']*\/[^\s"']*/g,
  /(?<![^\s"'(])\/[A-Za-z0-9._-]+/g,
];

// Internal buffer/memory/storage vocabulary. If any of these words appears in
// an allowlisted message we do NOT relay it at all (belt-and-braces: a Parser or
// Binder message should never legitimately contain them, so their presence
// signals the text is not the clean user-feedback we intend to relay).
const INTERNAL_TERMS =
  /\b(?:buffer\s?manager|buffer\s?pool|mmap|memory|heap|malloc|storage|WAL|page\s?size|checkpoint)\b/i;

/**
 * Decide whether a raw Kuzu error message may be relayed to the client, and if
 * so return a sanitized form.
 *
 * @param {string} rawMessage - The raw error message (err.message from Kuzu).
 * @returns {{relay: true, message: string} | {relay: false}}
 *   relay:true  -> `message` is safe to send in the response `error` field.
 *   relay:false -> caller must emit the generic message instead.
 */
function sanitizeQueryError(rawMessage) {
  // Non-string / empty / undefined -> never relay (no crash).
  if (typeof rawMessage !== "string") {
    return { relay: false };
  }
  const trimmed = rawMessage.trim();
  if (trimmed.length === 0) {
    return { relay: false };
  }

  // Allowlist gate: the message must START with a relayable class prefix.
  // Case-insensitive on the prefix only; the detail after it keeps its case.
  const isRelayable = RELAYABLE_PREFIXES.some((prefix) =>
    trimmed.toLowerCase().startsWith(prefix.toLowerCase())
  );
  if (!isRelayable) {
    return { relay: false };
  }

  // If the (allowlisted) message mentions internal buffer/memory/storage
  // vocabulary, do not relay — it is not the clean user-feedback we intend.
  if (INTERNAL_TERMS.test(trimmed)) {
    return { relay: false };
  }

  // Redact any filesystem path that survived into an allowlisted message
  // (defense-in-depth; see PATH_PATTERNS note).
  let sanitized = trimmed;
  for (const pattern of PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, REDACTION);
  }

  // Cap the relayed length. Truncate on the raw char boundary and append an
  // ellipsis marker so the client knows the message was clipped.
  if (sanitized.length > MAX_RELAY_LENGTH) {
    sanitized = sanitized.slice(0, MAX_RELAY_LENGTH).trimEnd() + "…";
  }

  return { relay: true, message: sanitized };
}

module.exports = { sanitizeQueryError, MAX_RELAY_LENGTH };
