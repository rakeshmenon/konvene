import { defineConfig } from "vitest/config";

export default defineConfig({
  // tests run against the development build, so the localhost origin is recognised
  define: { __DEV_BUILD__: "true" },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.js"],
  },
});
