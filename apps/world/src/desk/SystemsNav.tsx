import { navigateTo, usePathname } from "../route.ts";

/**
 * The Systems hub's sub-navigation (#82) and its addresses: /systems, /systems/security, /systems/compliance. Each
 * subpage has its own address, so it can be linked to and reloaded. SystemsHub.tsx picks the page.
 */

export type SystemsPage = "systems" | "security" | "compliance";

const PAGES: { id: SystemsPage; label: string; path: string; hint: string }[] = [
  { id: "systems", label: "Systems", path: "/systems", hint: "What's connected" },
  { id: "security", label: "Security", path: "/systems/security", hint: "Threat model and scans" },
  { id: "compliance", label: "Compliance", path: "/systems/compliance", hint: "Frameworks and controls" },
];

export function systemsPageOf(pathname: string): SystemsPage {
  const sub = pathname.replace(/\/+$/, "").split("/")[2];
  return sub === "security" || sub === "compliance" ? sub : "systems";
}

/** The browser tab's title for a Systems page. */
export function systemsTitle(pathname: string): string {
  const page = systemsPageOf(pathname);
  return page === "systems" ? "Systems · C.E.O." : `${PAGES.find((p) => p.id === page)!.label} · Systems · C.E.O.`;
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
    <nav className="wv-subnav" aria-label="Systems sections">
      {PAGES.map((p) => (
        <a key={p.id} href={p.path} title={p.hint} aria-current={current === p.id ? "page" : undefined} onClick={go(p.path)}>
          {p.label}
        </a>
      ))}
    </nav>
  );
}
