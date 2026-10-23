import { submindOf } from "@ceo/simulator";
import { useEffect } from "react";
import { newEvents, readPublicFeed } from "../desk/skippy/roomFeed.ts";
import { useWorld } from "../store.ts";

/** How often the Lattice reads the room feed (real ms). */
const POLL_MS = 120_000;
/** An event this fresh when the Lattice opens is still worth saying once. */
const FRESH_MS = 30 * 60_000;

/**
 * The room feed in the Lattice (#281): when a submind posts a room event from its thread (api/_room/feed.ts), it says
 * the title from its podium, if it is home and the tab is visible. Always the public view (?view=public): the title
 * scrubbed of money and links on the server, never a detail. Each event is said at most once per page load; a quiet
 * feed, or one that isn't there (Vercel, a local preview), says nothing. Renders nothing.
 */
export function RoomFeedDirector() {
  useEffect(() => {
    const seen = new Set<string>();
    const opened = Date.now() - FRESH_MS;
    let timer = 0;
    let stopped = false;
    const read = async () => {
      if (document.visibilityState === "visible") {
        const got = await readPublicFeed();
        if (stopped) return;
        if (got.status === "off") return; // no feed on this copy: stop asking
        const w = useWorld.getState();
        for (const e of newEvents(got.events, seen, opened)) {
          const lead = submindOf(e.room);
          const me = w.lattice.agents[lead.id];
          if (me && me.place.room === e.room) w.say(lead.id, e.title);
        }
      }
      if (!stopped) timer = window.setTimeout(() => void read(), POLL_MS);
    };
    timer = window.setTimeout(() => void read(), 15_000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}
