import { useSyncExternalStore } from "react";

/**
 * The app's few addresses. The Desk lives at `/`, `/relay` and `/systems`; the 3D Lattice at `/lattice`. Kept free of
 * imports on purpose: the Desk loads this, and must not pull in anything from the Lattice.
 */
export type Route = "today" | "relay" | "systems" | "lattice";

export function routeOf(pathname: string): Route {
  if (pathname.startsWith("/lattice")) return "lattice";
  if (pathname.startsWith("/relay")) return "relay";
  if (pathname.startsWith("/systems")) return "systems";
  return "today";
}

export const PATHS: Record<Route, string> = { today: "/", relay: "/relay", systems: "/systems", lattice: "/lattice" };

const listeners = new Set<() => void>();
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

/** Go somewhere without reloading the page (keeps the query string when staying inside the Lattice). */
export function navigate(route: Route, search = "") {
  const path = PATHS[route] + search;
  if (window.location.pathname + window.location.search === path) return;
  window.history.pushState(null, "", path);
  for (const fn of listeners) fn();
}

/** Start fetching the Lattice's code before it's needed (on hover), so entering it feels quick. */
export const loadLattice = () => import("./App.tsx");
