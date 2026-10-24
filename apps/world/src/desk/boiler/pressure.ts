import { CONNECTIONS, type Connection } from "../connections.ts";
import type { DeskRoom } from "../deskData.ts";
import type { Fitting, GState, PipeRow } from "../systemsGraph.ts";

/**
 * The Boiler Room's pressure (#369): how much of the pipework carries flow, read from the same fittings the manifold
 * draws (systemsGraph.ts, pipeRows), so the gauge and the pipes can never disagree. A fitting is one real connection
 * with its own state: flowing (ok), running hot (run), dry (wait, not connected yet) or burst (bad, down). Also which
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

/** The headline the gauge reads out, from the real states only. */
export function pressureHeadline(p: Pressure): { lead: string; em: string; tone: GState } {
  if (p.burst) return { lead: p.burst === 1 ? "A pipe has" : `${p.burst} pipes have`, em: "burst.", tone: "bad" };
  if (!p.flowing) return { lead: "The boiler is", em: "cold.", tone: "wait" };
  if (p.run) return { lead: "The pipes are", em: "running hot.", tone: "run" };
  return { lead: "The pipes are", em: "holding.", tone: "ok" };
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
  gemini: (room) => (room === "archive" ? "gemini-speech" : "gemini-visual-qa"),
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

/**
 * Where each fitting sits along a pipe of `width` px, with the keeper's hub at `hub`: what feeds the room evenly
 * before it (in slots of `slot` px, right-aligned to the hub so every rack's hubs line up), what it feeds spread
 * evenly after it, and the outlet cap at the end.
 */
export function pipeLayout(r: PipeRow, width: number, hub: number, slot: number, pad: number): { ins: number[]; outs: number[]; end: number } {
  const end = Math.max(hub + 40, width - pad);
  const ins = r.ins.map((_, i) => hub - (r.ins.length - i) * slot);
  const n = r.outs.length;
  const outs = r.outs.map((_, i) => hub + ((end - hub) * (i + 1)) / (n + 0.6));
  return { ins, outs, end };
}
