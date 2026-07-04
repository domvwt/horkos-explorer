const database = require("./utils/Database");
const express = require("express");
const router = express.Router();
const { sendErrorResponse } = require("./utils/errorResponse");

router.get("/", async (_, res) => {
  try {
    const schema = await database.getSchema();
    res.send(schema);
  } catch (err) {
    return sendErrorResponse(res, err, {
      clientMessage: "Failed to load schema",
      logContext: "Schema fetch failed",
    });
  }
});

module.exports = router;
