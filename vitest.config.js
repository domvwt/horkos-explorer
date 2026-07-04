import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure helper modules need no DOM.
    environment: "node",
    include: ["src/**/*.test.js", "test/**/*.test.js"],
  },
});
