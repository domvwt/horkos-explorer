import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "module";

// The server code under test is CommonJS; load it the same way the server does.
const require = createRequire(import.meta.url);
const express = require("express");
const http = require("http");
const {
  createSessionDisabledRouter,
} = require("./SessionDisabledRouter");

// When DISABLE_SESSION_DB=true the /api/session/* routes are not backed by the
// SQLite session store. API.js mounts the router built by
// SessionDisabledRouter.js, which answers every method/subpath with a JSON 404
// ({ "error": ... }) instead of letting the request fall past the static
// handler to Express's default HTML 404 page ("Cannot GET ..."). These tests
// pin that contract: a security probe hitting a session endpoint under
// DISABLE_SESSION_DB must get a machine-readable JSON 404, never HTML.
//
// Two layers are covered:
//  1. The handler contract — the PRODUCTION factory (imported above; the same
//     module API.js mounts) is driven over real HTTP. If the factory's status,
//     body shape, or catch-all routing drifts, these tests fail.
//  2. The env gating — the REAL API.js is required with DISABLE_SESSION_DB=true
//     (with only the Kuzu-backed Database module faked in the require cache,
//     since loading the native engine is far too heavy for a unit test) and the
//     mounted /api/session/* route is asserted end-to-end. If the else branch
//     in API.js is deleted or its condition changes, this fails.

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

describe("SessionDisabledRouter — production handler contract", () => {
  let server;
  let base;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    // Same mounting shape as API.js: the factory's router under /session.
    router.use("/session", createSessionDisabledRouter());
    // Stand in for the HTML 404 fallthrough that would otherwise answer any
    // /api path the router did not handle. If the stub above did NOT intercept,
    // the request would reach this and return HTML — the exact drift these
    // tests guard against.
    router.use((_, res) => {
      res
        .status(200)
        .type("html")
        .send("<!doctype html><html><body>SPA</body></html>");
    });
    app.use("/api", router);
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("returns a JSON 404 (not HTML) for GET /api/session/history", async () => {
    const res = await fetch(`${base}/api/session/history`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns a JSON 404 for GET /api/session/settings", async () => {
    const res = await fetch(`${base}/api/session/settings`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toHaveProperty("error");
  });

  it("returns a JSON 404 for POST /api/session/settings (all methods stubbed)", async () => {
    const res = await fetch(`${base}/api/session/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "light" }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toHaveProperty("error");
  });

  it("returns a JSON 404 for DELETE /api/session/history/:uuid (subpaths stubbed)", async () => {
    const res = await fetch(`${base}/api/session/history/abc-123`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toHaveProperty("error");
  });

  it("does NOT serve the HTML fallthrough for a session path", async () => {
    const res = await fetch(`${base}/api/session/history`);
    const text = await res.text();
    expect(text).not.toMatch(/<!doctype html>/i);
  });
});

describe("API.js — DISABLE_SESSION_DB=true mounts the JSON-404 stub (env gating)", () => {
  let server;
  let base;
  const savedEnv = {};
  const ENV_KEYS = ["DISABLE_SESSION_DB", "NODE_ENV"];
  const databaseId = require.resolve("./utils/Database");
  const apiId = require.resolve("./API");

  beforeAll(async () => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
    }
    process.env.DISABLE_SESSION_DB = "true";
    process.env.NODE_ENV = "test";

    // API.js pulls in ./utils/Database transitively (Schema.js, Cypher.js and
    // Mode.js all require it at module top level), and that module loads the
    // native Kuzu addon AND constructs its singleton at require time — far too
    // heavy for a unit test. Pre-populate the require cache with a minimal fake
    // BEFORE requiring API.js so the REAL router module (and its session
    // gating) loads untouched.
    require.cache[databaseId] = {
      id: databaseId,
      filename: databaseId,
      loaded: true,
      exports: {
        getAccessModeString: () => "READ_ONLY",
      },
    };
    delete require.cache[apiId]; // make sure API.js evaluates under this env

    const api = require("./API");
    const app = express();
    app.use(express.json());
    app.use("/api", api);
    ({ server, base } = await listen(app));
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    // Drop the fake Database and the env-specific API.js evaluation so no
    // later require in this process can pick them up: this evaluation was
    // built against the fake Database under mutated env, so it must never be
    // served from the cache again. Future requires re-evaluate fresh.
    delete require.cache[databaseId];
    delete require.cache[apiId];
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
  });

  it("answers /api/session/history with the JSON 404 through the real router", async () => {
    const res = await fetch(`${base}/api/session/history`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toHaveProperty("error");
  });

  it("stubs writes and subpaths through the real router too", async () => {
    const res = await fetch(`${base}/api/session/history/probe-uuid`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toHaveProperty("error");
  });
});
