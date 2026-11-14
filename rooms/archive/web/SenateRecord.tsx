import { useEffect, useState } from "react";
import { motionLine, readRecord, whenArgued, type RecordLine } from "../data/senateRecord.ts";
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
  if (record.status !== "ready")
    return (
      <section className="ax-senate" aria-label="The Senate Record">
        <p className="wv-note">{record.status === "loading" ? "Opening the record…" : "Can't reach the Senate Record right now."}</p>
      </section>
    );
  const { lines } = record;
  const shown = all ? lines : lines.slice(0, SHOWN);
  return (
    <section className="ax-senate" aria-label="The Senate Record">
      <p className="fl-k">Motions, newest first</p>
      {!lines.length ? (
        <p className="wv-note">No motions yet. The Senate argues one whenever the chamber is in recess.</p>
      ) : (
        <>
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
          {lines.length > SHOWN && (
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
