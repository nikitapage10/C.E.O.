/* global console */
// Builds Relay's Mac hub into one file the site serves (#535, docs/RELAY-PRIVACY.md, "Installing on the Mac"): the
// installer (`curl -fsSL https://ceo.nikita.page/relay/install.sh | bash`) fetches it, so the Mac needs no repo checkout.
//
//   npm run build -w @ceo/hub   (the root `npm run build` runs it after the site's build)
//   → apps/world/dist/relay/{relay-hub.mjs, relay-hub.mjs.sha256, install.sh (with the hub's SHA-256 stamped in)}

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { stampInstaller } from "./stamp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "world", "dist", "relay");
mkdirSync(out, { recursive: true });

await build({
  configFile: false,
  root: here,
  logLevel: "warn",
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: join(here, "src/main.ts"),
    outDir: out,
    emptyOutDir: false,
    target: "node22",
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "relay-hub.mjs",
        codeSplitting: false,
        banner: 'import { createRequire as __ceoCreateRequire } from "node:module"; const require = __ceoCreateRequire(import.meta.url);',
      },
    },
  },
});

const bundle = readFileSync(join(out, "relay-hub.mjs"));
if (bundle.includes("@anthropic-ai/sdk") || bundle.includes("x-api-key")) throw new Error("the hub bundle must not carry a model client");
const sha = createHash("sha256").update(bundle).digest("hex");
writeFileSync(join(out, "relay-hub.mjs.sha256"), `${sha}  relay-hub.mjs\n`);
// The installer checks the hub against the hash stamped into it here.
writeFileSync(join(out, "install.sh"), stampInstaller(readFileSync(join(here, "install.sh"), "utf8"), sha), { mode: 0o644 });
console.log(`apps/world/dist/relay ready (${Math.round(bundle.length / 1024)} KB)`);
