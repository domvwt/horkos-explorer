const express = require("express");

/**
 * Factory for the /api/session/* stub mounted when DISABLE_SESSION_DB=true.
 *
 * With server-side session storage disabled, the frontend is localStorage-only
 * and already tolerates a failed /api/session/* call (MainLayout.vue /
 * ShellMainView.vue catch and fall back). Without this stub an unmatched
 * /session/* request falls past the static handler to Express's default HTML
 * 404 page ("Cannot GET ..."), so a security probe expecting a JSON API
 * response gets HTML instead. The stub answers EVERY method and subpath under
 * its mount point with an explicit JSON 404 so the disabled state is
 * machine-readable.
 *
 * Exported as a factory (rather than a singleton router) so API.js and the
 * handler-level test (SessionDisabled.test.js) build their routers from the
 * SAME production code path — the test would catch this branch being deleted
 * or its status/body shape drifting.
 */
function createSessionDisabledRouter() {
  const router = express.Router();
  router.use((_, res) => {
    res.status(404).send({ error: "Session storage is disabled" });
  });
  return router;
}

module.exports = { createSessionDisabledRouter };
