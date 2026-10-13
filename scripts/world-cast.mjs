// Writes api/_world/cast.ts, the cast as the hourly world step sees it, from packages/simulator (docs/WORLD.md).
// Run it after changing the cast: `npm run world:cast`. Node 22.18+ reads the TypeScript directly.
/* global URL, console */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderWorldCast } from "../packages/simulator/src/worldCast.ts";

const out = fileURLToPath(new URL("../api/_world/cast.ts", import.meta.url));
writeFileSync(out, renderWorldCast());
console.log(`wrote ${out}`);
