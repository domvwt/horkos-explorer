const express = require("express");
const api = require("./API");
const baseUrl = require("./utils/BaseURL");
const duckdb = require("./utils/DuckDB");
const applyAppSecurity = require("./middleware/AppSecurity");

module.exports = (devServer) => {
  duckdb.init();
  // Mirror the production app-level hardening (index.js) so the dev server does
  // not diverge on trust-proxy keying or emitted security headers: helmet,
  // trust-proxy normalisation and X-Robots-Tag all behave identically here. Must
  // run before the router mount so req.ip is resolved via the same trust-proxy
  // setting the per-route rate limiters and row budget key on.
  applyAppSecurity(devServer.app);
  // Mirror the production body-parser cap (index.js) so dev matches prod; the
  // largest legitimate JSON body is a Cypher query (capped at 50KB by
  // QueryValidator) or a small import config. Multipart CSV/Parquet uploads use
  // multer and are unaffected by this limit.
  devServer.app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }));
  devServer.app.use(`${baseUrl}api`, api);
};
