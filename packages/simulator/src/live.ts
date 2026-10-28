import type { RoomId } from "@ceo/core";

/**
 * The rooms whose agents are live: played by real work, not by the demo (Nikita, 2026-10-22: "when I actually activate
 * something, it doesn't leave the fake demo data in there"). The one list; the simulator reads it and never runs demo
 * work (tasks, progress, approvals) for an agent whose home is here. Agents in a live room still walk their rounds,
 * idle and banter in character; their tasks come from the real thing (the Foundry's GitHub issues), and their room in
 * the Lattice shows the real numbers.
 *
 * - foundry: GitHub issues worked by the Foundry thread (docs/FOUNDRY.md).
 * - relay: the first real agent's line (its practice post stopped, #94); email live on the Azure copy since
 *   2026-10-23 (#263, #322), the tubes and the inbox board driven by its public counts; texts (#535) from the Mac
 *   hub's public counts, the Switchboard's lamps and the outbox beacon driven by them (docs/RELAY-PRIVACY.md).
 * - exchange: Polymarket's live odds and Nikita's positions (#240, #253).
 * - green: Nikita's Sleeper league and FantasyPros (#252).
 * - boiler: the pipes report the real lines; Drop and Clause only tend them (walk their rounds, banter; no demo tasks).
 *
 * When a room goes live, add it here in the same change that wires it up (CLAUDE.md, "Real agents").
 */
export const LIVE_ROOMS: ReadonlySet<RoomId> = new Set<RoomId>(["foundry", "relay", "exchange", "green", "boiler"]);

export const isLiveRoom = (room: RoomId): boolean => LIVE_ROOMS.has(room);
