import { navigateTo, usePathname } from "../route.ts";

/**
 * The Boiler Room's sub-navigation (#82; the Systems hub until #225) and its addresses: /boiler, /boiler/security,
 * /boiler/compliance (the old /systems ones still work). Each subpage has its own address, so it can be linked to and
 * reloaded. SystemsHub.tsx picks the page.
 */

export type SystemsPage = "systems" | "security" | "compliance";

const PAGES: { id: SystemsPage; label: string; path: string; hint: string }[] = [
  { id: "systems", label: "The pipes", path: "/boiler", hint: "What's connected, and the house" },
  { id: "security", label: "Security", path: "/boiler/security", hint: "Threat model and scans" },
  { id: "compliance", label: "Compliance", path: "/boiler/compliance", hint: "Frameworks and controls" },
];

export function systemsPageOf(pathname: string): SystemsPage {
  const sub = pathname.replace(/\/+$/, "").split("/")[2];
  return sub === "security" || sub === "compliance" ? sub : "systems";
}

/** The browser tab's title for a Boiler Room page. */
export function systemsTitle(pathname: string): string {
  const page = systemsPageOf(pathname);
  return page === "systems" ? "Boiler Room · C.E.O." : `${PAGES.find((p) => p.id === page)!.label} · Boiler Room · C.E.O.`;
}

/** The hub's sub-navigation, under each page's head. */
export function SystemsNav() {
  const current = systemsPageOf(usePathname());
  const go = (path: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateTo(path + window.location.search);
  };
  return (
    <nav className="wv-subnav" aria-label="Boiler Room sections">
      {PAGES.map((p) => (
        <a key={p.id} href={p.path} title={p.hint} aria-current={current === p.id ? "page" : undefined} onClick={go(p.path)}>
          {p.label}
        </a>
      ))}
    </nav>
  );
}
