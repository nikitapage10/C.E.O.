import { createPortal } from "react-dom";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
 * reading for it; its timers skip it and its connections are off (#1079, api/_annex/route.ts `gateOf`); its keys, code
 * and settings stay, and one tap re-spins it as it was. Skippy, the Stagehand, keeps it.
 */

const ElectionNight = lazy(() => import("./ElectionNight.tsx").then((m) => ({ default: m.ElectionNight })));
const JobSearch = lazy(() => import("./JobSearch.tsx").then((m) => ({ default: m.JobSearch })));

const STATUS_WORD: Record<PopupStatus, string> = {
  live: "Growing",
  ended: "Ended",
  archived: "Seed",
  graduated: "Graduated",
};
const BED_OF: Record<PopupStatus, BedState> = {
  live: "bed",
  ended: "bed",
  archived: "vault",
  graduated: "plot",
};
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
        {shelved && (
          <span className="an-paused" title={`Paused: ${popup.pauses}. Its keys and settings are kept; Re-spin turns them back on.`}>
            Paused: no scheduled runs, connections off · keys and settings kept
          </span>
        )}
      </div>
      {!shelved && <span className="an-until">{note || (popup.until ? `Runs to ${popup.until}` : "Runs until shelved")}</span>}
      {shelved ? (
        <button type="button" className="an-btn an-btn--go" onClick={() => onSet("live")} title="Back up into its bed, as it was: its schedules and connections come back on">
          Re-spin
        </button>
      ) : (
        <button type="button" className="an-btn" onClick={() => onSet("archived")} title="Back to seed on the Shelf: stops its scheduled runs and turns its connections off, keeps its keys, code and settings">
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
function Bed({ popup, status, note, lit, onSet, onOpen, n }: { popup?: Popup; status?: PopupStatus; note?: string; lit: boolean; onSet?: (s: PopupStatus) => void; onOpen?: () => void; n: number }) {
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
      {onOpen && (
        <button type="button" className="an-btn an-btn--go" onClick={onOpen} title="Open its own dashboard">
          Open
        </button>
      )}
      <button type="button" className="an-btn" onClick={() => onSet("archived")} title="Back to seed on the Shelf: stops its scheduled runs and turns its connections off, keeps its keys, code and settings">
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
  // The pop-ups with a dashboard: each running (or graduated) one opens in a glass pane over the Glasshouse.
  const shown = [...running, ...out];
  // The pane open is kept in the address (/annex#jobs), so a pop-up's dashboard can be linked.
  const [openWant, setOpenWant] = useState<string | null>(() => (typeof window !== "undefined" && window.location.hash.length > 1 ? decodeURIComponent(window.location.hash.slice(1)) : null));
  const openId = shown.some((p) => p.id === openWant) ? openWant : null;
  const setAddress = (id: string | null) => {
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${id ? `#${encodeURIComponent(id)}` : ""}`);
    } catch {
      // The address is a nicety; the pane still opens.
    }
  };
  const back = useRef<HTMLElement | null>(null);
  const open = (id: string) => {
    back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenWant(id);
    setAddress(id);
  };
  const close = () => {
    setOpenWant(null);
    setAddress(null);
    back.current?.focus({ preventScroll: true });
  };
  // Open: Esc closes, the page under it holds still, and focus starts on the pane's close.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => document.querySelector<HTMLElement>(`#an-pane-${openId} .an-pane-x`)?.focus({ preventScroll: true }), 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = was;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const view: GlassView = useMemo(
    () => ({
      popups: POPUPS.map((p) => {
        const g = growth[p.id];
        return {
          id: p.id,
          name: p.name,
          state: BED_OF[status[p.id]],
          ended: status[p.id] === "ended",
          staked: follows[p.id].length > 0,
          growth: g ? { parts: g.parts, share: g.share } : null,
        };
      }),
    }),
    [status, follows, growth],
  );
  const notes = useMemo(() => Object.fromEntries(POPUPS.map((p) => [p.id, growth[p.id]?.note ?? ""])), [growth]);
  // A tag or a bed in the Glasshouse opens its pop-up's pane when it is growing (or out the door); a seed on the
  // Shelf lights its row in the console below, with Re-spin.
  const pick = (id: string) => {
    if (shown.some((p) => p.id === id)) return open(id);
    setLit(id);
    window.setTimeout(() => {
      const row = document.getElementById(`an-${id}`);
      (row ?? deck.current)?.scrollIntoView({
        behavior: reduced() ? "auto" : "smooth",
        block: "center",
      });
      row?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    }, 30);
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
          <p className="an-sub">
            Short-run projects on the C.E.O. engine. Running ones grow in the beds; a shelved one drops to seed in the vault under the floor; one that earns it is transplanted out the door to a room
            of its own. Tap a bed to open its dashboard. Kept by Skippy, the Stagehand.
          </p>
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

      {/* Under the glass, one console (#932): the beds and the Shelf. Each pop-up's dashboard opens in its pane above. */}
      <section ref={deck} className="an-deck" aria-label="The Glasshouse's console">
        <PaneSigils />
        <div className="an-deck-p" id="an-panel-beds">
          <div className="an-beds">
            <section className="an-bench" aria-label="In the beds">
              <h2 className="an-h2">In the beds</h2>
              <ol className="an-cloches">
                {Array.from({ length: Math.max(BED_COUNT, running.length) }, (_, i) => {
                  const p = running[i];
                  return p ? (
                    <Bed key={p.id} n={i + 1} popup={p} status={status[p.id]} note={growth[p.id]?.note} lit={lit === p.id} onSet={onSet(p)} onOpen={() => open(p.id)} />
                  ) : (
                    <Bed key={`free-${i}`} n={i + 1} lit={false} />
                  );
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

      {/* Each pop-up's dashboard, in a pane of the Glasshouse's own glass laid over it (Nikita, 2026-11-10). Every pane
          stays mounted once the page is up, so its feed keeps its bed's crystals growing while it is closed; only
          Shelve stops it. */}
      {load !== "idle" &&
        typeof document !== "undefined" &&
        createPortal(
          shown.map((p) => (
            <div key={p.id} className="an-pane" id={`an-pane-${p.id}`} hidden={openId !== p.id} role="dialog" aria-modal="true" aria-labelledby={`an-pane-t-${p.id}`}>
              <button type="button" className="an-pane-scrim" aria-label="Close" tabIndex={-1} onClick={close} />
              <div className="an-pane-glass">
                <i className="an-pane-mullions" aria-hidden="true" />
                <header className="an-pane-bar">
                  <span className="an-pane-eyb">
                    The Glasshouse <i /> {STATUS_WORD[status[p.id]]}
                  </span>
                  <b id={`an-pane-t-${p.id}`}>{p.name}</b>
                  <button type="button" className="an-pane-x" onClick={close} aria-label={`Close ${p.name}`}>
                    <span aria-hidden="true">×</span>
                  </button>
                </header>
                <div className="an-pane-body">
                  <Suspense fallback={<div className="desk__loading" role="status" aria-label="Loading" />}>
                    <Section popup={p} />
                  </Suspense>
                </div>
              </div>
            </div>
          )),
          // On the page's body, so no stacking context of the Desk's can put its bar over the pane.
          document.body,
        )}
    </div>
  );
}
