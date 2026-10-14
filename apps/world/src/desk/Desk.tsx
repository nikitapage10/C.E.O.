import { useEffect } from "react";
import { startFoundry } from "../foundry.ts";
import { loadLattice, navigate, usePathname, type Route } from "../route.ts";
import { useSystems, type LinkState } from "../systems.ts";
import { startWorldClock } from "../worldClock.ts";
import { useAwaySince } from "./awaySince.ts";
import { useDeskData } from "./deskData.ts";
import { useNow } from "./motion.tsx";
import { link } from "./nav.ts";
import { FoundryPage } from "./FoundryPage.tsx";
import { Relay } from "./Relay.tsx";
import { startDeskAuth } from "./signin.ts";
import { SystemsHub } from "./SystemsHub.tsx";
import { systemsTitle } from "./SystemsNav.tsx";
import { Chronicle } from "./Chronicle.tsx";
import { Today } from "./Today.tsx";
import "./desk.css";
import "./chronicle.css";

/**
 * The Desk: the Lattice's control room as a flat, fast page, where the C.E.O. acts on what the agents bring in.
 * Same world as the 3D Lattice (its colours, its stills, its cast) but it never loads it; "Enter the Lattice"
 * fetches that on demand. It shows only real work: the Foundry from GitHub now, Relay and the rooms once the hub
 * on the MacBook is connected.
 */

type DeskTab = Exclude<Route, "lattice">;

const TABS: { id: DeskTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "relay", label: "Relay" },
  { id: "foundry", label: "Foundry" },
  { id: "systems", label: "Systems" },
  { id: "chronicle", label: "Chronicle" },
];

const HUB_LINE: Record<LinkState, string> = {
  off: "Not connected to your hub yet. Once the MacBook is set up, Relay's work shows up here.",
  ok: "",
  slow: "The hub is answering slowly. Lists may lag a little.",
  down: "The hub is down. What you see is from before it stopped.",
};

const HUB_PILL: Record<LinkState, string> = { off: "Hub offline", ok: "Hub live", slow: "Hub slow", down: "Hub down" };

export function Desk({ route }: { route: DeskTab }) {
  const awaySince = useAwaySince();
  const data = useDeskData(awaySince);
  const now = useNow(30_000);
  const hub = useSystems((s) => s.links.find((l) => l.id === "hub")?.state ?? "off");

  useEffect(() => {
    startFoundry();
    startWorldClock();
    startDeskAuth();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest("input, textarea")) return;
      const i = Number(e.key) - 1;
      if (TABS[i]) navigate(TABS[i].id, window.location.search);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pathname = usePathname();
  useEffect(() => {
    document.title = route === "relay" ? "Relay · C.E.O." : route === "foundry" ? "Foundry · C.E.O." : route === "systems" ? systemsTitle(pathname) : route === "chronicle" ? "Chronicle · C.E.O." : "C.E.O. — Desk";
  }, [route, pathname]);

  const owed = data.owed.length + data.actions.filter((a) => a.when === "now").length;
  const connected = hub !== "off";

  return (
    <div className="desk" data-route={route}>
      <div className="desk__sky" aria-hidden="true">
        <span className="desk__glow desk__glow--a" />
        <span className="desk__glow desk__glow--b" />
        <span className="desk__stars" />
      </div>

      <header className="desk__bar">
        <div className="desk__bar-row">
          <a className="desk__mark" href="/" onClick={link("today")} aria-label="C.E.O.">
            <svg viewBox="0 0 32 32" aria-hidden="true">
              <path d="M16 3v26M9 9a7 7 0 0 1 14 0M10 23a6 6 0 0 0 12 0" />
              <circle cx="16" cy="16" r="2.4" />
            </svg>
            <span>C.E.O.</span>
          </a>
          <nav className="desk__tabs" aria-label="Desk">
            {TABS.map((t, i) => (
              <a
                key={t.id}
                href={t.id === "today" ? "/" : `/${t.id}`}
                className={route === t.id ? "on" : ""}
                aria-current={route === t.id ? "page" : undefined}
                onClick={link(t.id)}
                title={`${t.label} (${i + 1})`}
              >
                {t.label}
                {t.id === "today" && owed > 0 && (
                  <span className="desk__count" title="Things that need you">
                    {owed}
                  </span>
                )}
              </a>
            ))}
          </nav>
          <div className="desk__right">
            <span className={`desk__hub desk__hub--${hub}`} title={`Hub: ${HUB_PILL[hub]}`}>
              <i aria-hidden="true" />
              <span>{HUB_PILL[hub]}</span>
            </span>
            <a className="desk__enter" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()} onFocus={() => void loadLattice()}>
              <img src="/desk/lattice.webp" alt="" aria-hidden="true" decoding="async" />
              <span>Enter the Lattice</span>
              <i aria-hidden="true">→</i>
            </a>
          </div>
        </div>
      </header>

      {hub !== "ok" && (
        <p className={`desk__notice desk__notice--${hub}`} role="status">
          <span className="desk__notice-text">{HUB_LINE[hub]}</span>
        </p>
      )}

      <main className="desk__main" key={route}>
        {route === "relay" ? (
          <Relay data={data} now={now} connected={connected} />
        ) : route === "foundry" ? (
          <FoundryPage now={now} />
        ) : route === "chronicle" ? (
          <Chronicle now={now} awaySince={awaySince} />
        ) : route === "systems" ? (
          <SystemsHub now={now} />
        ) : (
          <Today data={data} now={now} connected={connected} awaySince={awaySince} />
        )}
      </main>

      <footer className="desk__foot">
        <span>Command Everything, Obviously</span>
        <span className="desk__foot-rule" aria-hidden="true" />
        <span>Ilyr · the Syntherion Lattice</span>
      </footer>
    </div>
  );
}
