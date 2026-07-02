const express = require("express");
const api = require("./API");
const baseUrl = require("./utils/BaseURL");
const duckdb = require("./utils/DuckDB");

module.exports = (devServer) => {
  duckdb.init();
  devServer.app.use(express.json({ limit: "128mb" }));
  devServer.app.use(`${baseUrl}api`, api);
};
