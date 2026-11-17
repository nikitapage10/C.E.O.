import { useEffect, useState } from "react";
import { findMotions, motionLine, readRecord, whenArgued, type RecordLine } from "../data/senateRecord.ts";
import { Chevron } from "./ChronicleWeave.tsx";

/**
 * The Senate Record (#1181): every motion the Senate has argued, with the chair's ruling, newest first, from
 * GET /api/senate-record (api/senate-record.ts). Read once when the Archive opens; a motion argued before the record
 * kept rulings shows alone.
 */

/** How many arguments show before "all of them". */
const SHOWN = 25;

export type RecordState = { status: "loading" | "failed" } | { status: "ready"; lines: RecordLine[] };

/** The record, read once while the Archive is open. */
export function useSenateRecord(): RecordState {
  const [state, setState] = useState<RecordState>({ status: "loading" });
  useEffect(() => {
    let dead = false;
    fetch("/api/senate-record", { headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) throw new Error(String(res.status));
        const lines = readRecord(await res.json());
        if (!lines) throw new Error("shape");
        if (!dead) setState({ status: "ready", lines });
      })
      .catch(() => !dead && setState({ status: "failed" }));
    return () => {
      dead = true;
    };
  }, []);
  return state;
}

export function SenateRecordFolio({ record, now }: { record: RecordState; now: number }) {
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");
  if (record.status !== "ready")
    return (
      <section className="ax-senate" aria-label="The Senate Record">
        <p className="wv-note">{record.status === "loading" ? "Opening the record…" : "Can't reach the Senate Record right now."}</p>
      </section>
    );
  const { lines } = record;
  const found = findMotions(lines, query);
  const searching = query.trim() !== "";
  const shown = all || searching ? found : found.slice(0, SHOWN);
  return (
    <section className="ax-senate" aria-label="The Senate Record">
      <p className="fl-k">Motions, newest first</p>
      {!lines.length ? (
        <p className="wv-note">No motions yet. The Senate argues one whenever the chamber is in recess.</p>
      ) : (
        <>
          {/* The search (#1189): narrows the motions already loaded, by the motion's words or the chair's ruling. */}
          <label className="ax-senate-find">
            <span>Find a motion</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="A word from the motion or the ruling"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {searching && (
            <p className="ax-senate-count" role="status">
              {found.length ? `${found.length} of ${lines.length} motions` : "No motion matches that."}
            </p>
          )}
          <ol className="ax-senate-list">
            {shown.map((l) => (
              <li key={`${l.at ?? ""}${l.motion}`} className={l.close ? undefined : "is-bare"}>
                <p className="ax-senate-m">{motionLine(l.motion)}</p>
                {l.close && (
                  <p className="ax-senate-r">
                    <span>The chair</span> {l.close}
                  </p>
                )}
                {l.at && <time dateTime={l.at}>{whenArgued(l.at, now)}</time>}
              </li>
            ))}
          </ol>
          {!searching && lines.length > SHOWN && (
            <button className="ax-more" type="button" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? "Fewer motions" : `All ${lines.length} motions`}
              <Chevron />
            </button>
          )}
        </>
      )}
    </section>
  );
}
