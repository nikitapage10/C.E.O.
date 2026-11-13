import { create } from "zustand";
import type { UsageReport, WasteFlag } from "../../../api/_usage/aggregate.ts";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { readUsage, USAGE_PATH } from "./tokenomics.ts";

/**
 * The worst token-waste flag from the Tokenomics report (#1152), for the Boiler Room's thread on the Desk. It reads
 * the same GET /api/boiler-usage the tab does (the passkey session only, last 7 days), once when the Desk shows its
 * pulses and every ten minutes after. No model calls. Signed out, unset or failed, there is no flag and nothing changes.
 */

const POLL_MS = 10 * 60_000;

/** The flag worth a warning: the report sorts "warn" flags first, biggest cost first. "info" flags never warn. */
export function worstWaste(report: Pick<UsageReport, "flags"> | null | undefined): WasteFlag | null {
  return report?.flags?.find((f) => f.tone === "warn") ?? null;
}

/** The flag's name in a few words, for the thread's status line. */
export function wasteName(f: WasteFlag): string {
  const where = f.feature ? ` in ${f.feature}` : "";
  switch (f.kind) {
    case "duplicate":
      return `repeat calls${where}`;
    case "cache":
      return `cache missing${where}`;
    case "oversized":
      return "oversized prompts";
    case "fallback":
      return "Gemini fallbacks";
    case "cutoff":
      return "cut-off answers";
    case "errors":
      return "failing calls";
    default:
      return `token waste${where}`;
  }
}

interface WasteStore {
  flag: WasteFlag | null;
  set: (flag: WasteFlag | null) => void;
}

export const useWaste = create<WasteStore>((set) => ({ flag: null, set: (flag) => set({ flag }) }));

async function pull(): Promise<void> {
  try {
    const res = await fetch(`${USAGE_PATH}?days=7`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
    const state = await readUsage(res);
    useWaste.getState().set(state.status === "ready" ? worstWaste(state.report) : null);
  } catch {
    useWaste.getState().set(null);
  }
}

/** Start reading while the pulses show; returns the stop. Does nothing signed out. */
export function startWaste(): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const sync = (signedIn: boolean) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (!signedIn) {
      useWaste.getState().set(null);
      return;
    }
    void pull();
    timer = setInterval(() => void pull(), POLL_MS);
  };
  sync(useDeskAuth.getState().auth.status === "in");
  let was = useDeskAuth.getState().auth.status === "in";
  const unsub = useDeskAuth.subscribe((s) => {
    const now = s.auth.status === "in";
    if (now !== was) {
      was = now;
      sync(now);
    }
  });
  return () => {
    unsub();
    if (timer) clearInterval(timer);
  };
}
