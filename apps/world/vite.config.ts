import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: { host: true },
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
            { name: "vendor", test: /node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/ },
            { name: "three", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
});
