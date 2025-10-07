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

    // Check for write operations
    if (WRITE_OPERATIONS.test(query)) {
      const match = query.match(WRITE_OPERATIONS);
      throw new Error(
        `Write operation '${match[1]}' is not allowed in read-only mode. ` +
        `Only MATCH, RETURN, WITH, and read operations are permitted.`
      );
    }

    // Check for DDL operations
    if (DDL_OPERATIONS.test(query)) {
      const match = query.match(DDL_OPERATIONS);
      throw new Error(
        `DDL operation '${match[1]}' is not allowed in read-only mode.`
      );
    }

    // Check query length (prevent extremely large queries)
    const MAX_QUERY_LENGTH = 50000; // 50KB
    if (query.length > MAX_QUERY_LENGTH) {
      throw new Error(
        `Query too long (${query.length} characters). ` +
        `Maximum allowed: ${MAX_QUERY_LENGTH} characters.`
      );
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
