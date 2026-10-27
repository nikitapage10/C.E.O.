import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RoomId } from "../../chronicle.ts";
import { CREW, useFoundry } from "../../foundry.ts";
import { ideaTitle } from "../IdeaCard.tsx";
import { roomLink } from "../hero/roomLink.ts";
import type { PulseState, RoomPulse } from "../roomPulse.ts";
import { driveOf } from "../flow/tempo.ts";
import { useSkippy } from "../skippy/chat.ts";
import { mtTime } from "../todaySchedule.ts";
import { RC, reducedMotion, useViz } from "../wvCanvas.ts";
import { Talks, useTalks } from "./Talks.tsx";
import { makeStage, type StageState } from "./stage.ts";
import { useRiseFeed } from "./rise.ts";
import { RISES } from "./sand.ts";

/**
 * Confluence, the top of Today (#413; round 9's T1, Nikita's pick 2026-10-24 21:30Z). The stage (stage.ts) runs under
 * everything here: the Council along the bottom as figures of light, their rooms' work streaming up into Skippy. Over
 * it, in plain type: the top face (`top`: the greeting and the day's ledger), the helm (`helm`: the channel to Skippy,
 * the broadcast, what runs next, the way into the Lattice) and, in the top right, "Held for you" (`held`), what needs
 * Nikita now. Point at a figure and it turns into Skippy's own shape for as long as you look; open one and the panel
 * says what happened in its room today, with your talks. Real data only.
 */

const STATE_WORD: Record<PulseState, string> = { busy: "busy", steady: "steady", waiting: "waiting", down: "needs a look", sim: "not set up" };
/** What each room's knots are, said plainly in the panel. */
const MOMENT: Partial<Record<RoomId, string>> = { archive: "An hour of Ilyr written", relay: "Email checked", boiler: "A link checked" };
const job = (title: string) => title.replace(/^The /, "");

export interface ConfluenceProps {
  pulses: RoomPulse[];
  now: number;
  since: number;
  hour: number;
  /** Rooms with something held for Nikita. */
  needs: string[];
  /** Skippy's line for his own panel. */
  skippySays: string;
  top: ReactNode;
  held: ReactNode;
  helm: ReactNode;
  /** Gives the page a way to light a room's figure and stream (Held for you rows call it on hover). */
  hotRef: React.MutableRefObject<(room: string | null) => void>;
}

