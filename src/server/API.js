const express = require("express");
const router = express.Router();
const process = require("process");
const logger = require("./utils/Logger");
const MODES = require("./utils/Constants").MODES;
const { apiLimiter, queryLimiter, suggestLimiter } = require("./middleware/RateLimit");


const isWasmMode = process.env.KUZU_WASM &&
    process.env.KUZU_WASM.toLowerCase() === "true";

// APIs that are only available in backend mode
if (!isWasmMode) {
    const database = require("./utils/Database");
    const currentMode = database.getAccessModeString();
    const schema = require("./Schema");
    const cypher = require("./Cypher");
    const state = require("./State");
    const reset = require("./Reset");
    const importApi = require("./Import");

    router.use("/schema", apiLimiter, schema);
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
    if (currentMode === MODES.READ_WRITE) {
        router.use("/reset", reset);
        router.use("/import", importApi);
    }
} else {
    logger.info("Running in WebAssembly mode, some APIs are disabled");
}

// APIs that are available in both backend and wasm mode
const mode = require("./Mode");
router.use("/mode", apiLimiter, mode);

// Autocomplete endpoint (available if DUCKDB_FILE is configured)
const suggest = require("./Suggest");
router.use("/suggest", suggestLimiter, suggest);

module.exports = router;
