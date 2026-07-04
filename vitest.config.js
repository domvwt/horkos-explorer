import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Match the Vue CLI default "@" -> "src" alias so modules that import via
  // "@/..." resolve under vitest too.
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // Pure helper modules need no DOM.
    environment: "node",
    include: ["src/**/*.test.js", "test/**/*.test.js"],
  },
});
