import { useEffect, useRef } from "react";
import { useFoundry, type Change } from "../../foundry.ts";
import { useHide } from "../hide.ts";
import type { RoomPulse } from "../roomPulse.ts";
import { useDeskAuth } from "../signin.ts";
import { useSkippy } from "../skippy/chat.ts";
import { useRoomFeed, type FeedEvent } from "../skippy/roomFeed.ts";
import { RC } from "../wvCanvas.ts";
import { GOLD } from "./stage.ts";
import { RISES } from "./sand.ts";
import { safeTitle } from "../flow/rise.ts";

/**
 * What makes words rise on Today (#413): only real events, said in neutral words. When Today opens, the Council
 * reports in: each room with real work says its short state ("mid-build", "3 links up"), with anything the Foundry
 * shipped in the last hour. After that: a change shipped ("shipped #412"), a post on a submind's thread, a room whose
 * state moves, an answer from Skippy. Now and then, when nothing has happened for a while, one room with real work says
 * its state again. Public view: never a message's words, only what kind of thing happened; signed in (and Hide off),
 * a submind's post may show its own title when it carries no money, address, link or long number. Rate limits live in
 * sand.ts.
 */

export { safeTitle } from "../flow/rise.ts";

export const shippedLine = (c: Change) => (c.issue ? `shipped #${c.issue.number}` : "shipped a change");

const MURMUR_MS = 55_000;
const RECENT_MS = 3_600_000;

export function useRiseFeed(pulses: RoomPulse[]) {
  const changelog = useFoundry((s) => s.data.changelog);
  const feed = useRoomFeed((s) => s.events);
  const feedFull = useRoomFeed((s) => s.full);
  const signedIn = useDeskAuth((s) => s.auth.status === "in");
  const hide = useHide((s) => s.on);
  const turns = useSkippy((s) => s.turns);
  const seen = useRef<{ ship: Set<string> | null; feed: Set<string> | null; short: Map<string, string> | null; turns: number }>({ ship: null, feed: null, short: null, turns: -1 });
  const live = useRef(pulses);
  live.current = pulses;

  // The roll call, once, a moment after the page opens.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const now = Date.now();
      for (const p of live.current) if (p.real && p.state !== "sim") RISES.push({ room: p.id, text: p.short, rgb: RC[p.id] ?? GOLD });
      for (const c of useFoundry.getState().data.changelog.filter((x) => now - x.at < RECENT_MS && x.at <= now).slice(0, 2)) RISES.push({ room: "foundry", text: shippedLine(c), rgb: RC.foundry! });
    }, 900);
    return () => window.clearTimeout(id);
  }, []);

  // Shipped since the page opened.
  useEffect(() => {
    const s = seen.current;
    if (!s.ship) {
      if (changelog.length) s.ship = new Set(changelog.map((c) => c.key));
      return;
    }
    for (const c of changelog) {
      if (s.ship.has(c.key)) continue;
      s.ship.add(c.key);
      RISES.push({ room: "foundry", text: shippedLine(c), rgb: RC.foundry! });
    }
  }, [changelog]);

  // A post on a submind's thread.
  useEffect(() => {
    const s = seen.current;
    if (!s.feed) {
      if (feed.length) s.feed = new Set(feed.map((e) => e.id));
      return;
    }
    for (const e of feed as FeedEvent[]) {
      if (s.feed.has(e.id)) continue;
      s.feed.add(e.id);
      const own = signedIn && feedFull && !hide ? safeTitle(e.title) : null;
      RISES.push({ room: e.room, text: own ?? "posted to its thread", rgb: RC[e.room] ?? GOLD });
    }
  }, [feed, feedFull, signedIn, hide]);

  // A room whose state moves.
  useEffect(() => {
    const s = seen.current;
    const first = !s.short;
    s.short ??= new Map();
    for (const p of pulses) {
      const was = s.short.get(p.id);
      s.short.set(p.id, p.short);
      if (!first && was !== undefined && was !== p.short && p.real) RISES.push({ room: p.id, text: p.short, rgb: RC[p.id] ?? GOLD });
    }
  }, [pulses]);

  // Skippy answers (his words stay in the chat; only that he answered rises).
  useEffect(() => {
    const s = seen.current;
    const answers = turns.filter((t) => t.who === "skippy" && !t.note && !t.pending).length;
    if (s.turns >= 0 && answers > s.turns) {
      const last = turns.filter((t) => t.who === "skippy" && !t.note && !t.pending).at(-1);
      const from = last?.from && last.from !== "skippy" ? last.from : null;
      RISES.push({ room: "kernel", text: from ? "handed it on" : "answered you", rgb: GOLD });
    }
    s.turns = answers;
  }, [turns]);

  // Now and then, when the room is quiet, one room with real work says where it stands.
  useEffect(() => {
    let k = 0;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden" || RISES.busy) return;
      const real = live.current.filter((p) => p.real && p.state !== "sim");
      if (!real.length) return;
      const p = real[k++ % real.length]!;
      RISES.push({ room: p.id, text: p.short, rgb: RC[p.id] ?? GOLD });
    }, MURMUR_MS);
    return () => window.clearInterval(id);
  }, []);
}
