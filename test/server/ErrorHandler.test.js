import { describe, it, expect } from "vitest";
import express from "express";

import globalErrorHandler from "../../src/server/middleware/ErrorHandler.js";

// Minimal express app per test, mounting the real handler as the last
// middleware - mirrors the mounting order in src/server/index.js (after
// routes/static). Each route throws/forwards a specific error shape so we
// can assert the handler's mapping end-to-end via a real request, following
// the pattern used by other test/server/*.test.js suites that spin up a
// listener (see SessionDisabled.test.js).
function buildApp() {
  const app = express();
  app.use(express.json());

  app.get("/boom-large", (req, res, next) => {
    const err = new Error("request entity too large");
    err.type = "entity.too.large";
    next(err);
  });

  app.get("/boom-parse", (req, res, next) => {
    // Shape body-parser's read.js actually produces: http-errors'
    // createError(400, err, { type: 'entity.parse.failed' }) mutates the
    // SyntaxError in place, adding type AND status/statusCode = 400 (see
    // node_modules/body-parser/lib/read.js and node_modules/http-errors).
    const err = new SyntaxError("Unexpected token in JSON");
    err.type = "entity.parse.failed";
    err.status = 400;
    err.statusCode = 400;
    next(err);
  });

  app.get("/boom-app-syntax-error", (req, res, next) => {
    // An app-thrown bare SyntaxError - no err.type/status/statusCode, unlike
    // a real body-parser error. Must NOT be misclassified as a 400 client
    // error; it should fall through to the generic 500 path.
    next(new SyntaxError("unexpected token in app code: /etc/passwd"));
  });

  app.get("/boom-cors", (req, res, next) => {
    const err = new Error("Not allowed by CORS");
    err.isCorsRejection = true;
    next(err);
  });

  app.get("/boom-generic", (req, res, next) => {
    next(new Error("some sensitive internal detail: /etc/passwd leaked path"));
  });

  app.get("/boom-headers-sent", (req, res, next) => {
    res.status(200).send("partial");
    next(new Error("late failure after headers sent"));
  });

  app.use(globalErrorHandler);
  return app;
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

describe("globalErrorHandler", () => {
  it("maps entity.too.large to 413 JSON", async () => {
    const { server, base } = await listen(buildApp());
    try {
      const res = await fetch(`${base}/boom-large`);
      expect(res.status).toBe(413);
      const body = await res.json();
      expect(body).toEqual({ error: "Request body too large" });
    } finally {
      server.close();
    }
  });

  it("maps a body-parser entity.parse.failed SyntaxError (type + status set) to 400 JSON", async () => {
    const { server, base } = await listen(buildApp());
    try {
      const res = await fetch(`${base}/boom-parse`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({ error: "Malformed request body" });
    } finally {
      server.close();
    }
  });

  it("falls through a bare app-thrown SyntaxError (no type/status) to the generic 500, never a 400", async () => {
    const { server, base } = await listen(buildApp());
    try {
      const res = await fetch(`${base}/boom-app-syntax-error`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: "Internal server error" });
      expect(JSON.stringify(body)).not.toContain("/etc/passwd");
    } finally {
      server.close();
    }
  });

  it("maps a CORS rejection to 403 JSON", async () => {
    const { server, base } = await listen(buildApp());
    try {
      const res = await fetch(`${base}/boom-cors`);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toEqual({ error: "Origin not allowed" });
    } finally {
      server.close();
    }
  });

  it("maps anything else to a fixed 500 JSON message, never leaking err.message", async () => {
    const { server, base } = await listen(buildApp());
    try {
      const res = await fetch(`${base}/boom-generic`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toEqual({ error: "Internal server error" });
      expect(JSON.stringify(body)).not.toContain("/etc/passwd");
      expect(JSON.stringify(body)).not.toContain("sensitive internal detail");
    } finally {
      server.close();
    }
  });

  it("never includes a stack trace in the response body", async () => {
    const { server, base } = await listen(buildApp());
    try {
      const res = await fetch(`${base}/boom-generic`);
      const text = await res.text();
      expect(text).not.toContain("at ");
      expect(text).not.toContain(".js:");
    } finally {
      server.close();
    }
  });

  it("delegates to next(err) when headers are already sent, instead of sending a second response", async () => {
    const { server, base } = await listen(buildApp());
    try {
      const res = await fetch(`${base}/boom-headers-sent`);
      // The original 200 response body ("partial") must win - Express's
      // default handler for an error after headersSent just closes/destroys
      // the connection rather than sending a new body.
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("partial");
    } finally {
      server.close();
    }
  });
});
