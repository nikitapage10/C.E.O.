import { navigate, type Route } from "../route.ts";

/** In-app navigation for plain links (a new tab or a modified click still works as a normal link). */
export function link(to: Route) {
  return (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // Desk pages keep the query (?real), so moving between tabs doesn't flip the samples on or off.
    navigate(to, to === "lattice" ? "" : window.location.search);
  };
}
