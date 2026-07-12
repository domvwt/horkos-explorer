const antlr = require("antlr4ng");
const logger = require("../utils/Logger");
const MODES = require("../utils/Constants").MODES;
const { CypherLexer } = require("./cypher-parser/CypherLexer");
const { CypherParser } = require("./cypher-parser/CypherParser");

/**
 * Query Validator Middleware
 *
 * Validates Cypher queries in READ_ONLY mode using a FAIL-CLOSED ALLOWLIST
 * built on the ANTLR Cypher parse tree (not a keyword blocklist).
 *
 * Rationale: a leading-keyword regex blocklist is bypassable and requires
 * enumerating every dangerous verb forever. It also missed Kuzu's
 * `LOAD FROM '<path>'` construct entirely, which reads arbitrary local files
 * (and URLs) through the public read-only endpoint. `LOAD FROM` is
 * *grammatically* a reading clause, so neither Kuzu's read-only DB mode nor a
 * "block writes" check catches it.
 *
 * Policy (READ_ONLY mode only): a query is allowed ONLY if every statement
 * parses cleanly AND is provably composed of read-only structure:
 *   - The top-level statement must be an `oC_Query` (a MATCH/RETURN-style
 *     query). Every DDL / database-management statement in this grammar
 *     (CREATE TABLE, DROP, ALTER, ATTACH, USE, INSTALL/LOAD EXTENSION,
 *     IMPORT, EXPORT, COPY, standalone CALL, transactions, ...) parses to a
 *     distinct `kU_*` statement node instead and is therefore rejected by
 *     default — we never have to enumerate them.
 *   - Within the query, the two grammatically-"read" constructs that are
 *     nonetheless dangerous are denied explicitly: `kU_LoadFrom`
 *     (LOAD FROM / LOAD WITH HEADERS FROM) and `kU_InQueryCall` (in-query
 *     CALL). There is no legitimate need for either on /api/cypher.
 *   - Updating clauses (CREATE / MERGE / SET / DELETE) are denied explicitly
 *     as defense-in-depth; only MATCH / OPTIONAL MATCH / UNWIND reading
 *     clauses and read projection (WITH / RETURN / UNION / ORDER BY / SKIP /
 *     LIMIT / WHERE) remain reachable.
 *   - EXPLAIN / PROFILE wrappers are permitted: the grammar models them as an
 *     `oC_AnyCypherOption` prefix over an otherwise-allowed `oC_Query`, so they
 *     ride the same allowlist and cannot smuggle anything past it.
 *
 * Anything that fails to parse, or contains any construct not on the allow
 * list, is REJECTED (fail closed). Parser internals are never echoed to the
 * client.
 */

/**
 * Rule names (from CypherParser.ruleNames) that must NOT appear anywhere in an
 * allowed query's parse tree. These are constructs that are reachable from
 * within an `oC_Query` but are not read-only.
 */
const FORBIDDEN_RULE_NAMES = new Set([
  // Grammatically "reading" clauses that are actually dangerous:
  "kU_LoadFrom",     // LOAD FROM '<file|url>' ... — local-file / SSRF read
  "kU_InQueryCall",  // CALL <fn>(...) inside a query
  // Updating clauses (belt-and-braces; also covered by the read-only DB mode):
  "oC_Create",
  "oC_Merge",
  "oC_Set",
  "oC_Delete",
]);

/**
 * Rule name that the top-level statement MUST be. Anything else (all the
 * `kU_*` DDL / database-management statements) is rejected by default.
 */
const ALLOWED_STATEMENT_RULE = "oC_Query";
const STATEMENT_RULE = "oC_Statement";

/**
 * Maximum allowed bracket-nesting depth for a single statement.
 *
 * PARSE-DoS GUARD: the ANTLR ALL(*) parser runs SYNCHRONOUSLY on the Express
 * event loop before the DB is ever reached, and deeply nested parentheses make
 * parse time grow super-linearly. Measured against this validator, a ~1KB
 * payload of ~500 nested parens pins the single Node thread for >30s — an
 * unauthenticated whole-server freeze that the 50KB length cap (which permits
 * nesting ~12000 deep), the Kuzu query timeout (the request never reaches
 * Kuzu), and the request rate limit (a handful of payloads freeze the loop for
 * minutes) all fail to bound. So we reject over-nested input with a cheap O(n)
 * scan BEFORE parsing, ensuring the expensive parse never runs on hostile
 * input. A depth of 100 is far beyond anything legitimate Cypher needs.
 */
