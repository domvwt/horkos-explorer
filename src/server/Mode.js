const express = require("express");
const router = express.Router();
const database = require("./utils/Database");
const MODES = require("./utils/Constants").MODES;
const { sendErrorResponse } = require("./utils/errorResponse");

const isWasmMode = process.env.KUZU_WASM &&
  process.env.KUZU_WASM.toLowerCase() === "true";

router.get("/", async (_, res) => {
  const isProduction = true;
  // The access mode is frozen at server startup (see CLAUDE.md "Access Mode
  // Immutability") and cannot change without a restart, so the response is
  // safe for a client (browser/proxy) to cache briefly.
  res.setHeader("Cache-Control", "private, max-age=300");
  try {
    const mode = database.getAccessModeString();
    if (isWasmMode && mode !== MODES.DEMO) {
      return res.send({
        mode: MODES.WASM,
        isProduction,
      });
    }
    res.send({
      mode,
      isProduction,
    });
  } catch (err) {
    return sendErrorResponse(res, err, {
      clientMessage: "Failed to determine access mode",
      logContext: "Mode fetch failed",
    });
  }
});

module.exports = router;
