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
  // A page inside a room, or a spot on it (/boiler/controls#link-hub): open that address, keeping any flags.
  if (/^\/[^/#?]+[/#]/.test(href)) {
    return (e: React.MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const [path, hash = ""] = href.split("#");
      navigateTo(`${path}${path!.includes("?") ? "" : window.location.search}${hash ? `#${hash}` : ""}`);
    };
  }
  return link(route);
}
