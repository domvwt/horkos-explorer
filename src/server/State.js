const express = require("express");
const router = express.Router();
const database = require("./utils/Database");
const { sendErrorResponse } = require("./utils/errorResponse");

router.get("/", async (_, res) => {
  try {
    const version = await database.getDbVersion();
    res.send({
      status: "ok",
      version: version.version,
      storageVersion: version.storageVersion,
      mode: database.getAccessModeString(),
    });
  } catch (err) {
    // Without this catch a rejected getDbVersion() escapes the async handler:
    // on Express 4.18.2 it never sends a response (client hangs) and Node's
    // default unhandledRejection behaviour can crash the process.
    return sendErrorResponse(res, err, {
      clientMessage: "Failed to load database status",
      logContext: "State fetch failed",
    });
  }
});

module.exports = router;
