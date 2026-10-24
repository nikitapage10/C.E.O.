import { useState } from "react";
import { hourLabel, type HistoryEntry } from "../chronicle.ts";
import { PORTRAITS } from "./portraits.ts";
import { Chevron, shortDay } from "./ChronicleWeave.tsx";

/**
 * The Tide (#225, a folio since #388): Nikita's D&D world, kept in the Archive. Its own feed isn't connected yet, so the
 * folio says plainly what it waits on and invents nothing. What is real already sits on its facing page: the scenes the
 * week set in the Archive itself, where the cast's long table is.
 */

const LEAVES = [
  { t: "The campaign", s: "Which one is running, and where the party stands" },
  { t: "Next session", s: "When, who's coming, and what to prepare" },
  { t: "The storyline", s: "The thread so far, session by session" },
  { t: "People and factions", s: "Who the party has met, and where they stand" },
  { t: "Maps", s: "The charts, opened like a folio" },
  { t: "Session notes", s: "What happened at the table, written up" },
];

const WAITS = [
  { what: "The Tide's website", why: "Its address, and a read-only feed of the campaign, the sessions and the storyline." },
  { what: "Private pictures, in Azure Blob", why: "Maps and art the party shouldn't see yet, shown only when you're signed in." },
];

const nameOf = (id: string) => PORTRAITS[id]?.name ?? id;

export function TideFolio({ week }: { week: HistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  // The week's scenes set in the Archive, newest first.
  const here = week
    .flatMap((e) => e.scenes.filter((s) => s.room === "archive").map((s) => ({ e, s })))
    .reverse()
    .slice(0, 4);
  return (
    <section className={`ax-tide${open ? " is-open" : ""}`} aria-label="The Tide">
      <div className="ax-tide-cover">
        <p className="ax-k">The Tide · Nikita's campaign</p>
        <h2 className="ax-tide-h">The Tide</h2>
        <p className="ax-tide-state">
          <i aria-hidden="true" />
          Waiting for its connection
        </p>
        <p className="ax-tide-p">The campaign that's running, the next session and the story so far will be bound here once the Tide's own feed is connected. Nothing in this folio is made up meanwhile.</p>
        <button className="ax-more" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Close the folio" : "Open the folio"}
          <Chevron />
        </button>
      </div>
      <div className="ax-tide-leaf">
        <p className="ax-k">Set in the Archive this week</p>
        {here.length ? (
          <ol className="ax-tide-scenes">
            {here.map(({ e, s }, i) => {
              const d = shortDay(e.day);
              const line = s.lines[0];
              return (
                <li key={`${e.step}-${i}`}>
                  <span className="ax-tide-when">
                    {d.wd} {d.d} · {hourLabel(e.at)}
                  </span>
                  <b>{s.title}</b>
                  {line && (
                    <q>
                      <em>{nameOf(line.who)}:</em> {line.text}
                    </q>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="wv-note">No scene was set in the Archive this week yet. When the cast sits at the long table, it's kept here.</p>
        )}
      </div>
      {open && (
        <div className="ax-tide-open">
          <ol className="ax-tide-leaves">
            {LEAVES.map((l, i) => (
              <li key={l.t} style={{ "--i": i } as React.CSSProperties}>
                <b>{l.t}</b>
                <span>{l.s}</span>
                <em>Not connected yet</em>
              </li>
            ))}
          </ol>
          <div className="ax-tide-waits">
            <p className="ax-k">What the Tide waits on</p>
            <ul>
              {WAITS.map((w) => (
                <li key={w.what}>
                  <b>{w.what}</b>
                  <span>{w.why}</span>
                  <em>Waiting</em>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
