import { navigateTo, routeOf } from "../../route.ts";
import { link } from "../nav.ts";

/** In-app click for a room's address: a Desk page opens in place, the Lattice through its own link. */
export function roomLink(href: string) {
  if (href.startsWith("/lattice")) return link("lattice");
  const route = routeOf(href);
  if (route === "today" && href !== "/") {
    return (e: React.MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigateTo(href);
    };
  }
  return link(route);
}
