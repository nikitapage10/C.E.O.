import { useEffect } from "react";
import { startFoundry } from "../foundry.ts";
import { loadLattice, navigate, type Route } from "../route.ts";
import { useSystems, type LinkState } from "../systems.ts";
import { SAMPLES, useDeskData } from "./deskData.ts";
import { Decode, useNow } from "./motion.tsx";
import { link } from "./nav.ts";
import { FoundryPage } from "./FoundryPage.tsx";
import { Relay } from "./Relay.tsx";
import { Systems } from "./Systems.tsx";
import { Today } from "./Today.tsx";
import "./desk.css";

/**
 * The Desk: the plain, fast front page where the C.E.O. acts on what the agents bring in. It never loads the 3D
 * Lattice; "Enter the Lattice" fetches that on demand. Phase 2 wires it to the hub on the MacBook; until then it
 * shows a labelled sample day (`?real` hides it).
 */

type DeskTab = Exclude<Route, "lattice">;

const TABS: { id: DeskTab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "relay", label: "Relay" },
  { id: "foundry", label: "Foundry" },
  { id: "systems", label: "Systems" },
];

const HUB_LINE: Record<LinkState, string> = {
  off: "Not connected to your hub yet. Once the MacBook is set up, Relay's work shows up here.",
  ok: "",
  slow: "The hub is answering slowly. Lists may lag a little.",
  down: "The hub is down. What you see is from before it stopped.",
};

const HUB_PILL: Record<LinkState, string> = { off: "Hub offline", ok: "Hub live", slow: "Hub slow", down: "Hub down" };


export function Desk({ route }: { route: DeskTab }) {
  const data = useDeskData();
  const now = useNow(30_000);
  const hub = useSystems((s) => s.links.find((l) => l.id === "hub")?.state ?? "off");

  useEffect(() => startFoundry(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement | null)?.closest("input, textarea")) return;
      const i = Number(e.key) - 1;
      if (TABS[i]) navigate(TABS[i].id, window.location.search);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = route === "relay" ? "Relay · C.E.O." : route === "foundry" ? "Foundry · C.E.O." : route === "systems" ? "Systems · C.E.O." : "C.E.O. — Desk";
  }, [route]);

  const owed = data.owed.length + data.actions.filter((a) => a.when === "now").length;
  const connected = hub !== "off";

  return (
    <div className="desk">
      <div className="desk__sky" aria-hidden="true">
        <span className="desk__aurora desk__aurora--a" />
        <span className="desk__aurora desk__aurora--b" />
        <span className="desk__stars" />
        <span className="desk__stars desk__stars--far" />
      </div>
      <header className="desk__bar">
        <a className="desk__mark" href="/" onClick={link("today")} aria-label="C.E.O.">
          <Decode text="C.E.O." speed={70} />
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
              <span className="desk__tab-n" aria-hidden="true">
                0{i + 1}
              </span>
              {t.label}
            </a>
          ))}
        </nav>
        <div className="desk__right">
          <span className={`desk__hub desk__hub--${hub}`} title={`Hub: ${HUB_PILL[hub]}`}>
            <i aria-hidden="true" />
            <span>{HUB_PILL[hub]}</span>
          </span>
          <span className={`desk__count ${owed ? "desk__count--hot" : ""}`} title="Things that need you">
            {owed}
          </span>
          <a className="desk__enter" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()} onFocus={() => void loadLattice()}>
            <span>Enter the Lattice</span>
            <i aria-hidden="true">→</i>
          </a>
        </div>
      </header>

      {(hub !== "ok" || SAMPLES) && (
        <p className={`desk__notice desk__notice--${SAMPLES ? "preview" : hub}`} role="status">
          <span className="desk__notice-dot" aria-hidden="true" />
          {SAMPLES ? "Sample day: examples of what your agents will bring you, from made-up people. Nothing here sends." : HUB_LINE[hub]}
          <a className="desk__notice-link" href={SAMPLES ? `${window.location.pathname}?real` : window.location.pathname}>
            {SAMPLES ? "Show only real" : "Show samples"}
          </a>
        </p>
      )}

      <main className="desk__main" key={route}>
        {route === "relay" ? (
          <Relay data={data} now={now} connected={connected} />
        ) : route === "foundry" ? (
          <FoundryPage now={now} />
        ) : route === "systems" ? (
          <Systems now={now} />
        ) : (
          <Today data={data} now={now} connected={connected} />
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