const MAX_NESTING_DEPTH = 100;

// Cache the rule-name lookup table once; it is a static on the generated parser.
const RULE_NAMES = CypherParser.ruleNames;
const STATEMENT_RULE_INDEX = RULE_NAMES.indexOf(STATEMENT_RULE);
const ALLOWED_STATEMENT_RULE_INDEX = RULE_NAMES.indexOf(ALLOWED_STATEMENT_RULE);
const FORBIDDEN_RULE_INDICES = new Set(
  [...FORBIDDEN_RULE_NAMES].map((name) => RULE_NAMES.indexOf(name))
);

/**
 * An ANTLR error listener that records whether any syntax error occurred,
 * without printing to the console or surfacing parser internals.
 */
class RecordingErrorListener extends antlr.BaseErrorListener {
  constructor() {
    super();
    this.hadError = false;
  }
  syntaxError() {
    this.hadError = true;
  }
}

class QueryValidator {
  /**
   * Strips `//...` line comments and `/* ... *​/` block comments from a query,
   * replacing each comment with a single space so tokens that were separated
   * only by a comment are not merged. STRING-LITERAL-SAFE: a `//` or `/*` that
   * appears inside a single- or double-quoted string literal (honouring
   * backslash escapes) or inside a Kuzu backtick-quoted identifier is left
   * untouched.
   *
   * This runs BEFORE splitStatements so a comment can never hide a statement
   * separator or a forbidden construct from the validator's view (the ANTLR
   * lexer folds trailing comments into whitespace tokens, so the raw parse
   * tree does not reliably expose commented-out text). It uses the same
   * single-pass, O(n) string+comment-aware scanning discipline as
   * assertNestingWithinBounds, so it introduces no catastrophic-backtracking
   * DoS vector.
   *
   * @param {string} query - The full query string
   * @returns {string} The query with comments outside string literals removed.
   */
  static stripComments(query) {
    let out = '';
    let inString = false;
    let stringChar = null;
    let inBacktick = false;
    let escaped = false;
    let i = 0;

    while (i < query.length) {
      const char = query[i];
      const nextChar = i + 1 < query.length ? query[i + 1] : null;

      if (escaped) {
        out += char;
        escaped = false;
        i++;
        continue;
      }

      if (char === '\\' && inString) {
        out += char;
        escaped = true;
        i++;
        continue;
      }

      // Track Kuzu backtick-quoted identifiers. A backtick opens an identifier
      // and the next backtick closes it; INSIDE, a `'` `"` `(` `//` `/*` etc.
      // are literal identifier characters, not string/comment delimiters. This
      // must be handled BEFORE the quote/comment logic so a lone apostrophe
      // inside a backtick identifier cannot flip the scanner into fake
      // in-string mode. Backticks inside a real quoted string are literal, so
      // this branch is skipped while inString.
      if (char === '`' && !inString) {
        inBacktick = !inBacktick;
        out += char;
        i++;
        continue;
      }
      if (inBacktick) {
        out += char;
        i++;
        continue;
      }

      // Track string boundaries (single or double quotes).
      if ((char === "'" || char === '"') && !inString) {
        inString = true;
        stringChar = char;
        out += char;
        i++;
        continue;
      }
      if (inString) {
        if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
        out += char;
        i++;
        continue;
      }

      // Outside strings: replace comments with a single space so adjacent
      // tokens are not merged.
      if (char === '/' && nextChar === '/') {
        i += 2;
        while (i < query.length && query[i] !== '\n') {
          i++;
        }
        out += ' ';
        continue;
      }
      if (char === '/' && nextChar === '*') {
        i += 2;
        while (
          i < query.length - 1 &&
          !(query[i] === '*' && query[i + 1] === '/')
        ) {
          i++;
        }
        i += 2; // skip closing */ (or run off the end if unterminated)
        out += ' ';
        continue;
      }

      out += char;
      i++;
    }

    return out;
  }

