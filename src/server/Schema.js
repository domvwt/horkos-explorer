const database = require("./utils/Database");
const express = require("express");
const router = express.Router();
const { sendErrorResponse } = require("./utils/errorResponse");

router.get("/", async (_, res) => {
  try {
    // Only cacheable when the DB is opened read-only: that's exactly the
    // condition under which Database.getSchema() itself caches the computed
    // schema (isReadOnlyMode, see utils/Database.js), so a client cache here
    // can never outlive a schema the server itself would recompute.
    if (database.isReadOnlyMode) {
      res.setHeader("Cache-Control", "private, max-age=300");
    }
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
