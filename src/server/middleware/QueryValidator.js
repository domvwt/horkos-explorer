const logger = require("../utils/Logger");
const MODES = require("../utils/Constants").MODES;

/**
 * Query Validator Middleware
 *
 * Validates Cypher queries in READ_ONLY mode to prevent write operations.
 * Provides defense-in-depth by checking queries before execution.
 */

// Write operations that should be blocked in READ_ONLY mode
const WRITE_OPERATIONS = /^\s*(CREATE|DROP|ALTER|DELETE|SET|MERGE|COPY|DETACH|INSERT|REMOVE)/im;

// Additional dangerous operations
const DDL_OPERATIONS = /^\s*(DROP|ALTER|CREATE\s+INDEX|CREATE\s+CONSTRAINT)/im;

class QueryValidator {
  /**
   * Splits a Cypher query into individual statements
   * Handles semicolons within strings properly
   * @param {string} query - The full query string
   * @returns {string[]} Array of individual statements
   */
  static splitStatements(query) {
    const statements = [];
    let currentStatement = '';
    let inString = false;
    let stringChar = null;
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
   * Strips comments from a Cypher statement
   * Removes both line comments (starting with //) and block comments (delimited by slash-star star-slash)
   * @param {string} statement - A Cypher statement
   * @returns {string} Statement with comments removed
   */
  static stripComments(statement) {
    let result = '';
    let inString = false;
    let stringChar = null;
    let escaped = false;
    let i = 0;

    while (i < statement.length) {
      const char = statement[i];
      const nextChar = i + 1 < statement.length ? statement[i + 1] : null;

      if (escaped) {
        result += char;
        escaped = false;
        i++;
        continue;
      }

      if (char === '\\' && inString) {
        escaped = true;
        result += char;
        i++;
        continue;
      }

      // Track string boundaries
      if ((char === "'" || char === '"') && !inString) {
        inString = true;
        stringChar = char;
        result += char;
        i++;
      } else if (char === stringChar && inString) {
        inString = false;
        stringChar = null;
        result += char;
        i++;
      } else if (!inString && char === '/' && nextChar === '/') {
        // Line comment - skip until end of line
        i += 2;
        while (i < statement.length && statement[i] !== '\n') {
          i++;
        }
        if (i < statement.length) {
          result += '\n'; // Preserve newline
          i++;
        }
      } else if (!inString && char === '/' && nextChar === '*') {
        // Block comment - skip until */
        i += 2;
        while (i < statement.length - 1) {
          if (statement[i] === '*' && statement[i + 1] === '/') {
            i += 2;
            result += ' '; // Replace comment with space
            break;
          }
          i++;
        }
      } else {
        result += char;
        i++;
      }
    }

    return result;
  }

  /**
   * Validates a single Cypher statement
   * @param {string} statement - A single Cypher statement
   * @throws {Error} If statement contains forbidden operations
   */
  static validateStatement(statement) {
    // Strip comments before validation to prevent comment-based bypass
    const cleanedStatement = QueryValidator.stripComments(statement);

    // Check for write operations
    if (WRITE_OPERATIONS.test(cleanedStatement)) {
      const match = cleanedStatement.match(WRITE_OPERATIONS);
      throw new Error(
        `Write operation '${match[1]}' is not allowed in read-only mode. ` +
        `Only MATCH, RETURN, WITH, and read operations are permitted.`
      );
    }

    // Check for DDL operations
    if (DDL_OPERATIONS.test(cleanedStatement)) {
      const match = cleanedStatement.match(DDL_OPERATIONS);
      throw new Error(
        `DDL operation '${match[1]}' is not allowed in read-only mode.`
      );
    }
  }

  /**
   * Validates a Cypher query for read-only compliance
   * @param {string} query - The Cypher query to validate
   * @param {string} mode - The access mode (READ_ONLY, READ_WRITE, etc.)
   * @throws {Error} If query contains forbidden operations
   */
  static validateQuery(query, mode) {
    if (!query || typeof query !== 'string') {
      throw new Error('Query must be a non-empty string');
    }

    // Only enforce validation in READ_ONLY mode
    if (mode !== MODES.READ_ONLY) {
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

    // Split into individual statements and validate each one
    const statements = QueryValidator.splitStatements(query);

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