  /**
   * Splits a Cypher query into individual statements
   * Handles semicolons within strings properly
   * @param {string} query - The full query string
   * @returns {string[]} Array of individual statements
   */
  static splitStatements(query) {
    // Strip comments BEFORE splitting so a `//` or `/* */` comment cannot hide
    // a `;` separator (or any construct) from the validator. String-literal
    // safe, so a `//`/`/*` inside a quoted value is preserved.
    query = QueryValidator.stripComments(query);

    const statements = [];
    let currentStatement = '';
    let inString = false;
    let stringChar = null;
    let inBacktick = false;
    let escaped = false;

    for (let i = 0; i < query.length; i++) {
      const char = query[i];

      if (escaped) {
        currentStatement += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        currentStatement += char;
        continue;
      }

      // Track Kuzu backtick-quoted identifiers so a `'`/`"`/`;` inside one is
      // literal (not a string delimiter or statement separator). Must run
      // before the quote/`;` logic. Skipped inside a real quoted string.
      if (char === '`' && !inString) {
        inBacktick = !inBacktick;
        currentStatement += char;
        continue;
      }
      if (inBacktick) {
        currentStatement += char;
        continue;
      }

      // Track string boundaries (single or double quotes)
      if ((char === "'" || char === '"') && !inString) {
        inString = true;
        stringChar = char;
        currentStatement += char;
      } else if (char === stringChar && inString) {
        inString = false;
        stringChar = null;
        currentStatement += char;
      } else if (char === ';' && !inString) {
        // Found statement separator outside of string
        const trimmed = currentStatement.trim();
        if (trimmed) {
          statements.push(trimmed);
        }
        currentStatement = '';
      } else {
        currentStatement += char;
      }
    }

    // Add final statement if exists
    const trimmed = currentStatement.trim();
    if (trimmed) {
      statements.push(trimmed);
    }

    return statements;
  }

  /**
   * Cheap O(n) parse-DoS guard: rejects a statement whose bracket-nesting depth
   * exceeds MAX_NESTING_DEPTH, WITHOUT invoking the expensive ANTLR parser.
   *
   * Brackets inside string literals, comments and Kuzu backtick-quoted
   * identifiers are ignored, using the same string-aware scanning
   * (single/double quotes, backslash escapes, backtick identifiers) and comment
   * handling (line comments and block comments) as the rest of this validator,
   * so brackets that appear inside a quoted string literal, a comment or a
   * backtick identifier are NOT counted and do NOT cause a false rejection.
   * Backtick-awareness is SECURITY-CRITICAL: without it a lone apostrophe
   * inside a `` `...` `` identifier flips the scanner into fake in-string mode,
   * hiding every subsequent `(` from the depth count and bypassing this guard.
   *
   * @param {string} statement - A single Cypher statement
   * @throws {Error} If nesting depth exceeds the bound.
   */
  static assertNestingWithinBounds(statement) {
    let depth = 0;
    let inString = false;
    let stringChar = null;
    let inBacktick = false;
    let escaped = false;
    let i = 0;

    while (i < statement.length) {
      const char = statement[i];
      const nextChar = i + 1 < statement.length ? statement[i + 1] : null;

      if (escaped) {
        escaped = false;
        i++;
        continue;
      }

      if (char === '\\' && inString) {
        escaped = true;
        i++;
        continue;
      }

      // Track Kuzu backtick-quoted identifiers. Brackets AND a lone `'`/`"`
      // inside a backtick identifier are literal, so they must not be counted
      // and must not flip the scanner into fake in-string mode (the DoS bypass
      // this guard closes). Must run before the quote/comment/bracket logic;
      // skipped inside a real quoted string, where a backtick is literal.
      if (char === '`' && !inString) {
        inBacktick = !inBacktick;
        i++;
        continue;
      }
      if (inBacktick) {
        i++;
        continue;
      }

      // Track string boundaries (single or double quotes).
      if ((char === "'" || char === '"') && !inString) {
        inString = true;
        stringChar = char;
        i++;
        continue;
      }
      if (inString) {
        if (char === stringChar) {
          inString = false;
          stringChar = null;
        }
        i++;
        continue;
      }

      // Outside strings: skip comments so brackets within them do not count.
      if (char === '/' && nextChar === '/') {
        i += 2;
        while (i < statement.length && statement[i] !== '\n') {
          i++;
        }
        continue;
      }
      if (char === '/' && nextChar === '*') {
        i += 2;
        while (i < statement.length - 1 &&
               !(statement[i] === '*' && statement[i + 1] === '/')) {
          i++;
        }
        i += 2; // skip the closing */ (or run off the end if unterminated)
        continue;
      }

      // Count bracket nesting outside strings/comments.
      if (char === '(' || char === '[' || char === '{') {
        depth++;
        if (depth > MAX_NESTING_DEPTH) {
          // Generic message: does not leak the exact bound in a way that helps
          // an attacker tune payloads.
          throw new Error(
            'Query is too deeply nested and was rejected. Only read ' +
            'operations of reasonable structure are permitted in read-only ' +
            'mode.'
          );
        }
      } else if (char === ')' || char === ']' || char === '}') {
        if (depth > 0) {
          depth--;
        }
      }
      i++;
    }
  }

