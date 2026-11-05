import { lazy, Suspense, useEffect } from "react";
import { POPUPS, useAnnex, type Popup, type PopupStatus } from "../data/annex.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import "./annex.css";

/**
 * The Annex (#618): the Desk's staging room. Short-lived pop-ups run here on the C.E.O. engine, each a small module of
 * its own (an api route, a page section, a feed); one that proves itself can graduate into a full room. Plain on
 * purpose (Nikita, 23:12Z: form follows function): a list of pop-ups with their status, the live ones open below, and
 * the Shelf. Archiving a pop-up stops it whole: its section unmounts, so its feed and timers stop, and the server
 * stops reading for it; its code and settings stay, and one tap revives it as it was. Skippy, the Stagehand, keeps it.
 */

const ElectionNight = lazy(() => import("./ElectionNight.tsx").then((m) => ({ default: m.ElectionNight })));

const STATUS_WORD: Record<PopupStatus, string> = { live: "Live", ended: "Ended", archived: "On the Shelf", graduated: "Graduated" };

function Section({ popup }: { popup: Popup }) {
  if (popup.id === "elections") return <ElectionNight />;
  return null;
}

function Row({ popup, status, onSet }: { popup: Popup; status: PopupStatus; onSet: (s: PopupStatus) => void }) {
  const shelved = status === "archived";
  return (
    <li className="an-row" data-status={status}>
      <span className="an-status">{STATUS_WORD[status]}</span>
      <div className="an-row-text">
        <b>{popup.name}</b>
        <span>{popup.line}</span>
      </div>
      <span className="an-until">{shelved ? "Code and settings kept" : `Runs to ${popup.until}`}</span>
      {shelved ? (
        <button type="button" className="an-btn an-btn--go" onClick={() => onSet("live")}>
          Revive
        </button>
      ) : (
        <button type="button" className="an-btn" onClick={() => onSet("archived")} title="Stops its reads and timers; keeps its code and settings">
          Archive
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
  useEffect(() => {
    void useAnnex.getState().refresh();
  }, []);

  const live = POPUPS.filter((p) => status[p.id] !== "archived");
  const shelf = POPUPS.filter((p) => status[p.id] === "archived");

  return (
    <div className="an" data-room="annex">
      <header className="an-head">
        <p className="an-eyb">The Annex · staging</p>
        <h1 className="an-h1">Pop-ups</h1>
        <p className="an-sub">
          Short-run projects on the C.E.O. engine, each with its own small feature set. One that earns it graduates into a room. Kept by Skippy, the Stagehand.
        </p>
      </header>

      {live.length > 0 && (
        <ol className="an-list" aria-label="Running">
          {live.map((p) => (
            <Row key={p.id} popup={p} status={status[p.id]} onSet={(s) => void setStatus(p.id, s)} />
          ))}
        </ol>
      )}

      {load !== "idle" &&
        live.map((p) => (
          <Suspense key={p.id} fallback={<div className="desk__loading" role="status" aria-label="Loading" />}>
            <Section popup={p} />
          </Suspense>
        ))}

      <section className="an-shelf" aria-label="The Shelf">
        <h2 className="an-h2">The Shelf</h2>
        {shelf.length ? (
          <ol className="an-list">
            {shelf.map((p) => (
              <Row key={p.id} popup={p} status="archived" onSet={(s) => void setStatus(p.id, s)} />
            ))}
          </ol>
        ) : (
          <p className="an-note">Nothing archived. An archived pop-up waits here with nothing running, and comes back as it was.</p>
        )}
        <p className="an-note">{signedIn ? "Archiving applies on every device." : "Signed out, archiving and follows are kept on this device only."}</p>
      </section>
    </div>
  );
}
