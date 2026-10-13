import { useSyncExternalStore } from "react";

/**
 * The app's few addresses. The Desk lives at `/`, `/relay`, `/foundry`, `/systems` (and its subpages) and `/chronicle`; the 3D Lattice at `/lattice`. Kept free of
 * imports on purpose: the Desk loads this, and must not pull in anything from the Lattice.
 */
export type Route = "today" | "relay" | "foundry" | "systems" | "chronicle" | "lattice";

export function routeOf(pathname: string): Route {
  if (pathname.startsWith("/lattice")) return "lattice";
  if (pathname.startsWith("/relay")) return "relay";
  if (pathname.startsWith("/foundry")) return "foundry";
  if (pathname.startsWith("/systems")) return "systems";
  if (pathname.startsWith("/chronicle")) return "chronicle";
  return "today";
}

export const PATHS: Record<Route, string> = { today: "/", relay: "/relay", foundry: "/foundry", systems: "/systems", chronicle: "/chronicle", lattice: "/lattice" };

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

/** The current path, kept in step with in-app navigation: Systems reads its subpage (`/systems/security`) from it. */
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
  for (const fn of listeners) fn();
}

/** Start fetching the Lattice's code before it's needed (on hover), so entering it feels quick. */
export const loadLattice = () => import("./App.tsx");
