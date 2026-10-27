import { usePolymarket } from "../exchange/polymarket.ts";
import { useGreen } from "../green/league.ts";
import { useSystems } from "../../systems.ts";
import { ASK_ERROR, speak, useSkippy, type Turn } from "./chat.ts";
import { WAIT_MAX_MS, gaveUpText, lookForAnswer, pollEvery } from "./handoff.ts";
import { pageContext } from "./page.ts";

/**
 * The chat's side of a hand-off's round trip (#341), loaded on its own the first time the chat opens or its box is
 * focused (chat.ts, `loadRoundTrip`), so the Desk's first load carries none of it: the page's data for Skippy's quick
 * take, and the one timer that waits on every pending bubble.
 */

export { WAIT_ROOMS, pendingText } from "./handoff.ts";

/** The page's data for Skippy's quick take (page.ts): from what the Desk already loaded, no extra reads. */
export function pageNow(): string {
  try {
    return pageContext({ path: typeof window === "undefined" ? "/" : window.location.pathname, green: useGreen.getState().board, exchange: usePolymarket.getState().board, links: useSystems.getState().links });
  } catch {
    return "";
  }
}

/* ── Waiting on a hand-off (#341, handoff.ts): one timer for every pending bubble, only while the tab is showing ── */

let watching: ReturnType<typeof setTimeout> | null = null;

/** Replaces a pending bubble in place with the answer that came back, or with where it will show when the wait is over. */
function settle(id: number, patch: Partial<Turn>): void {
  useSkippy.setState((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, pending: undefined, ...patch } : t)) }));
}

/** Looks for every pending hand-off's answer now, then again after a while, until none is left. */
export function watchHandoffs(doFetch: typeof fetch = fetch, first = pollEvery(0)): void {
  if (watching !== null) return;
  const look = async () => {
    watching = null;
    const waiting = useSkippy.getState().turns.filter((t) => t.pending);
    if (!waiting.length) return;
    const now = Date.now();
    const showing = typeof document === "undefined" || document.visibilityState !== "hidden";
    if (showing) {
      for (const t of waiting) {
        const p = t.pending!;
        if (now - p.since > WAIT_MAX_MS) {
          settle(t.id, { text: gaveUpText(p.needs, p.room), note: true });
          continue;
        }
        const got = await lookForAnswer(p, doFetch);
        if (got === "signed-out") return settle(t.id, { text: ASK_ERROR["signed-out"], note: true });
        if (got && got.final === false) {
          // An interim answer (#480): shown in the bubble, which keeps waiting for the final one.
          if (got.at === p.seen) continue;
          useSkippy.setState((s) => ({ turns: s.turns.map((x) => (x.id === t.id ? { ...x, text: got.text, from: got.from, pending: { ...p, seen: got.at } } : x)) }));
          const { open, voice } = useSkippy.getState();
          if (!open) useSkippy.setState({ unread: true });
          if (voice) speak(got.text);
        } else if (got) {
          settle(t.id, { text: got.text, from: got.from, ...(got.card && { card: got.card }) });
          const { open, voice } = useSkippy.getState();
          if (!open) useSkippy.setState({ unread: true });
          if (voice) speak(got.text);
        }
      }
    }
    const left = useSkippy.getState().turns.filter((t) => t.pending);
    if (!left.length) return;
    const oldest = Math.min(...left.map((t) => t.pending!.since));
    watching = setTimeout(() => void look(), pollEvery(Date.now() - oldest));
  };
  watching = setTimeout(() => void look(), first);
}

if (typeof document !== "undefined") {
  // Back on the tab: look straight away rather than at the next tick.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !useSkippy.getState().turns.some((t) => t.pending)) return;
    if (watching !== null) clearTimeout(watching);
    watching = null;
    watchHandoffs(fetch, 0);
  });
}

