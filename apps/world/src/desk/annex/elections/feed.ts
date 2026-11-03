import { useEffect, useRef, useState } from "react";
import { newCalls, type ElectionBoard, type Race } from "./model.ts";

/**
 * Election night's feed (#618): GET /api/annex-elections every 45 seconds while the page is showing and the pop-up is
 * live. The server shares one civicAPI read between every viewer, so this never reaches civicAPI itself. Unmounting
 * (or archiving the pop-up) stops the timer: nothing runs while it is on the Shelf.
 */

export const POLL_MS = 45_000;
const PATH = "/api/annex-elections";

export type FeedStatus = "loading" | "ready" | "failed" | "archived";

const isRace = (r: unknown): r is Race => {
  const x = r as Partial<Race> | null;
  return !!x && typeof x.id === "number" && typeof x.state === "string" && typeof x.name === "string" && typeof x.reporting === "number" && Array.isArray(x.candidates);
};

export function readBoard(v: unknown): ElectionBoard | null {
  const b = v as Partial<ElectionBoard> | null;
  if (!b || typeof b !== "object" || !Array.isArray(b.races) || !b.source || !b.tally) return null;
  return { ...(b as ElectionBoard), races: b.races.filter(isRace) };
}

export function useElections(): { status: FeedStatus; board: ElectionBoard | null; checkedAt: number | null; flash: Set<number>; refresh: () => void } {
  const [status, setStatus] = useState<FeedStatus>("loading");
  const [board, setBoard] = useState<ElectionBoard | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [flash, setFlash] = useState<Set<number>>(new Set());
  const prev = useRef<Race[] | null>(null);
  const tick = useRef<() => void>(() => {});

  useEffect(() => {
    let alive = true;
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const res = await fetch(PATH, { headers: { Accept: "application/json" }, credentials: "same-origin" });
        const body = (res.headers.get("content-type") ?? "").includes("json") ? await res.json() : null;
        if (!alive) return;
        if (body && (body as { archived?: boolean }).archived) {
          setStatus("archived");
        } else {
          const next = body && res.ok ? readBoard(body) : null;
          if (next) {
            if (next.races.length) {
              const fresh = newCalls(prev.current, next.races);
              if (fresh.size) setFlash(fresh);
              prev.current = next.races;
            }
            setBoard((was) => (next.races.length || !was ? next : { ...was, source: next.source }));
            setStatus("ready");
          } else setStatus((s) => (s === "ready" ? s : "failed"));
        }
        setCheckedAt(Date.now());
      } catch {
        if (alive) {
          setStatus((s) => (s === "ready" ? s : "failed"));
          setCheckedAt(Date.now());
        }
      } finally {
        busy = false;
      }
    };
    tick.current = () => void read();
    void read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, POLL_MS);
    const back = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  // A new call glows for a few seconds, then settles.
  useEffect(() => {
    if (!flash.size) return;
    const t = window.setTimeout(() => setFlash(new Set()), 6000);
    return () => window.clearTimeout(t);
  }, [flash]);

  return { status, board, checkedAt, flash, refresh: () => tick.current() };
}
