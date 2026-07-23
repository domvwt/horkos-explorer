const express = require("express");
const router = express.Router();
const process = require("process");
const { apiLimiter, queryLimiter, suggestLimiter } = require("./middleware/RateLimit");

const schema = require("./Schema");
const cypher = require("./Cypher");
const state = require("./State");

router.use("/schema", apiLimiter, schema);
// Progress polling under the general limiter, mounted BEFORE the query-limited
// /cypher router so this more-specific path wins (Express matches in order). A
// 30s query polled at 500ms would otherwise burn ~60 query-limit tokens on
// polling alone. Helmet/body-limit sit on the parent app, so ordering is intact.
router.use("/cypher/progress", apiLimiter, cypher.progressRouter);
router.use("/cypher", queryLimiter, cypher);

// Only enable session endpoints if session storage is not disabled
const isSessionDisabled = process.env.DISABLE_SESSION_DB === "true";
if (!isSessionDisabled) {
    const session = require("./Session");
    router.use("/session", apiLimiter, session);
} else {
    // Session storage disabled: answer every /session request with a JSON
    // 404 (rationale in SessionDisabledRouter.js; pinned by
    // SessionDisabled.test.js).
    const { createSessionDisabledRouter } = require("./SessionDisabledRouter");
    router.use("/session", apiLimiter, createSessionDisabledRouter());
}

router.use("/", apiLimiter, state);

const mode = require("./Mode");
router.use("/mode", apiLimiter, mode);

// Autocomplete endpoint (available if DUCKDB_FILE is configured)
const suggest = require("./Suggest");
router.use("/suggest", suggestLimiter, suggest);

module.exports = router;
