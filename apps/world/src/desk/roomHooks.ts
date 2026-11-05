import { useMemo } from "react";
import { useChronicle, type RoomId } from "../chronicle.ts";
import { useFoundry } from "../foundry.ts";
import { useSystems } from "../systems.ts";
import { useDesk } from "./deskData.ts";
import { useEmail } from "../../../../rooms/relay/data/email.ts";
import { usePolymarket } from "../../../../rooms/exchange/data/polymarket.ts";
import { setPulseReader } from "./flow/pulse.ts";
import { useGreen } from "../../../../rooms/green/data/league.ts";
import { useNow } from "@ceo/engine/sigils/motion.tsx";
import { roomPulses, type RoomPulse } from "./roomPulse.ts";
import { addPageSource, setTexting, type Texting } from "./skippy/rooms.ts";
import { useInvoices } from "../../../../rooms/spire/data/invoices.ts";

/**
 * Where the rooms plug into the Desk's shared kits (#617, step 3). The kits (flow, Skippy) read no room's data and
 * import no room; the Desk hands them what the rooms offer here, once, as it starts (Desk.tsx imports this first).
 * Every room's part a kit only sometimes needs loads lazily, so this adds nothing to the first load: the stores read
 * here are already in it for Today's pulses (usePulses.ts). As each room moves into rooms/<id>/ (docs/ROOMS.md), its
 * part here moves into its own folder, offered through its manifest.
 */

/**
 * A room's pulse (roomPulse.ts) from the stores the Desk already keeps (#262), for the flow kit's tempo
 * (flow/useTempo.ts, through flow/pulse.ts). It starts nothing and polls nothing of its own: the Foundry and the
 * links run for the whole Desk, and a room's own source (the odds, the league, the invoices, the email counts) is
 * started by that room's page. A source not read yet reads as not connected, and idles.
 */
export function useRoomPulse(room: RoomId | null): RoomPulse | null {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const pending = useFoundry((s) => s.pending);
  const links = useSystems((s) => s.links);
  const world = useChronicle((s) => s.feed);
  const owed = useDesk((s) => s.data.owed.length);
  const board = usePolymarket((s) => s.board);
  const greenStatus = useGreen((s) => s.status);
  const greenBoard = useGreen((s) => s.board);
  const invoices = useInvoices((s) => s.status);
  const email = useEmail((s) => s.status);
  // The Desk's clock already ticks every half minute; "today" only needs the minute.
  const minute = Math.floor(useNow(60_000) / 60_000);
  return useMemo(() => {
    if (!room) return null;
    const at = minute * 60_000;
    const dayStart = new Date(at).setHours(0, 0, 0, 0);
    const hub = links.find((l) => l.id === "hub")?.state ?? "off";
    const lead = board?.top[0];
    const odds = board ? { markets: board.top.length, lead: lead ? { question: lead.question, prob: lead.prob } : null } : null;
    const all = roomPulses({ now: at, dayStart, foundry: { connected, data, pending }, links, hub, owed, world, odds, green: { status: greenStatus, board: greenBoard }, invoices, email });
    return all.find((p) => p.id === room) ?? null;
  }, [room, minute, connected, data, pending, links, owed, world, board, greenStatus, greenBoard, invoices, email]);
}

/* ── Skippy's page block (skippy/page.ts): each live room's own lines, the Green's start/sit calls leading ── */

addPageSource({ room: "green", first: true, lines: () => import("../../../../rooms/green/skippy.ts").then((m) => m.pageLines()) });
addPageSource({ room: "exchange", lines: () => import("../../../../rooms/exchange/skippy.ts").then((m) => m.pageLines()) });

/* ── Texting from Skippy's chat and calls (#536): the Relay's; its card loads with the first text ── */

const loadCard = () =>
  import("../../../../rooms/relay/web/ComposeCard.tsx").then((m) => {
    TEXTING.Card = m.ComposeCard;
  });

const TEXTING: Texting = {
  Card: null,
  start: (who, gist) => Promise.all([import("../../../../rooms/relay/data/compose.ts"), loadCard()]).then(([m]) => m.useCompose.getState().start(who, gist, "chat")),
  talkTools: () => Promise.all([import("../../../../rooms/relay/data/talkTools.ts"), loadCard()]).then(([m]) => m),
};
setTexting(TEXTING);

/* ── The flow kit's tempo ── */

setPulseReader(useRoomPulse);
