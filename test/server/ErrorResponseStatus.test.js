import { describe, it, expect } from "vitest";

// errorResponse.js only depends on the logger (pino), so importing it does not
// touch any database. This covers the admission-control 503 mapping path:
// Cypher.js catches a LoadShedError and calls sendErrorResponse with the
// error's carried status (503), rather than the default 400.
import { sendErrorResponse } from "../../src/server/utils/errorResponse.js";

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("sendErrorResponse status handling", () => {
  it("defaults to 400 when no status is provided", () => {
    const res = mockRes();
    sendErrorResponse(res, new Error("boom"), { clientMessage: "nope" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "nope" });
  });

  it("honours an explicit status (e.g. 503 for admission-control shed load)", () => {
    const res = mockRes();
    sendErrorResponse(res, new Error("at capacity"), {
      status: 503,
      clientMessage: "Server is at capacity, please retry shortly",
    });
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      error: "Server is at capacity, please retry shortly",
    });
  });

  it("never leaks the raw error message to the client", () => {
    const res = mockRes();
    sendErrorResponse(res, new Error("Binder exception: internal table foo"), {
      status: 503,
      clientMessage: "Server is at capacity, please retry shortly",
    });
    expect(JSON.stringify(res.body)).not.toContain("Binder exception");
  });
});

describe("LoadShedError status shape (mirrors Database.js)", () => {
  // The Database module opens a Kuzu database on import, so we cannot import it
  // in a DB-free unit test. This locks in the contract the Cypher.js 503
  // mapping relies on: a shed error carries a 503 `.status`. If Database.js's
  // LoadShedError definition changes, this documents the expected shape.
  it("a shed error carrying status 503 maps to a 503 response", () => {
    class LoadShedErrorLike extends Error {
      constructor(message) {
        super(message);
        this.name = "LoadShedError";
        this.status = 503;
      }
    }
    const err = new LoadShedErrorLike("too many in flight");
    expect(err.status).toBe(503);

    const res = mockRes();
    sendErrorResponse(res, err, {
      status: err.status ? err.status : 503,
      clientMessage: "Server is at capacity, please retry shortly",
    });
    expect(res.statusCode).toBe(503);
  });
});
