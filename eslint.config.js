// Lint: catches mistakes, not style. `npm run lint`
import js from "@eslint/js";
import globals from "globals";

export default [
  // extensions/ are separate packages with their own tests and browser globals (see extensions/call-recorder/README.md)
  { ignores: ["dist/", "node_modules/", "test-results/", "shots/", "extensions/"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.browser, __KONVENE__: "readonly" } },
  },
  {
    files: ["*.js", "*.mjs", "scripts/**", "server/**", "netlify/**", "api/**", "functions/**", "tests/**"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
