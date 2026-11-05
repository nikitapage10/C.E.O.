import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import rooms from "./scripts/eslint-rooms.mjs";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "playwright-report/**", "test-results/**", ".claude/*", "!.claude/hooks/"] },
  // The builder guard's hooks (#119): Node.
  { files: [".claude/hooks/*.mjs"], languageOptions: { globals: { ...globals.node } } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // The Desk's service worker (#135): a plain script with the service worker's globals.
  { files: ["apps/world/public/sw.js"], languageOptions: { sourceType: "script", globals: { ...globals.serviceworker } } },
  // Node scripts (the others declare their globals inline); the browser-side code inside page.evaluate reaches the page through globalThis.
  { files: ["scripts/desk-icons.mjs", "scripts/desk-images.mjs", "scripts/portraits.mjs", "scripts/change-card.mjs", "scripts/room-tour.mjs", "scripts/boot-check.mjs", "scripts/visual-qa.mjs", "scripts/seed-azure-pull.mjs", "scripts/seed-azure-public.mjs", "scripts/stack-facts.mjs", "scripts/stack-facts-lib.mjs"], languageOptions: { globals: { ...globals.node } } },
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
  // ESLint 10's new no-useless-assignment flags the guard's `let reason = null` default. The guard is Nikita's to
  // change (never-list, docs/FOUNDRY.md), so the rule stays off for that one file rather than editing it.
  { files: [".claude/hooks/guard-hook.mjs"], rules: { "no-useless-assignment": "off" } },
  // The room contract's boundaries (#617, docs/ROOMS.md; scripts/eslint-rooms.mjs). Errors in the new layout: no room
  // imports another, the engine imports no rooms, room web reaches lore only via @ceo/engine/lore. The contract test
  // is the one engine file that loads the rooms, to check their manifests.
  {
    files: ["rooms/**/*.{ts,tsx}", "packages/engine/**/*.{ts,tsx}"],
    ignores: ["packages/engine/src/contract.test.ts"],
    plugins: { ceo: rooms },
    rules: { "ceo/room-boundary": "error" },
  },
  // A room's api reads its keys through the engine (`readKey`, for names in its manifest's `keys`), never process.env.
  {
    files: ["rooms/*/api/**/*.{ts,tsx}"],
    rules: { "no-restricted-properties": ["error", { object: "process", property: "env", message: "Read keys through the engine (readKey), for names in the room's manifest keys (docs/ROOMS.md)." }] },
  },
  // The Desk's shared kits (flow, skippy, confluence, hologram, hero) import no rooms; the rooms plug in (desk/roomHooks.ts).
  { files: ["apps/world/src/desk/**/*.{ts,tsx}"], plugins: { ceo: rooms }, rules: { "ceo/desk-boundary": "error" } },
);
