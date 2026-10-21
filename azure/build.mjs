/* global console */
// Builds the Functions package (docs/AZURE.md): one bundled file with every dependency inside, plus host.json and
// a package.json, in azure/dist/app, ready to zip-deploy to the Flex Consumption app. No npm install in the
// package: everything comes from the repo's own locked node_modules, so Azure runs the same versions Vercel does.
//
//   npm run build:azure            (from the repo root; npm ci first)
//   → azure/dist/app/{index.mjs, host.json, package.json}, and azure/dist/functions.zip when `zip` is on the PATH

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const out = join(dist, "app");
rmSync(dist, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  configFile: false,
  root: here,
  logLevel: "warn",
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: join(here, "src/index.ts"),
    outDir: out,
    emptyOutDir: false,
    target: "node22",
    minify: false,
    sourcemap: false,
    rollupOptions: {
      // Provided by the Functions worker itself, never bundled.
      external: ["@azure/functions-core"],
      output: {
        format: "es",
        entryFileNames: "index.mjs",
        codeSplitting: false,
        // CommonJS dependencies inside an ES module still call require() for Node's own modules.
        banner: 'import { createRequire as __ceoCreateRequire } from "node:module"; const require = __ceoCreateRequire(import.meta.url);',
      },
    },
  },
});

copyFileSync(join(here, "host.json"), join(out, "host.json"));
writeFileSync(
  join(out, "package.json"),
  JSON.stringify({ name: "ceo-functions", private: true, type: "module", main: "index.mjs" }, null, 2) + "\n",
);

try {
  execFileSync("zip", ["-qr", join(dist, "functions.zip"), "."], { cwd: out, stdio: "ignore" });
  console.log("azure/dist/functions.zip ready");
} catch {
  console.log("azure/dist/app ready (no zip on the PATH: zip that folder's contents to deploy)");
}
