const sessionDb = require("./utils/SessionDatabase");
const express = require("express");
const router = express.Router();
const { sendErrorResponse } = require("./utils/errorResponse");

router.get("/settings", async (_, res) => {
  try {
    const settings = await sessionDb.getSetting();
    res.send(settings);
  } catch (err) {
    return sendErrorResponse(res, err, {
      clientMessage: "Failed to load settings",
      logContext: "Session getSetting failed",
    });
  }
});

router.post("/settings", async (req, res) => {
  try {
    await sessionDb.setSetting(req.body);
    res.send({ success: true });
  } catch (err) {
    return sendErrorResponse(res, err, {
      clientMessage: "Failed to save settings",
      logContext: "Session setSetting failed",
    });
  }
});

router.get("/history", async (_, res) => {
  try {
    const history = await sessionDb.getHistoryItems();
    res.send(history);
  } catch (err) {
    return sendErrorResponse(res, err, {
      clientMessage: "Failed to load history",
      logContext: "Session getHistoryItems failed",
    });
  }
});

router.delete("/history/:uuid", async (req, res) => {
  try {
    await sessionDb.deleteHistoryItem(req.params.uuid);
    res.send({ success: true });
  } catch (err) {
    return sendErrorResponse(res, err, {
      clientMessage: "Failed to delete history item",
      logContext: "Session deleteHistoryItem failed",
    });
  }
});

module.exports = router;