export function Confluence({ pulses, now, since, hour, needs, skippySays, top, held, helm, hotRef }: ConfluenceProps) {
  const root = useRef<HTMLElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<string | null>(null);
  useTalks();
  useRiseFeed(pulses);

  // The stage's own state: changed in place by events, read by the frame. Never a React render per frame.
  const S = useRef<StageState>({ pulses, needs: new Set(needs), sel: null, hot: null, now, since, hour }).current;
  const stage = useMemo(() => makeStage(() => root.current, S), [S]);
  const V = useViz(cv, stage.spec);

  const needKey = needs.join(",");
  useEffect(() => {
    S.pulses = pulses;
    S.needs = new Set(needKey ? needKey.split(",") : []);
    S.now = now;
    S.since = since;
    S.hour = hour;
    V.current?.relayout();
  }, [S, V, pulses, needKey, now, since, hour]);

  // Held for you changes height (a card opens, a row arrives): its leads follow.
  useEffect(() => {
    const el = root.current?.querySelector("[data-cf-held]");
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => V.current?.relayout());
    ro.observe(el);
    return () => ro.disconnect();
  }, [V]);

  // A figure lights while its words rise.
  useEffect(() => {
    RISES.onStart = (room) => {
      const el = root.current?.querySelector(`[data-cf-fig="${room}"]`);
      if (!el) return;
      el.classList.add("is-speaking");
      window.setTimeout(() => el.classList.remove("is-speaking"), 2600);
    };
    return () => {
      RISES.onStart = null;
    };
  }, []);

  const point = (id: string | null) => {
    if (S.hot && S.hot !== id) {
      const b = stage.beings.get(S.hot);
      if (b) b.want = 0;
    }
    S.hot = id;
    if (id) {
      const b = stage.beings.get(id);
      if (b) b.want = 1;
    }
    const el = root.current;
    if (el) {
      if (id) el.dataset.hot = id;
      else delete el.dataset.hot;
    }
    if (reducedMotion()) V.current?.relayout();
  };
  hotRef.current = point;

  const open = (id: string | null) => {
    if (S.sel) {
      const b = stage.beings.get(S.sel);
      if (b) b.hold = false;
    }
    const next = id && id === S.sel ? null : id;
    S.sel = next;
    if (next) {
      const b = stage.beings.get(next);
      if (b) b.hold = true;
    }
    setSel(next);
    V.current?.relayout();
  };

  useEffect(() => {
    if (!sel) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && open(null);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const active = pulses.filter((p) => p.submind.active).length;
  const real = pulses.filter((p) => p.real && p.state !== "sim").length;
  const need = new Set(needs);

  return (
    <section ref={root} className={`cf-hero${sel ? " has-sel" : ""}`} aria-label="Today">
      <div className="cf-river">
        <canvas ref={cv} className="cf-cv" aria-hidden="true" />
        <button type="button" className={`cf-sk${sel === "kernel" ? " is-sel" : ""}`} data-cf-fig="kernel" onClick={() => open("kernel")} onPointerEnter={() => point("kernel")} onPointerLeave={() => point(null)} onFocus={() => point("kernel")} onBlur={() => point(null)} aria-expanded={sel === "kernel"} aria-label="Skippy, the Magnificent: open what he says">
          <span className="cf-sk-mark" data-cf-sk aria-hidden="true" />
          <span className="cf-sk-t">
            <b>Skippy, the Magnificent</b>
            <small>where the river ends</small>
          </span>
        </button>
        <div className="cf-council">
          <p className="cf-council-k">
            <span>The Council of Skippies</span> in session · {active} of {pulses.length} subminds active · {real} {real === 1 ? "room runs" : "rooms run"} real work · tap one to hear it
          </p>
          <ol className="cf-figs">
            {pulses.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`cf-fig is-${p.state}${sel === p.id ? " is-sel" : ""}${need.has(p.id) ? " is-need" : ""}`}
                  data-cf-fig={p.id}
                  data-room={p.id}
                  style={{ "--c": RC[p.id] } as React.CSSProperties}
                  aria-expanded={sel === p.id}
                  aria-label={`${p.submind.title}, ${p.name}: ${p.status}${need.has(p.id) ? ", something is held for you" : ""}`}
                  onClick={() => open(p.id)}
                  onPointerEnter={() => point(p.id)}
                  onPointerLeave={() => point(null)}
                  onFocus={() => point(p.id)}
                  onBlur={() => point(null)}
                >
                  <span className="cf-mark" data-cf-mark={p.id} aria-hidden="true" />
                  <b>{p.name}</b>
                  <i>{job(p.submind.title)}</i>
                  <small>{p.state === "sim" ? "not set up" : p.short}</small>
                </button>
              </li>
            ))}
          </ol>
          <Drive pulses={pulses} />
        </div>
      </div>
      <header className="cf-top">{top}</header>
      <div className="cf-held" data-cf-held>
        {held}
      </div>
      <div className="cf-helm">{helm}</div>
      {sel && <Panel id={sel} pulses={pulses} now={now} since={since} skippySays={skippySays} active={active} onClose={() => open(null)} />}
    </section>
  );
}

/** The small legend under the Council (#262): what is moving the streams, busiest first, and how many rooms idle. */
function Drive({ pulses }: { pulses: RoomPulse[] }) {
  const { lead, idle } = driveOf(pulses);
  return (
    <p className="cf-drive" title="Each stream runs faster, thicker and brighter with its room's real activity">
      <span>Streams move with real work</span>
      {lead.map((p) => (
        <span key={p.id} style={{ "--c": RC[p.id] } as React.CSSProperties}>
          <i aria-hidden="true" />
          {p.name} · {p.drive}
        </span>
      ))}
      {idle > 0 && <span>{idle} idle</span>}
    </p>
  );
}

