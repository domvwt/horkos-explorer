import { describe, it, expect } from "vitest";

import {
  isHashedAsset,
  setStaticCacheHeaders,
} from "../../src/server/utils/staticCache.js";

describe("isHashedAsset", () => {
  it("matches typical webpack content-hashed js/css filenames", () => {
    expect(isHashedAsset("app.4f3a9c21.js")).toBe(true);
    expect(isHashedAsset("chunk-vendors.0a1b2c3d.css")).toBe(true);
    // Longer hash segments (contenthash can exceed 8 chars) still match.
    expect(isHashedAsset("app.4f3a9c21ab.js")).toBe(true);
    // Dash-delimited hash segment.
    expect(isHashedAsset("index-1a2b3c4d.js")).toBe(true);
  });

  it("does not match unhashed static files", () => {
    expect(isHashedAsset("index.html")).toBe(false);
    expect(isHashedAsset("kuzu_wasm_worker.js")).toBe(false);
    expect(isHashedAsset("duckdb-mvp.wasm")).toBe(false);
    expect(isHashedAsset("codicon.ttf")).toBe(false);
    expect(isHashedAsset("cypher.worker.js")).toBe(false);
  });

  it("does not false-positive on a short hex-looking segment", () => {
    // 7 hex chars: below the 8-char floor, must not match.
    expect(isHashedAsset("app.1a2b3c4.js")).toBe(false);
  });

  it("does not false-positive on a normal name containing a hex-looking word without delimiters on both sides", () => {
    // "deadbeef" is a real word-like token but not isolated as its own
    // dot/dash-delimited segment before the extension here.
    expect(isHashedAsset("deadbeefmodule.js")).toBe(false);
  });

  it("handles empty/undefined input safely", () => {
    expect(isHashedAsset("")).toBe(false);
    expect(isHashedAsset(undefined)).toBe(false);
  });
});

function mockRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

describe("setStaticCacheHeaders", () => {
  it("sets no-cache for .html files", () => {
    const res = mockRes();
    setStaticCacheHeaders(res, "/dist/index.html");
    expect(res.headers["Cache-Control"]).toBe("no-cache");
  });

  it("sets a 1-year immutable cache for hashed assets", () => {
    const res = mockRes();
    setStaticCacheHeaders(res, "/dist/js/app.4f3a9c21.js");
    expect(res.headers["Cache-Control"]).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("sets a 1-day cache for everything else (wasm/fonts/unhashed)", () => {
    const res = mockRes();
    setStaticCacheHeaders(res, "/dist/js/duckdb-mvp.wasm");
    expect(res.headers["Cache-Control"]).toBe("public, max-age=86400");

    const res2 = mockRes();
    setStaticCacheHeaders(res2, "/dist/fonts/codicon.ttf");
    expect(res2.headers["Cache-Control"]).toBe("public, max-age=86400");
  });
});
