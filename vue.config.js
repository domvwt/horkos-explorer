const { defineConfig } = require("@vue/cli-service");
const configureAPI = require("./src/server/Configure");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
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
  pages: {
    index: {
      entry: "src/main.js",
      title: "Horkos Explorer",
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
        sassOptions: {
          // Bootstrap 5.3.8's SCSS (pulled in via the prelude above) still uses
          // deprecated global Sass built-ins (mix(), map-get(), unit(), …) and
          // @import, and sass-loader 13 drives Dart Sass through its own
          // deprecated legacy JS API. None of that is fixable from this repo, so
          // silence exactly those dependency-origin deprecation channels. Our
          // own SCSS emits no deprecations, so this does not mask anything we
          // could act on; remove ids here if/when Bootstrap and sass-loader are
          // upgraded. quietDeps additionally quiets any other dependency-origin
          // deprecation without silencing our own code.
          quietDeps: true,
          silenceDeprecations: [
            "legacy-js-api",
            "global-builtin",
            "import",
            "color-functions",
            "if-function",
          ],
        },
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
        // Content-hashed so CDN immutable caching can't serve a stale worker
        // after a Monaco upgrade; the plugin wires the emitted URL into
        // MonacoEnvironment itself, so no consumer references the filename.
        filename: '[name].worker.[contenthash:8].js',
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
    ],
  }
});
