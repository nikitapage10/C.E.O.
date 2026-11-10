import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { POPUPS, useAnnex, type Popup, type PopupStatus } from "../data/annex.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { GlassStage } from "./GlassStage.tsx";
import type { BedState, GlassView } from "./glasshouse.ts";
import { PaneSigils } from "./PaneSigils.tsx";
import "./annex.css";

/**
 * The Annex (#618), as the Glasshouse since #829, filling the screen since #932: the Desk's staging room. Short-lived
 * pop-ups run here on the C.E.O. engine, each a small module of its own (an api route, a page section, a feed); one
 * that proves itself can graduate into a full room. The Glasshouse fills the screen and shows each one where it is:
 * growing in a bed on the carousel while it runs (its crystals are its real count, Election night's the races called),
 * a seed in the vault under the glass floor while it is on the Shelf, out on its own plot once it has graduated. Under
 * it, one console behind glass: a tab for each running pop-up's own section, and the beds and the Shelf with Shelve and
 * Re-spin. Shelving a pop-up stops it whole: its section unmounts, so its feed and timers stop, and the server stops
 * reading for it; its code and settings stay, and one tap re-spins it as it was. Skippy, the Stagehand, keeps it.
 */

const ElectionNight = lazy(() => import("./ElectionNight.tsx").then((m) => ({ default: m.ElectionNight })));
const JobSearch = lazy(() => import("./JobSearch.tsx").then((m) => ({ default: m.JobSearch })));

const STATUS_WORD: Record<PopupStatus, string> = { live: "Growing", ended: "Ended", archived: "Seed", graduated: "Graduated" };
const BED_OF: Record<PopupStatus, BedState> = { live: "bed", ended: "bed", archived: "vault", graduated: "plot" };
const reduced = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Section({ popup }: { popup: Popup }) {
  if (popup.id === "elections") return <ElectionNight />;
  if (popup.id === "jobs") return <JobSearch />;
  return null;
}

function Row({ popup, status, note, lit, onSet }: { popup: Popup; status: PopupStatus; note?: string; lit: boolean; onSet: (s: PopupStatus) => void }) {
  const shelved = status === "archived";
  return (
    <li className={`an-row${lit ? " is-lit" : ""}`} id={`an-${popup.id}`} data-status={status}>
      <span className="an-status">{STATUS_WORD[status]}</span>
      <div className="an-row-text">
        <b>{popup.name}</b>
        <span>{popup.line}</span>
      </div>
      <span className="an-until">{shelved ? "Code and settings kept" : note || (popup.until ? `Runs to ${popup.until}` : "Runs until shelved")}</span>
      {shelved ? (
        <button type="button" className="an-btn an-btn--go" onClick={() => onSet("live")} title="Back up into its bed, as it was">
          Re-spin
        </button>
      ) : (
        <button type="button" className="an-btn" onClick={() => onSet("archived")} title="Back to seed on the Shelf: stops its reads and timers, keeps its code and settings">
          Shelve
        </button>
      )}
    </li>
  );
}

/** The Glasshouse's beds (glasshouse.ts BEDS): the console shows the same four, a cloche each (#932). */
const BED_COUNT = 4;
/** The seed vault's drawers shown under the glass: at least this many, the empty ones dark. */
const DRAWERS = 6;

/**
 * One bed under its cloche (#932): the pop-up growing in it, its crystals as the bed's glow, and its plaque with its
 * state, its line, how long it runs and Shelve. An empty bed is a cloche with nothing under it.
 */
function Bed({ popup, status, note, lit, onSet, n }: { popup?: Popup; status?: PopupStatus; note?: string; lit: boolean; onSet?: (s: PopupStatus) => void; n: number }) {
  if (!popup || !status || !onSet)
    return (
      <li className="an-bed is-free">
        <span className="an-cloche" aria-hidden="true">
          <i />
        </span>
        <span className="an-bed-n">Bed {n}</span>
        <b className="an-bed-free">Free bed</b>
      </li>
    );
  return (
    <li className={`an-bed${lit ? " is-lit" : ""}`} id={`an-${popup.id}`} data-status={status}>
      <span className="an-cloche" aria-hidden="true">
        <i />
      </span>
      <span className="an-bed-n">
        Bed {n} · <span className="an-status">{STATUS_WORD[status]}</span>
      </span>
      <b>{popup.name}</b>
      <span className="an-bed-line">{popup.line}</span>
      <span className="an-until">{note || (popup.until ? `Runs to ${popup.until}` : "Runs until shelved")}</span>
      <button type="button" className="an-btn" onClick={() => onSet("archived")} title="Back to seed on the Shelf: stops its reads and timers, keeps its code and settings">
        Shelve
      </button>
    </li>
  );
}

