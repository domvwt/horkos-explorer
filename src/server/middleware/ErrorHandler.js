const logger = require("../utils/Logger");

// Fixed, non-leaky message for anything we don't specifically recognise.
// Never derived from err.message: DB/filesystem error strings can leak
// internal detail (paths, table/schema names, query internals) to an
// unauthenticated public caller - same policy as utils/errorResponse.js.
const GENERIC_MESSAGE = "Internal server error";

/**
 * Global JSON error handler. Must be mounted LAST (after the /api router and
 * static middleware) - Express only routes to a 4-arg middleware on error.
 *
 * Maps known error shapes to a specific status; everything else falls back
 * to a fixed 500. The response body is always `{ error: <string> }` (the
 * same shape as utils/errorResponse.js) and NEVER includes err.message or
 * err.stack - only the server log gets the real detail.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function globalErrorHandler(err, req, res, next) {
  // If a response is already underway, we can't safely send another one -
  // hand off to Express's default handler as the docs mandate.
  if (res.headersSent) {
    return next(err);
  }

  let status = 500;
  let message = GENERIC_MESSAGE;

  if (err && err.type === "entity.too.large") {
    // body-parser: JSON body exceeded JSON_BODY_LIMIT.
    status = 413;
    message = "Request body too large";
  } else if (
    (err && err.type === "entity.parse.failed") ||
    err instanceof SyntaxError
  ) {
    // body-parser: malformed JSON payload.
    status = 400;
    message = "Malformed request body";
  } else if (err && err.isCorsRejection) {
    // Marked at the throw site (index.js CORS origin callback) rather than
    // matched on err.message, so the mapping survives message wording changes.
    status = 403;
    message = "Origin not allowed";
  }

  if (status >= 500) {
    logger.error(`Unhandled error: ${err && (err.stack || err.message)}`);
  } else {
    logger.warn(`Request rejected (${status}): ${err && err.message}`);
  }

  res.status(status).json({ error: message });
}

module.exports = globalErrorHandler;
