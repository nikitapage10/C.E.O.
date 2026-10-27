/**
 * The live rooms' reads for Skippy (#478, api/_skippy/rooms.ts), from the server's own settings: the same reads the
 * Desk's room pages make. The Green's board (api/_green/route.ts readBoard) and the Commentator's saved take, Relay's
 * counts (the email agent's status, counts and states only), the Exchange's open positions (Polymarket US, signed with
 * the key that lives only in the Function App), and the main branch's checks from GitHub. Each module loads only when
 * its read runs, so a chat that never needs one costs nothing for it. A room whose keys aren't set here is left out.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { githubToken } from "../_github.js";
import { pickBlob } from "../_blob.js";
import type { CheckRead, ExchangeRead, RoomReads } from "./rooms.js";

const GH = "https://api.github.com/repos/nikitapage10/C.E.O.";
/** The workflows whose last run on main the Boiler Room shows. */
const WORKFLOWS = [
  ["checks.yml", "checks"],
  ["deploy-azure.yml", "deploy"],
] as const;

/** The positions, read at most once a minute per warm function. */
let exchangeKept: { at: number; value: ExchangeRead } | null = null;

export function liveRoomReads(env: Record<string, string | undefined> = process.env): RoomReads {
  const blob = pickBlob(env);
  const reads: RoomReads = {
    green: async () => {
      const route = await import("../_green/route.js");
      return route.readBoard(route.liveDeps());
    },
    checks: async () => {
      const token = await githubToken("read").catch(() => "");
      const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const runs = await Promise.all(
        WORKFLOWS.map(async ([file, name]): Promise<CheckRead | null> => {
          const res = await fetch(`${GH}/actions/workflows/${file}/runs?branch=main&per_page=1`, { headers, signal: AbortSignal.timeout(2_000) }).catch(() => null);
          if (!res?.ok) return null;
          const run = ((await res.json().catch(() => null)) as { workflow_runs?: { status?: unknown; conclusion?: unknown }[] } | null)?.workflow_runs?.[0];
          if (!run || typeof run.status !== "string") return null;
          return { name, status: run.status, conclusion: typeof run.conclusion === "string" ? run.conclusion : null };
        }),
      );
      return runs.filter((r): r is CheckRead => r !== null);
    },
  };
  if (blob) {
    reads.take = async () => {
      const { BlobAnalysisStore } = await import("../_green/analysis.js");
      return (await new BlobAnalysisStore(blob).load()).analysis;
    };
  }
  if (env.GMAIL_TOKEN_KEY) {
    reads.relay = async () => {
      const { pickEmailStore } = await import("../_email/store.js");
      return (await pickEmailStore(env)?.status()) ?? null;
    };
  }
  if (env.POLYMARKET_US_KEY_ID) {
    reads.exchange = async () => {
      if (exchangeKept && Date.now() - exchangeKept.at < 60_000) return exchangeKept.value;
      const { keyFrom, readPositions } = await import("../_exchange/positions.js");
      const key = keyFrom(env);
      if ("error" in key) return null;
      const live = await readPositions((url, init) => fetch(url, init), key, Date.now());
      const value = { open: live.totals.open, value: live.totals.value, pnl: live.totals.pnl };
      exchangeKept = { at: Date.now(), value };
      return value;
    };
  }
  return reads;
}
