const express = require("express");
const router = express.Router();
const database = require("./utils/Database");
const MODES = require("./utils/Constants").MODES;
const { sendErrorResponse } = require("./utils/errorResponse");

router.post("/", async (_, res) => {
  try {
    const mode = database.getAccessModeString();
    if (mode === MODES.DEMO) {
      return res.status(400).send({
        error: "Cannot reset Kuzu in live demo mode.",
      });
    }
    await database.reset();
    return res.send({ message: "Kuzu has been reset." });
  } catch (err) {
    return sendErrorResponse(res, err, {
      clientMessage: "Failed to reset database",
      logContext: "Database reset failed",
    });
  }
});

module.exports = router;
