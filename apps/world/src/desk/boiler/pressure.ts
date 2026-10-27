import { CONNECTIONS, type Connection } from "../connections.ts";
import type { DeskRoom } from "../deskData.ts";
import type { Fitting, GState, PipeRow } from "../systemsGraph.ts";

/**
 * The Boiler Room's pressure (#369, #390): how much of the pipework carries flow, read from the same fittings the rack
 * draws (systemsGraph.ts, pipeRows), so the headline and the lines can never disagree. A fitting is one real connection
 * with its own state: flowing (ok), under load (run: busy or slow), waiting (wait, not connected yet) or broken (bad). Also which
 * entry in connections.ts explains a valve, so tapping one shows how it works, how it signs in and how often. Pure.
 */

export interface Pressure {
  /** Carrying flow: live, or running right now. */
  flowing: number;
  run: number;
  dry: number;
  burst: number;
  total: number;
  /** flowing / total, 0 to 1 (0 with no fittings). */
  share: number;
}

export function pressureOf(fits: { state: GState }[]): Pressure {
  const count = (s: GState) => fits.filter((f) => f.state === s).length;
  const run = count("run");
  const flowing = count("ok") + run;
  const total = fits.length;
  return { flowing, run, dry: count("wait"), burst: count("bad"), total, share: total ? flowing / total : 0 };
}

export const fittingsOf = (r: PipeRow): Fitting[] => [...r.ins, ...r.outs];

/** The whole rack's pressure: every fitting on every pipe (a part two rooms use is two connections, one on each). */
export const rackPressure = (rows: PipeRow[]): Pressure => pressureOf(rows.flatMap(fittingsOf));

/** One pipe's state for its pressure ring: burst wins, then running, then flowing, then dry. */
export function pipeState(r: PipeRow): GState {
  const p = pressureOf(fittingsOf(r));
  if (p.burst || r.stc === "bad") return "bad";
  if (p.run || r.stc === "run") return "run";
  return p.flowing ? "ok" : "wait";
}

/** The headline over the rack, from the real states only, in plain words. */
export function pressureHeadline(p: Pressure): { lead: string; em: string; tone: GState } {
  if (p.burst) return { lead: p.burst === 1 ? "One link is" : `${p.burst} links are`, em: "broken.", tone: "bad" };
  if (!p.flowing) return { lead: "Nothing is", em: "flowing yet.", tone: "wait" };
  if (p.run) return { lead: "Flowing,", em: "under load.", tone: "run" };
  return { lead: "The links are", em: "holding.", tone: "ok" };
}

/** Which connection explains a fitting, where the room changes the answer (GitHub on the world clock is its trigger). */
const BY_FIT: Record<string, string | ((room: string) => string | undefined)> = {
  claude: "claude-api",
  claudecode: "claude-code",
  blob: "blob",
  vercel: "azure-template",
  phone: "desk-pings",
  polymarket: "polymarket",
  sleeper: "sleeper",
  fantasypros: "fantasypros",
  gmail: "gmail",
  paypal: "paypal",
  bluebubbles: "bluebubbles",
  openai: "openai",
  github: (room) => (room === "boiler" ? "world-trigger" : "github-api"),
  gemini: "gemini-visual-qa",
  speech: "elevenlabs-speech",
  lattice: (room) => (room === "relay" ? "hub-socket" : undefined),
};

export function connectionFor(fitId: string, room: string): Connection | undefined {
  const m = BY_FIT[fitId];
  const id = typeof m === "function" ? m(room) : m;
  return id ? CONNECTIONS.find((c) => c.id === id) : undefined;
}

/** Every connection a room owns, live ones first: the detail for a pipe with no whole flow drawn. */
export function roomConnections(room: string): Connection[] {
  return CONNECTIONS.filter((c) => c.room === (room as DeskRoom)).sort((a, b) => Number(a.status === "planned") - Number(b.status === "planned"));
}
