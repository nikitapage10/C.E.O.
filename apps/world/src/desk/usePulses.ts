import { useEffect, useMemo } from "react";
import { useWorldFeed } from "../chronicle.ts";
import { useFoundry } from "../foundry.ts";
import { useSystems } from "../systems.ts";
import { startPolymarket, usePolymarket } from "./exchange/polymarket.ts";
import { startEmail, useEmail } from "./email/email.ts";
import { startGreen, useGreen } from "./green/league.ts";
import { roomPulses, type RoomPulse } from "./roomPulse.ts";
import { startInvoices, useInvoices } from "./spire/invoices.ts";

/** How far back the day's strip on Today reaches, so the knots never empty out just after midnight. */
export const DAY_STRIP_MS = 14 * 3_600_000;

/** The nine rooms' pulses from the live stores (roomPulse.ts), recomputed when any of them changes. */
export function usePulses(owed: number, now: number): RoomPulse[] {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const pending = useFoundry((s) => s.pending);
  const links = useSystems((s) => s.links);
  const world = useWorldFeed().feed;
  const hub = links.find((l) => l.id === "hub")?.state ?? "off";
  // The Exchange's thread is real (#253): read Polymarket's public odds while the pulses are showing.
  useEffect(() => startPolymarket(), []);
  const board = usePolymarket((s) => s.board);
  const markets = board?.top.length ?? 0;
  const leadQ = board?.top[0]?.question ?? null;
  const leadP = board?.top[0]?.prob ?? null;
  // The Green's thread is real (#252): read the league while the Desk is open (edge-cached for two minutes).
  useEffect(() => startGreen(), []);
  const greenStatus = useGreen((s) => s.status);
  const greenBoard = useGreen((s) => s.board);
  // The Spire's thread is real on the Azure copy (#279): PayPal's invoice counts.
  useEffect(() => startInvoices(), []);
  const invoices = useInvoices((s) => s.status);
  // Relay's email line is real on the Azure copy (#263, #322): its public counts, until the Mac's hub joins it.
  useEffect(() => startEmail(), []);
  const email = useEmail((s) => s.status);
  const minute = Math.floor(now / 60_000);
  return useMemo(() => {
    const at = minute * 60_000;
    const d = new Date(at);
    d.setHours(0, 0, 0, 0);
    return roomPulses({ now: at, dayStart: d.getTime(), since: Math.min(d.getTime(), at - DAY_STRIP_MS), foundry: { connected, data, pending }, links, hub, owed, world, odds: board ? { markets, lead: leadQ !== null && leadP !== null ? { question: leadQ, prob: leadP } : null } : null, green: { status: greenStatus, board: greenBoard }, invoices, email });
  }, [connected, data, pending, links, hub, owed, world, minute, board, markets, leadQ, leadP, greenStatus, greenBoard, invoices, email]);
}
