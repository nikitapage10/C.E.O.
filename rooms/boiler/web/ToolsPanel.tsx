import { useEffect, useState } from "react";
import { loadToolbelt } from "@ceo/engine/tools";
import { beltLine, KIND_TONE, KIND_WORD, toolbelt, type Belt } from "../data/toolbelt.ts";

/**
 * Controls > Skippy's tools (#847): every tool Skippy's agent can call, room by room, from the registry the server runs
 * (plugged in by the Desk, loaded when this page opens). The chart is one row per room, a square per tool in its kind's
 * colour; the detail names each tool, what it does and whether it works on a call. Titles only, never a tool's prompt,
 * and the same signed in or out: it shows what the code allows, nothing of Nikita's.
 */

export function useToolbelt(): Belt | null {
  const [belt, setBelt] = useState<Belt | null>(null);
  useEffect(() => {
    let live = true;
    loadToolbelt().then(
      (tools) => live && setBelt(toolbelt(tools)),
      () => live && setBelt(toolbelt([])),
    );
    return () => {
      live = false;
    };
  }, []);
  return belt;
}

export const toolsSub = (b: Belt | null): string => (b ? beltLine(b) : "reading the registry");

const KEY = (["reads", "changes", "asks"] as const).map((k) => ({ k, word: KIND_WORD[k], tone: KIND_TONE[k] }));

export function ToolsChart({ belt }: { belt: Belt | null }) {
  if (!belt) return <p className="bx-note">Reading Skippy's tools…</p>;
  if (!belt.total) return <p className="bx-note">No room has plugged its tools in.</p>;
  return (
    <div className="ct-tools">
      <ul className="bx-rows" aria-label="Skippy's tools in each room">
        {belt.rooms.map((r) => (
          <li key={r.room}>
            <i className="bx-dot is-ok" aria-hidden="true" />
            <b>{r.name}</b>
            <span className="bx-chart ct-tsq" aria-hidden="true">
              {r.tools.map((t) => (
                <i key={t.name} className={`is-${KIND_TONE[t.kind]}`} title={`${t.title} · ${KIND_WORD[t.kind]}`} />
              ))}
            </span>
            <span className="bx-word">
              {r.tools.length} {r.tools.length === 1 ? "tool" : "tools"}
            </span>
          </li>
        ))}
      </ul>
      <p className="bx-note ct-tkey">
        {KEY.map(({ k, word, tone }) => (
          <span key={k} className={`is-${tone}`}>
            <i aria-hidden="true" />
            {belt[k]} {word}
          </span>
        ))}
        <span>{belt.spoken} work on a call</span>
      </p>
    </div>
  );
}

export function ToolsDetail({ belt }: { belt: Belt | null }) {
  if (!belt?.total) return null;
  return (
    <div className="ct-tdetail">
      {belt.rooms.map((r) => (
        <section key={r.room} aria-label={`${r.name}'s tools`}>
          <h3>{r.name}</h3>
          <ul>
            {r.tools.map((t) => (
              <li key={t.name} className={`is-${KIND_TONE[t.kind]}`}>
                <i className="bx-dot" aria-hidden="true" />
                <span>{t.title}</span>
                <em>{KIND_WORD[t.kind]}</em>
                <small>{t.spoken ? "on a call too" : "Desk only"}</small>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="ct-note">
        Anything that sends, spends or deletes waits for your Yes on the Desk, and a call or a room mic, which can't show the button, never gets those tools. Once anything fetched from the web is in a turn, only reads run.
      </p>
    </div>
  );
}
