import { navigateTo, usePathname } from "../route.ts";

/**
 * The Boiler Room's sub-navigation (#82; the Systems hub until #225) and its addresses: /boiler, /boiler/controls (#647),
 * /boiler/security, /boiler/compliance (the old /systems ones still work). Each subpage has its own address, so it can be linked to and
 * reloaded. SystemsHub.tsx picks the page.
 */

export type SystemsPage = "systems" | "controls" | "security" | "compliance";

const PAGES: { id: SystemsPage; label: string; path: string; hint: string }[] = [
  { id: "systems", label: "Map", path: "/boiler", hint: "Every pipe, its gauge and what's broken" },
  { id: "controls", label: "Controls", path: "/boiler/controls", hint: "Usage, settings, switches, connections and keys" },
  { id: "security", label: "Security", path: "/boiler/security", hint: "Threat model and scans" },
  { id: "compliance", label: "Compliance", path: "/boiler/compliance", hint: "Frameworks and controls" },
];

export function systemsPageOf(pathname: string): SystemsPage {
  const sub = pathname.replace(/\/+$/, "").split("/")[2];
  return sub === "controls" || sub === "security" || sub === "compliance" ? sub : "systems";
}

/** The browser tab's title for a Boiler Room page. */
export function systemsTitle(pathname: string): string {
  const page = systemsPageOf(pathname);
  return page === "systems" ? "Boiler Room · C.E.O." : `${PAGES.find((p) => p.id === page)!.label} · Boiler Room · C.E.O.`;
}

/** A tab's count beside its name (the Map's tabs, #732): states and counts only, so it reads the same signed out. */
export type TabScores = Partial<Record<SystemsPage, { v: string; warn?: boolean }>>;

/** The hub's sub-navigation, under each page's head; on the Map, tabs in its top bar with a count each. */
export function SystemsNav({ scores, className = "wv-subnav" }: { scores?: TabScores; className?: string } = {}) {
  const current = systemsPageOf(usePathname());
  const go = (path: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigateTo(path + window.location.search);
  };
  return (
    <nav className={className} aria-label="Boiler Room sections">
      {PAGES.map((p) => {
        const sc = scores?.[p.id];
        return (
          <a key={p.id} href={p.path} title={p.hint} aria-current={current === p.id ? "page" : undefined} onClick={go(p.path)}>
            {p.label}
            {sc ? <b className={sc.warn ? "is-warn" : undefined}>{sc.v}</b> : null}
          </a>
        );
      })}
    </nav>
  );
}
