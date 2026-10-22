import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type Rolldown } from "vite";

type OutputChunk = Rolldown.OutputChunk;

/**
 * A short content hash for every model under public/models, keyed by its path there ("lib/custom/Rocky.glb"). The
 * app asks for each model as `…glb?v=<hash>`, so the browser can keep a model for good (vercel.json) and still
 * picks up a new one the moment it changes.
 */
function modelVersions(): Record<string, string> {
  const root = fileURLToPath(new URL("./public/models", import.meta.url));
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".glb")) out[relative(root, path).split("\\").join("/")] = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 10);
    }
  };
  walk(root);
  return out;
}

/**
 * The Desk prefetches the Lattice's code: `<link rel="prefetch">` for every chunk and stylesheet behind the lazy
 * import of App.tsx that the Desk doesn't load itself. The browser fetches them when it's idle, at the lowest
 * priority, without running them, so "Enter the Lattice" starts from its cache.
 */
function prefetchLattice(): Plugin {
  return {
    name: "ceo:prefetch-lattice",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return;
        const chunks = Object.values(bundle).filter((c): c is OutputChunk => c.type === "chunk");
        const byName = new Map(chunks.map((c) => [c.fileName, c]));
        const entry = chunks.find((c) => c.isEntry);
        const app = chunks.find((c) => c.facadeModuleId?.replace(/\\/g, "/").endsWith("/src/App.tsx"));
        if (!entry || !app) return;
        const walk = (c: OutputChunk, into: Set<string>) => {
          if (into.has(c.fileName)) return;
          into.add(c.fileName);
          for (const f of c.imports) {
            const next = byName.get(f);
            if (next) walk(next, into);
          }
        };
        const desk = new Set<string>();
        walk(entry, desk);
        const lattice = new Set<string>();
        walk(app, lattice);
        const files = [...lattice].filter((f) => !desk.has(f));
        const css = files.flatMap((f) => [...(byName.get(f)?.viteMetadata?.importedCss ?? [])]);
        return [...files, ...css].map((f) => ({ tag: "link", attrs: { rel: "prefetch", href: `/${f}` }, injectTo: "head" as const }));
      },
    },
  };
}

/**
 * Fails the build when the `vendor` chunk imports anything but rolldown's runtime. Every page loads `vendor` first,
 * so an import from an app chunk back into it is a cycle that can run React before what it needs exists, and the
 * site stops at the boot screen while every unit test still passes (#169).
 */
function checkChunks(): Plugin {
  return {
    name: "ceo:check-chunks",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk" || chunk.name !== "vendor") continue;
        const bad = chunk.imports.filter((f) => !/(^|\/)rolldown-runtime-[^/]*\.js$/.test(f));
        if (bad.length) this.error(`vendor must import nothing but rolldown-runtime, but imports ${bad.join(", ")}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), prefetchLattice(), checkChunks()],
  server: { host: true },
  define: { __MODEL_VERSIONS__: JSON.stringify(modelVersions()) },
  build: {
    chunkSizeWarningLimit: 2500,
    // Fonts are always files, never inlined as data: URIs: the site's CSP allows fonts from 'self' only, and Manrope's
    // smallest subsets fall under Vite's 4 kB inline limit.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        // Two library chunks that change rarely, so returning visitors keep them cached between deploys:
        // `vendor` is what the Desk needs (React, zustand), `three` is three.js and everything the Lattice adds.
        // The Desk must load without three.js, so the groups take only what their test names, not a matched
        // module's dependencies (which would fold React into `three` and three.js into the Desk).
        // Taking only what a group names can leave chunks importing each other, and rolldown's runtime helpers
        // (`__commonJS`, `__toESM`) land in whatever app chunk is shared most. With the Desk tabs lazy (#169) that
        // was a chunk that imports `vendor` while `vendor`, CommonJS React, imports the helpers from it: `vendor`
        // ran first, called a helper that didn't exist yet ("t is not a function") and every page stopped at the
        // boot screen. Strict execution order (rolldown's advice for `includeDependenciesRecursively: false`) runs
        // each module only when it's first needed, puts the helpers in a `rolldown-runtime` chunk of their own and
        // keeps any cycle between chunks harmless. checkChunks() fails the build if `vendor` ever imports app code.
        strictExecutionOrder: true,
        advancedChunks: {
          includeDependenciesRecursively: false,
          groups: [
            { name: "vendor", test: /node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store|zod|@fontsource|@fontsource-variable)[\\/]/ },
            { name: "three", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
