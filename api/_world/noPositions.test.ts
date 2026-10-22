import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../world.ts";

/**
 * The C.E.O.'s Polymarket positions are money: they live behind the passkey (/api/exchange-positions) and reach the
 * Lattice's marquee only in the signed-in browser. Nothing public carries them: not the world feed every visitor's
 * Lattice loads, not the hourly world step, not the simulator (2026-10-22, #268).
 */

const PRIVATE = /positions|pnl|realized|"cost"|"value"|avgPrice|contracts/i;
const was = process.env.WORLD_STORE;
afterEach(() => {
  if (was === undefined) delete process.env.WORLD_STORE;
  else process.env.WORLD_STORE = was;
});

describe("no positions on public paths", () => {
  it("the world feed (/api/world) carries no positions", async () => {
    process.env.WORLD_STORE = "memory";
    const res = await GET(new Request("https://ceo.test/api/world"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(PRIVATE);
  });

  it("asking the world function for positions without the Desk session gets none", async () => {
    const res = await GET(new Request("https://ceo.test/api/world?exchange=positions"));
    expect(res.status).not.toBe(200);
    expect(res.headers.get("cache-control") ?? "").not.toMatch(/public/);
    expect(await res.text()).not.toMatch(/"positions"|pnl/);
  });

  it("neither the world step nor the simulator reads the positions", () => {
    const files = [
      ...readdirSync(new URL(".", import.meta.url)).map((f) => join(new URL(".", import.meta.url).pathname, f)),
      ...readdirSync(new URL("../../packages/simulator/src/", import.meta.url)).map((f) => join(new URL("../../packages/simulator/src/", import.meta.url).pathname, f)),
    ].filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/_exchange\/positions|exchange-positions|desk\/exchange\/positions/);
  });
});
