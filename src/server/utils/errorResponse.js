const logger = require("./Logger");

/**
 * Send a policy-compliant error response.
 *
 * Public / READ_ONLY routes must never echo a raw error message to the
 * client: Kuzu / DB / filesystem error strings can leak internal detail
 * (file paths, schema/table names, query internals) to unauthenticated
 * users. Policy: log the full error server-side via the project logger,
 * and return a fixed, non-leaky generic message to the client.
 *
 * The response JSON shape is preserved as `{ error: <string> }` so the
 * frontend keeps parsing the `error` key unchanged.
 *
 * @param {object} res - Express response object.
 * @param {Error} err - The caught error (logged in full, never sent).
 * @param {object} [opts]
 * @param {number} [opts.status=400] - HTTP status code to preserve.
 * @param {string} [opts.clientMessage='Request failed'] - Generic client-facing message.
 * @param {string} [opts.logContext] - Prefix identifying the failing route in the log.
 */
function sendErrorResponse(res, err, opts = {}) {
  const {
    status = 400,
    clientMessage = "Request failed",
    logContext = "Request failed",
  } = opts;
  logger.error(`${logContext}: ${err && err.message}`);
  return res.status(status).send({ error: clientMessage });
}

module.exports = { sendErrorResponse };
