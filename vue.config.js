const { defineConfig } = require("@vue/cli-service");
const path = require("path");
const DUCKDB_DIST = path.dirname(require.resolve("@duckdb/duckdb-wasm"));
const KUZUDB_WASM_DIST = path.dirname(require.resolve("kuzu-wasm"));
const configureAPI = require("./src/server/Configure");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const BASE_URL = require("./src/server/utils/BaseURL");
const { assertLegalConfigDeployable } = require("./src/config/legal.config");

// Fail a PRODUCTION build if the Art. 14 privacy notice still has unfilled
// [SET AT DEPLOY] values, so an incomplete legal notice can never be shipped.
// Dev builds/serve (NODE_ENV !== 'production') are unaffected — the values are
// meant to be placeholders during development.
if (process.env.NODE_ENV === "production") {
  assertLegalConfigDeployable();
}

module.exports = defineConfig({
  // Do not emit .map files in production builds. Vue CLI defaults this to true,
  // which would ship readable source maps exposing the frontend source to any
  // public visitor. This is a public read-only deployment, so disable them.
  productionSourceMap: false,
  devServer: {
    onAfterSetupMiddleware: configureAPI,
    historyApiFallback: false,
  },
  // In development: only transpile dependencies that need it (fast startup)
  // In production: transpile all dependencies for maximum compatibility
  transpileDependencies: process.env.NODE_ENV === 'production'
    ? true
    : ['@antv', 'antlr4ng'],
  publicPath: BASE_URL,
  chainWebpack: (config) => {
    // Exclude Kuzu WASM worker from Terser minification (has malformed JS)
    config.optimization.minimizer('terser').tap((args) => {
      if (args[0]) {
        args[0].exclude = args[0].exclude
          ? [].concat(args[0].exclude, /kuzu_wasm_worker\.js$/)
          : /kuzu_wasm_worker\.js$/;
      }
      return args;
    });
  },
  pages: {
    index: {
      entry: "src/main.js",
      title: "Kuzu Explorer",
    },
  },
  css: {
    loaderOptions: {
      sass: {
        // Globally load bootstrap variables and functions
        additionalData: `
          @import "~/node_modules/bootstrap/scss/_functions.scss";
          @import "~/node_modules/bootstrap/scss/_variables.scss";
          `,
      },
    },
  },
  configureWebpack: {
    cache: {
      type: 'filesystem',
      buildDependencies: {
        config: [__filename],
      },
    },
    module: {
      rules: [
        {
          test: /\.ttf$/,
          type: 'asset/resource'
        }
      ]
    },
    plugins: [
      new MonacoWebpackPlugin({
        publicPath: BASE_URL,
        filename: '[name].worker.js',
        // Only include languages needed for Cypher editor
        // This dramatically reduces build time and bundle size
        languages: ['cypher', 'json'],
        // Disable features not needed for a simple query editor
        features: [
          'bracketMatching',
          'clipboard',
          'contextmenu',
          'find',
          'folding',
          'hover',
          'indentation',
          'multicursor',
          'suggest',
          'wordHighlighter',
          'wordOperations',
        ],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: DUCKDB_DIST,
            to: "js",
          },
        ],
        options: {
          concurrency: 100,
        },
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: KUZUDB_WASM_DIST,
            to: "js",
          },
        ],
        options: {
          concurrency: 100,
        },
      }),
    ],
  }
});
