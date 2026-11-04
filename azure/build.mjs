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
import { fileURLToPath, pathToFileURL } from "node:url";
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

// Two functions sharing a name (an http route and a timer, say) make the host register none of them, so every /api
// route 404s (#694). Load the bundle against a stand-in for the worker's registry and refuse a duplicate.
{
  const core = join(out, "node_modules/@azure/functions-core");
  mkdirSync(core, { recursive: true });
  writeFileSync(join(core, "package.json"), '{"name":"@azure/functions-core","type":"module","main":"index.mjs"}\n');
  writeFileSync(
    join(core, "index.mjs"),
    "globalThis.__ceoFunctionNames = [];\n" +
      "export const registerFunction = (m) => { globalThis.__ceoFunctionNames.push(m && m.name); return { dispose() {} }; };\n" +
      "export const registerHook = () => ({ dispose() {} });\n" +
      "export const setProgrammingModel = () => {};\n" +
      "export const getProgrammingModel = () => ({});\n",
  );
  try {
    await import(pathToFileURL(join(out, "index.mjs")).href);
    const names = globalThis.__ceoFunctionNames;
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (names.length === 0) throw new Error("the Functions bundle registered no functions");
    if (dupes.length > 0) throw new Error(`duplicate function names in the Functions bundle: ${dupes.join(", ")}`);
    console.log(`${names.length} functions, names unique`);
  } finally {
    rmSync(join(out, "node_modules"), { recursive: true, force: true });
  }
}

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
