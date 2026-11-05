import { useEffect, useState } from "react";
import { floorMessage, type FloorItem } from "../../../../api/_today/floor.ts";
import { readAsked, type AskedTurn } from "../skippy/asked.ts";
import { ASK_ERROR, useSkippy } from "../skippy/chat.ts";

/**
 * A reply to an item on Today's floor that is Skippy's (api/_today/floor.ts), browser side. A yes on a Repair or a
 * Decision goes straight to Skippy, the Magnificent (POST /api/skippy { floor, message }, kept in the `kernel` log and
 * handed to him, no model); anything else goes into Skippy's chat with the item as its context, and Skippy decides
 * (his own hand-off, when he makes one, is waited on there as usual). Either way the item keeps the hand-off's turn
 * id, and the floor shows where it stands from the same log the chat waits on (`useHanded`).
 */

export type Sent = { ok: true; turn?: string } | { ok: false; message: string };

/** Hands an approved item to Skippy, the Magnificent. */
export async function handToSkippy(item: FloorItem, said: string, doFetch: typeof fetch = fetch): Promise<Sent> {
  try {
    const res = await doFetch("/api/skippy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ floor: item, message: said.slice(0, 600) }), credentials: "same-origin" });
    if (res.status === 401) return { ok: false, message: ASK_ERROR["signed-out"] };
    if (res.status === 422) return { ok: false, message: ASK_ERROR.held };
    if (res.status === 429) return { ok: false, message: ASK_ERROR.slow };
    if (res.status === 503 || res.status === 404) return { ok: false, message: ASK_ERROR.off };
    const body = (await res.json().catch(() => ({}))) as { turn?: unknown };
    if (!res.ok || typeof body.turn !== "string" || !/^[0-9a-f]{16}$/.test(body.turn)) return { ok: false, message: ASK_ERROR.failed };
    return { ok: true, turn: body.turn };
  } catch {
    return { ok: false, message: ASK_ERROR.failed };
  }
}

/** Anything else said to an item: into Skippy's chat with the item as its context. The hand-off's turn, if he made one. */
export async function askSkippyAbout(item: FloorItem, said: string): Promise<Sent> {
  const chat = useSkippy.getState();
  chat.setOpen(true);
  const reply = await chat.send(floorMessage(item, said));
  if (!reply) return { ok: false, message: useSkippy.getState().turns.at(-1)?.text || ASK_ERROR.failed };
  const pending = useSkippy.getState().turns.find((t) => t.id > reply.id && t.pending);
  return { ok: true, ...(pending?.pending && { turn: pending.pending.turn }) };
}

/** How often the floor looks for a hand-off's answer while one is still open. */
export const HANDED_POLL_MS = 30_000;

type FollowUp = NonNullable<AskedTurn["followUp"]>;

/**
 * Where the floor's hand-offs stand: each turn's answer from the `kernel` log (the signed-in read the chat waits on),
 * read now and then every 30 seconds while one is still open and the tab is showing.
 */
export function useHanded(turns: string[], doFetch: typeof fetch = fetch): Map<string, FollowUp> {
  const [got, setGot] = useState<Map<string, FollowUp>>(() => new Map());
  const sig = [...new Set(turns)].sort().join(",");
  useEffect(() => {
    if (!sig) return;
    const want = sig.split(",");
    let dead = false;
    let timer: number | undefined;
    const look = async () => {
      let open = true;
      if (typeof document === "undefined" || document.visibilityState !== "hidden") {
        try {
          const res = await doFetch("/api/skippy-log?room=kernel", { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
          const read = res.ok && (res.headers.get("content-type") ?? "").includes("json") ? readAsked(await res.json(), "kernel") : null;
          if (read && !dead) {
            const next = new Map<string, FollowUp>();
            for (const t of read) if (t.id && want.includes(t.id) && t.followUp) next.set(t.id, t.followUp);
            setGot(next);
            open = want.some((id) => !next.has(id) || next.get(id)!.final === false);
          }
          if (res.status === 401 || res.status === 404) open = false;
        } catch {
          /* tried again on the next tick */
        }
      }
      if (!dead && open) timer = window.setTimeout(() => void look(), HANDED_POLL_MS);
    };
    void look();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [sig, doFetch]);
  return got;
}