function Panel({ id, pulses, now, since, skippySays, active, onClose }: { id: string; pulses: RoomPulse[]; now: number; since: number; skippySays: string; active: number; onClose: () => void }) {
  const setOpen = useSkippy((s) => s.setOpen);
  const changelog = useFoundry((s) => s.data.changelog);
  const box = useRef<HTMLElement>(null);
  useEffect(() => box.current?.focus({ preventScroll: true }), [id]);
  const p = pulses.find((x) => x.id === id) ?? null;
  const close = (
    <button type="button" className="cf-pn-x" onClick={onClose} aria-label="Close">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );

  if (!p) {
    return (
      <aside ref={box} tabIndex={-1} className="cf-pn" style={{ "--c": "232,207,156" } as React.CSSProperties} aria-label="Skippy, the Magnificent">
        <header>
          <div>
            <h2>Skippy, the Magnificent</h2>
            <p>The Kernel · presiding</p>
          </div>
          {close}
        </header>
        <blockquote>“{skippySays}”</blockquote>
        <h3>The Council</h3>
        <p className="cf-pn-none">
          {active} of {pulses.length} subminds are active, each with its own thread. Every stream on the page ends with him.
        </p>
        <div className="cf-pn-acts">
          <button type="button" className="cf-btn is-pri" onClick={() => setOpen(true)}>
            Talk to Skippy
          </button>
        </div>
      </aside>
    );
  }

  const shipped = p.id === "foundry" ? changelog.filter((c) => c.at >= since && c.at <= now).sort((a, b) => b.at - a.at).slice(0, 8) : [];
  const moments = p.id === "foundry" ? [] : p.events.filter((t) => t >= since && t <= now).sort((a, b) => b - a).slice(0, 8);
  const noun = MOMENT[p.id] ?? "A scene in Ilyr, set here";

  return (
    <aside ref={box} tabIndex={-1} className="cf-pn" data-room={p.id} aria-label={`${p.submind.title}, ${p.name}`}>
      <header>
        <div>
          <h2>{p.submind.title}</h2>
          <p>
            {p.name} · {STATE_WORD[p.state]}
            {p.submind.active ? " · active, its own thread" : ""}
          </p>
        </div>
        {close}
      </header>
      <blockquote>“{p.report}”</blockquote>
      {p.doing && <p className="cf-pn-doing">{p.doing}</p>}
      <h3>What happened here today</h3>
      {shipped.length > 0 ? (
        <ol className="cf-pn-l">
          {shipped.map((c) => (
            <li key={c.key}>
              <time dateTime={new Date(c.at).toISOString()}>{mtTime(c.at)}</time>
              <p>
                <b>Shipped{c.issue ? ` #${c.issue.number}` : ""}</b> {ideaTitle(c.title)}
                {c.by ? <span> · {CREW[c.by].name}</span> : null}
              </p>
            </li>
          ))}
        </ol>
      ) : moments.length > 0 ? (
        <ol className="cf-pn-l">
          {moments.map((t, i) => (
            <li key={`${t}-${i}`}>
              <time dateTime={new Date(t).toISOString()}>{mtTime(t)}</time>
              <p>{noun}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="cf-pn-none">{p.state === "sim" ? "Not set up yet: no real work is connected to this room, so there is nothing to show. Its stream stays a dashed line until it is." : "Nothing has happened here today yet. Its stream is quiet but open."}</p>
      )}
      <Talks room={p.id} who={p.submind.title} heading />
      <div className="cf-pn-acts">
        <a className="cf-btn is-pri" href={p.href} onClick={roomLink(p.href)}>
          Open {p.name} ›
        </a>
      </div>
    </aside>
  );
}
