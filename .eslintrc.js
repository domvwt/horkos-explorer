module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  extends: [
    'plugin:vue/vue3-recommended',
    'eslint:recommended',
  ],
  parserOptions: {
    parser: '@babel/eslint-parser',
    ecmaVersion: 2022,
  },
  rules: {
    // QueryValidator.js documents comment-stripping with a zero-width space
    // holding a literal `*/` inside a doc comment; don't flag comments.
    'no-irregular-whitespace': ['error', { skipComments: true }],
  },
}
