import { ROOM_IDS, type RoomId } from "@ceo/core";
import { useMemo } from "react";
import { navigateTo, useSearch } from "../route.ts";

/**
 * What the Lattice shows (#332), read from its address:
 *
 * - `/lattice`               the map: the ring in 2D, crew dots moving between rooms. Nothing 3D loads.
 * - `/lattice?room=relay`    one room in 3D: that room's models, crew and pets only (the Desk's room links).
 * - `/lattice?view=ring`     the whole Lattice in 3D, as before #332 (`&room=relay` opens it on that room).
 *
 * Kept free of three.js: the map reads it before any of the 3D has loaded.
 */
export type LatticeView = { kind: "map" } | { kind: "room"; room: RoomId } | { kind: "ring"; room: RoomId | null };

const asRoom = (v: string | null): RoomId | null => (v && (ROOM_IDS as readonly string[]).includes(v) ? (v as RoomId) : null);

export function viewOf(search: string): LatticeView {
  const q = new URLSearchParams(search);
  const room = asRoom(q.get("room"));
  if (q.get("view") === "ring") return { kind: "ring", room };
  if (room) return { kind: "room", room };
  return { kind: "map" };
}

/** One string per view, for keying the 3D world: a different view mounts a fresh one (and lets the last one go). */
export const viewKey = (v: LatticeView) => (v.kind === "room" ? `room:${v.room}` : v.kind);

/** The address of a view. Switches the page reads once (?instant, ?speed, ?seed…) are kept so tests stay as asked. */
export function viewPath(v: LatticeView, search = typeof window === "undefined" ? "" : window.location.search): string {
  const q = new URLSearchParams(search);
  q.delete("room");
  q.delete("view");
  if (v.kind === "room") q.set("room", v.room);
  if (v.kind === "ring") {
    q.set("view", "ring");
    if (v.room) q.set("room", v.room);
  }
  // URLSearchParams spells a bare switch "instant="; keep it bare.
  const s = q.toString().replace(/=(?=&|$)/g, "");
  return `/lattice${s ? `?${s}` : ""}`;
}

export function goToView(v: LatticeView) {
  navigateTo(viewPath(v));
}

export function useLatticeView(): LatticeView {
  const search = useSearch();
  return useMemo(() => viewOf(search), [search]);
}