export function Annex() {
  const status = useAnnex((s) => s.status);
  const load = useAnnex((s) => s.load);
  useRoomReady(load !== "idle");
  const signedIn = useAnnex((s) => s.signedIn);
  const setStatus = useAnnex((s) => s.setStatus);
  const follows = useAnnex((s) => s.follows);
  const growth = useAnnex((s) => s.growth);
  const [lit, setLit] = useState<string | null>(null);
  const deck = useRef<HTMLElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    void useAnnex.getState().refresh();
  }, []);
  useEffect(() => {
    if (!lit) return;
    const t = window.setTimeout(() => setLit(null), 2400);
    return () => window.clearTimeout(t);
  }, [lit]);

  const running = POPUPS.filter((p) => status[p.id] === "live" || status[p.id] === "ended");
  const shelf = POPUPS.filter((p) => status[p.id] === "archived");
  const out = POPUPS.filter((p) => status[p.id] === "graduated");
  // The console's tabs: each running (or graduated) pop-up's own section, then the beds and the Shelf.
  const shown = [...running, ...out];
  const tabList = [...shown.map((p) => ({ id: p.id, k: p.name, b: growth[p.id]?.note || STATUS_WORD[status[p.id]] })), { id: "beds", k: "Beds and Shelf", b: `${running.length} growing · ${shelf.length} ${shelf.length === 1 ? "seed" : "seeds"}` }];
  const [tabWant, setTab] = useState<string | null>(null);
  const tab = tabList.some((t) => t.id === tabWant) ? tabWant! : tabList[0]!.id;

  const view: GlassView = useMemo(
    () => ({
      popups: POPUPS.map((p) => {
        const g = growth[p.id];
        return { id: p.id, name: p.name, state: BED_OF[status[p.id]], ended: status[p.id] === "ended", staked: follows[p.id].length > 0, growth: g ? { parts: g.parts, share: g.share } : null };
      }),
    }),
    [status, follows, growth],
  );
  const notes = useMemo(() => Object.fromEntries(POPUPS.map((p) => [p.id, growth[p.id]?.note ?? ""])), [growth]);
  // A tag or a bed in the Glasshouse opens the console on its pop-up's row, lit.
  const pick = (id: string) => {
    setTab("beds");
    setLit(id);
    window.setTimeout(() => {
      const row = document.getElementById(`an-${id}`);
      (row ?? deck.current)?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
      row?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    }, 30);
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = tabList.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(tabList[to]!.id);
    tabs.current[to]?.focus();
  };
  const onSet = (p: Popup) => (s: PopupStatus) => void setStatus(p.id, s);

  return (
    <div className="an" data-room="annex">
      <GlassStage view={view} notes={notes} onPick={pick}>
        <header className="an-head">
          <p className="an-eyb">
            The Annex <i /> the Glasshouse
          </p>
          <h1 className="an-h1 desk__title">
            Pop-ups, <em>grown under glass.</em>
          </h1>
          <p className="an-sub">Short-run projects on the C.E.O. engine. Running ones grow in the beds; a shelved one drops to seed in the vault under the floor; one that earns it is transplanted out the door to a room of its own. Kept by Skippy, the Stagehand.</p>
          <dl className="an-stats">
            <div>
              <dt>In the beds</dt>
              <dd>{running.length}</dd>
            </div>
            <div>
              <dt>Seeds</dt>
              <dd>{shelf.length}</dd>
            </div>
            <div>
              <dt>Graduated</dt>
              <dd>{out.length}</dd>
            </div>
          </dl>
        </header>
      </GlassStage>

      {/* Under the glass, one console (#932): each running pop-up's own section, and the beds and the Shelf. */}
      <section ref={deck} className="an-deck" aria-label="The Glasshouse's console">
        <PaneSigils />
        <div className="an-deck-tabs" role="tablist" aria-label="Under the glass">
          {tabList.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => void (tabs.current[i] = el)}
              type="button"
              role="tab"
              id={`an-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`an-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className="an-deck-tab"
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              <span>{t.k}</span> <b>{t.b}</b>
            </button>
          ))}
        </div>

        {/* Every section stays mounted behind its tab, so its feed keeps its bed's crystals growing while another
            tab is open; only Shelve stops it. */}
        {load !== "idle" &&
          shown.map((p) => (
            <div key={p.id} className="an-deck-p" role="tabpanel" id={`an-panel-${p.id}`} aria-labelledby={`an-tab-${p.id}`} hidden={tab !== p.id}>
              <Suspense fallback={<div className="desk__loading" role="status" aria-label="Loading" />}>
                <Section popup={p} />
              </Suspense>
            </div>
          ))}
        <div className="an-deck-p" role="tabpanel" id="an-panel-beds" aria-labelledby="an-tab-beds" hidden={tab !== "beds"}>
          <div className="an-beds">
            <section className="an-bench" aria-label="In the beds">
              <h2 className="an-h2">In the beds</h2>
              <ol className="an-cloches">
                {Array.from({ length: Math.max(BED_COUNT, running.length) }, (_, i) => {
                  const p = running[i];
                  return p ? <Bed key={p.id} n={i + 1} popup={p} status={status[p.id]} note={growth[p.id]?.note} lit={lit === p.id} onSet={onSet(p)} /> : <Bed key={`free-${i}`} n={i + 1} lit={false} />;
                })}
              </ol>
              {!running.length && <p className="an-note">Every bed is free. Re-spin a seed from the Shelf to grow it here again.</p>}
              {out.length > 0 && (
                <>
                  <h2 className="an-h2 an-h2--out">Out the door</h2>
                  <ol className="an-list">
                    {out.map((p) => (
                      <Row key={p.id} popup={p} status="graduated" lit={lit === p.id} onSet={onSet(p)} />
                    ))}
                  </ol>
                </>
              )}
            </section>
            <section className="an-shelf" aria-label="The Shelf">
              <h2 className="an-h2">The Shelf · the seed vault</h2>
              {/* The vault under the glass floor (#932): a drawer per seed, the rest of the drawers dark. */}
              <ol className="an-list an-drawers">
                {shelf.map((p) => (
                  <Row key={p.id} popup={p} status="archived" lit={lit === p.id} onSet={onSet(p)} />
                ))}
                {Array.from({ length: Math.max(0, DRAWERS - shelf.length) }, (_, i) => (
                  <li key={`empty-${i}`} className="an-drawer-empty" aria-hidden="true">
                    <i />
                  </li>
                ))}
              </ol>
              {!shelf.length && <p className="an-note">No seeds in the vault. A shelved pop-up waits here with nothing running, and grows back as it was.</p>}
              <p className="an-note">{signedIn ? "Shelving applies on every device." : "Signed out, shelving and follows are kept on this device only."}</p>
            </section>
          </div>
        </div>
      </section>
    </div>
  );
}