  /**
   * Parses a single statement into an ANTLR parse tree.
   * @param {string} statement - A single Cypher statement
   * @returns {{tree: object}|null} The parse tree, or null on any parse/lex error.
   */
  static parseStatement(statement) {
    const errorListener = new RecordingErrorListener();

    const charStream = antlr.CharStreams.fromString(statement);
    const lexer = new CypherLexer(charStream);
    lexer.removeErrorListeners();
    lexer.addErrorListener(errorListener);

    const tokenStream = new antlr.CommonTokenStream(lexer);
    const parser = new CypherParser(tokenStream);
    parser.removeErrorListeners();
    parser.addErrorListener(errorListener);

    let tree;
    try {
      tree = parser.oC_Cypher();
    } catch (err) {
      // Any parser exception is a parse failure -> fail closed.
      return null;
    }

    if (errorListener.hadError) {
      return null;
    }

    // EOF assertion (fail closed): the grammar's oC_Cypher rule accepts a
    // valid PREFIX (an oC_Statement plus an optional trailing SP and ';') and
    // stops — it does NOT itself match EOF. Trailing tokens after an accepted
    // prefix would otherwise be silently dropped by the validator while still
    // being forwarded to (a future) engine, letting the two parsers disagree.
    // Require that the parser consumed the whole statement: after the accepted
    // prefix only whitespace tokens (the CypherLexer folds trailing line/block
    // comments into SP tokens too) may remain before EOF. Any other unconsumed
    // token means the accepted parse was a partial prefix -> reject.
    let next = parser.getCurrentToken();
    while (next && next.type === CypherLexer.SP) {
      tokenStream.consume();
      next = parser.getCurrentToken();
    }
    if (!next || next.type !== antlr.Token.EOF) {
      return null;
    }

    return { tree };
  }

  /**
   * Validates a single Cypher statement against the read-only allowlist.
   * @param {string} statement - A single Cypher statement
   * @throws {Error} If the statement does not parse or is not read-only.
   */
  static validateStatement(statement) {
    // Parse-DoS guard MUST run before the ANTLR parser: a cheap O(n) scan
    // rejects pathologically nested input so the expensive parse never runs on
    // it. See MAX_NESTING_DEPTH.
    QueryValidator.assertNestingWithinBounds(statement);

    const parsed = QueryValidator.parseStatement(statement);

    // Fail closed: anything that does not parse is rejected. Do NOT echo
    // parser internals back to the client (info-disclosure hygiene).
    if (!parsed) {
      throw new Error(
        'Query could not be parsed as a valid read-only Cypher query and was ' +
        'rejected. Only read operations (MATCH, OPTIONAL MATCH, WHERE, WITH, ' +
        'UNWIND, RETURN, UNION, ORDER BY, SKIP, LIMIT) are permitted in ' +
        'read-only mode.'
      );
    }

    QueryValidator.assertReadOnlyTree(parsed.tree);
  }

