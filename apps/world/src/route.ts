import { useSyncExternalStore } from "react";

/**
 * The app's few addresses. The Desk lives at `/` (Today), `/foundry`, `/relay` and one page per room: `/boiler` (with
 * its Security and Compliance subpages), `/archive`, `/spire`, `/exchange`, `/green`, `/workshop` and `/studio`; the 3D Lattice
 * at `/lattice`. The old `/systems` and `/chronicle` addresses still open the Boiler Room and the Archive (#225).
 * Kept free of imports on purpose: the Desk loads this, and must not pull in anything from the Lattice.
 */
export type Route = "today" | "foundry" | "relay" | "boiler" | "archive" | "spire" | "exchange" | "green" | "workshop" | "studio" | "lattice";

/** The rooms with a page of their own past Today, the Foundry and Relay. */
export const ROOM_ROUTES = ["archive", "spire", "exchange", "green", "workshop", "studio", "boiler"] as const;
export type RoomRoute = (typeof ROOM_ROUTES)[number];

const first = (pathname: string) => pathname.split("/")[1] ?? "";

export function routeOf(pathname: string): Route {
  const p = first(pathname);
  if (p === "lattice") return "lattice";
  if (p === "relay") return "relay";
  if (p === "foundry") return "foundry";
  if (p === "boiler" || p === "systems") return "boiler";
  if (p === "archive" || p === "chronicle") return "archive";
  if ((ROOM_ROUTES as readonly string[]).includes(p)) return p as RoomRoute;
  return "today";
}

/** An old address's new spelling (`/systems/security` is `/boiler/security` now), or null when it is current. */
export function renamedPath(pathname: string): string | null {
  const p = first(pathname);
  if (p === "systems") return "/boiler" + pathname.slice("/systems".length);
  if (p === "chronicle") return "/archive" + pathname.slice("/chronicle".length);
  return null;
}

export const PATHS: Record<Route, string> = {
  today: "/",
  foundry: "/foundry",
  relay: "/relay",
  boiler: "/boiler",
  archive: "/archive",
  spire: "/spire",
  exchange: "/exchange",
  green: "/green",
  workshop: "/workshop",
  studio: "/studio",
  lattice: "/lattice",
};

const listeners = new Set<() => void>();
let movedAt = 0;
/** When the page last moved (a link, or the back and forward buttons), in performance.now() time; 0 for its first load. */
export const lastMove = () => movedAt;
const moved = () => (movedAt = performance.now());
if (typeof window !== "undefined") window.addEventListener("popstate", moved);
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  window.addEventListener("popstate", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("popstate", fn);
  };
};

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => routeOf(window.location.pathname));
}

/** The current path, kept in step with in-app navigation: the Boiler Room reads its subpage (`/boiler/security`) from it. */
export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

/** Go somewhere without reloading the page (keeps the query string when staying inside the Lattice). */
export function navigate(route: Route, search = "") {
  navigateTo(PATHS[route] + search);
}

/** Go to any path inside the app (a subpage) without reloading the page. */
export function navigateTo(path: string) {
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState(null, "", path);
  moved();
  for (const fn of listeners) fn();
}

/** Start fetching the Lattice's code before it's needed (on hover), so entering it feels quick. */
export const loadLattice = () => import("./App.tsx");
