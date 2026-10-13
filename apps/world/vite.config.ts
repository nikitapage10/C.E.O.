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

export default defineConfig({
  plugins: [react(), prefetchLattice()],
  server: { host: true },
  define: { __MODEL_VERSIONS__: JSON.stringify(modelVersions()) },
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // Two library chunks that change rarely, so returning visitors keep them cached between deploys:
        // `vendor` is what the Desk needs (React, zustand), `three` is three.js and everything the Lattice adds.
        // The Desk must load without three.js, so the groups take only what their test names, not a matched
        // module's dependencies (which would fold React into `three` and three.js into the Desk).
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
