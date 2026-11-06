import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { POPUPS, useAnnex, type Popup, type PopupStatus } from "../data/annex.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { GlassStage } from "./GlassStage.tsx";
import type { BedState, GlassView } from "./glasshouse.ts";
import "./annex.css";

/**
 * The Annex (#618), as the Glasshouse since #829: the Desk's staging room. Short-lived pop-ups run here on the C.E.O.
 * engine, each a small module of its own (an api route, a page section, a feed); one that proves itself can graduate
 * into a full room. The Glasshouse up top shows each one where it is: growing in a bed on the carousel while it runs,
 * a seed in the vault under the glass floor while it is on the Shelf, out on its own plot once it has graduated. Below
 * it, the plain controls: the beds with Shelve, the live pop-ups open, and the Shelf with Re-spin. Shelving a pop-up
 * stops it whole: its section unmounts, so its feed and timers stop, and the server stops reading for it; its code and
 * settings stay, and one tap re-spins it as it was. Skippy, the Stagehand, keeps it.
 */

const ElectionNight = lazy(() => import("./ElectionNight.tsx").then((m) => ({ default: m.ElectionNight })));

const STATUS_WORD: Record<PopupStatus, string> = { live: "Growing", ended: "Ended", archived: "Seed", graduated: "Graduated" };
const BED_OF: Record<PopupStatus, BedState> = { live: "bed", ended: "bed", archived: "vault", graduated: "plot" };

function Section({ popup }: { popup: Popup }) {
  if (popup.id === "elections") return <ElectionNight />;
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
      <span className="an-until">{shelved ? "Code and settings kept" : note || `Runs to ${popup.until}`}</span>
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

export function Annex() {
  const status = useAnnex((s) => s.status);
  const load = useAnnex((s) => s.load);
  useRoomReady(load !== "idle");
  const signedIn = useAnnex((s) => s.signedIn);
  const setStatus = useAnnex((s) => s.setStatus);
  const follows = useAnnex((s) => s.follows);
  const growth = useAnnex((s) => s.growth);
  const [lit, setLit] = useState<string | null>(null);
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
  // A tag or a bed in the Glasshouse opens its pop-up's row.
  const pick = (id: string) => {
    const row = document.getElementById(`an-${id}`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    setLit(id);
  };

  return (
    <div className="an" data-room="annex">
      <header className="an-head">
        <p className="an-eyb">The Annex · the Glasshouse</p>
        <h1 className="an-h1">Pop-ups</h1>
        <p className="an-sub">
          Short-run projects on the C.E.O. engine. Running ones grow in the beds; a shelved one drops back to seed in the vault under the floor, and one that earns it is transplanted out the door to a room of its own. Kept by Skippy,
          the Stagehand.
        </p>
      </header>

      <GlassStage view={view} notes={notes} onPick={pick} />

      <section className="an-beds" aria-label="In the beds">
        <h2 className="an-h2">In the beds</h2>
        {running.length ? (
          <ol className="an-list">
            {running.map((p) => (
              <Row key={p.id} popup={p} status={status[p.id]} note={growth[p.id]?.note} lit={lit === p.id} onSet={(s) => void setStatus(p.id, s)} />
            ))}
          </ol>
        ) : (
          <p className="an-note">Every bed is free. Re-spin a seed from the Shelf to grow it here again.</p>
        )}
        {out.length > 0 && (
          <>
            <h2 className="an-h2 an-h2--out">Out the door</h2>
            <ol className="an-list">
              {out.map((p) => (
                <Row key={p.id} popup={p} status="graduated" lit={lit === p.id} onSet={(s) => void setStatus(p.id, s)} />
              ))}
            </ol>
          </>
        )}
      </section>

      {load !== "idle" &&
        [...running, ...out].map((p) => (
          <Suspense key={p.id} fallback={<div className="desk__loading" role="status" aria-label="Loading" />}>
            <Section popup={p} />
          </Suspense>
        ))}

      <section className="an-shelf" aria-label="The Shelf">
        <h2 className="an-h2">The Shelf · the seed vault</h2>
        {shelf.length ? (
          <ol className="an-list">
            {shelf.map((p) => (
              <Row key={p.id} popup={p} status="archived" lit={lit === p.id} onSet={(s) => void setStatus(p.id, s)} />
            ))}
          </ol>
        ) : (
          <p className="an-note">No seeds in the vault. A shelved pop-up waits here with nothing running, and grows back as it was.</p>
        )}
        <p className="an-note">{signedIn ? "Shelving applies on every device." : "Signed out, shelving and follows are kept on this device only."}</p>
      </section>
    </div>
  );
}