  /**
   * Walks a parse tree and enforces the allowlist policy. Fail-closed:
   *   1. every `oC_Statement` node's rule-child must be `oC_Query`; and
   *   2. no forbidden rule (LOAD FROM, in-query CALL, updating clauses) may
   *      appear anywhere.
   * @param {object} tree - Root parse tree node (oC_Cypher context).
   * @throws {Error} If any disallowed construct is found.
   */
  static assertReadOnlyTree(tree) {
    // Iterative DFS to avoid recursion limits on deep trees.
    const stack = [tree];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || typeof node.getChildCount !== "function") {
        continue;
      }

      const ruleIndex = node.ruleIndex;

      // Gate 1: the top-level statement must be an oC_Query. Every DDL /
      // database-management statement produces a different rule-child here and
      // is therefore rejected by default (no enumeration required).
      if (ruleIndex === STATEMENT_RULE_INDEX) {
        let hasAllowedQueryChild = false;
        const childCount = node.getChildCount();
        for (let i = 0; i < childCount; i++) {
          const child = node.getChild(i);
          if (child && child.ruleIndex === ALLOWED_STATEMENT_RULE_INDEX) {
            hasAllowedQueryChild = true;
            break;
          }
        }
        if (!hasAllowedQueryChild) {
          throw new Error(
            'Only read queries (MATCH ... RETURN) are permitted in read-only ' +
            'mode. Data-definition and database-management statements ' +
            '(e.g. CREATE/DROP/ALTER TABLE, ATTACH, USE, INSTALL, IMPORT, ' +
            'EXPORT, COPY) are not allowed.'
          );
        }
      }

      // Gate 2: no forbidden construct anywhere in the tree.
      if (FORBIDDEN_RULE_INDICES.has(ruleIndex)) {
        throw new Error(
          'Query contains a construct that is not allowed in read-only mode ' +
          '(such as LOAD FROM, CALL, or a write clause). Only read operations ' +
          'are permitted.'
        );
      }

      const childCount = node.getChildCount();
      for (let i = 0; i < childCount; i++) {
        stack.push(node.getChild(i));
      }
    }
  }

  /**
   * Validates a Cypher query for read-only compliance
   * @param {string} query - The Cypher query to validate
   * @param {string} mode - The access mode (READ_ONLY, READ_WRITE, etc.)
   * @throws {Error} If query contains forbidden operations
   * @returns {boolean} true if the query is allowed
   */
  static validateQuery(query, mode) {
    if (!query || typeof query !== 'string') {
      throw new Error('Query must be a non-empty string');
    }

    // Fail CLOSED on mode: enforce the allowlist for EVERY mode except the
    // explicit local-dev READ_WRITE. An unset/typo/garbage mode falls through
    // to enforcement so a mis-set MODE on a live backend cannot re-open
    // LOAD FROM / in-query CALL.
    if (mode === MODES.READ_WRITE) {
      return true;
    }

    // Check query length (prevent extremely large queries)
    const MAX_QUERY_LENGTH = 50000; // 50KB
    if (query.length > MAX_QUERY_LENGTH) {
      throw new Error(
        `Query too long (${query.length} characters). ` +
        `Maximum allowed: ${MAX_QUERY_LENGTH} characters.`
      );
    }

    // Split into individual statements and validate each one. Each statement
    // must independently pass; a benign MATCH followed by a LOAD FROM rejects
    // the whole query.
    const statements = QueryValidator.splitStatements(query);

    if (statements.length === 0) {
      throw new Error('Query must contain at least one statement.');
    }

    for (let i = 0; i < statements.length; i++) {
      try {
        QueryValidator.validateStatement(statements[i]);
      } catch (error) {
        // Add statement number to error message for multi-statement queries
        if (statements.length > 1) {
          error.message = `Statement ${i + 1}: ${error.message}`;
        }
        throw error;
      }
    }

    return true;
  }

  /**
   * Express middleware function for query validation
   */
  static middleware(database) {
    return (req, res, next) => {
      try {
        const query = req.body.query;
        const mode = database.getAccessModeString();

        // Validate the query
        QueryValidator.validateQuery(query, mode);

        // If validation passes, continue to next middleware
        next();
      } catch (error) {
        logger.warn(`Query validation failed: ${error.message}`);
        return res.status(403).send({
          error: error.message,
          code: 'QUERY_VALIDATION_FAILED'
        });
      }
    };
  }
}

module.exports = QueryValidator;
