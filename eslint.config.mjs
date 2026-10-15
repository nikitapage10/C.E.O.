import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "playwright-report/**", "test-results/**", ".claude/*", "!.claude/hooks/"] },
  // The builder guard's hooks (#119): Node.
  { files: [".claude/hooks/*.mjs"], languageOptions: { globals: { ...globals.node } } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // The Desk's service worker (#135): a plain script with the service worker's globals.
  { files: ["apps/world/public/sw.js"], languageOptions: { sourceType: "script", globals: { ...globals.serviceworker } } },
  // Node scripts (the others declare their globals inline); the browser-side code inside page.evaluate reaches the page through globalThis.
  { files: ["scripts/desk-icons.mjs", "scripts/desk-images.mjs", "scripts/portraits.mjs", "scripts/change-card.mjs", "scripts/room-tour.mjs", "scripts/visual-qa.mjs"], languageOptions: { globals: { ...globals.node } } },
  // The Lattice perf probe: Node, plus functions that run inside the page.
  { files: ["scripts/perf-lattice.mjs"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Only the classic hook rules: the React Compiler rules fight three.js's mutable-object style.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
