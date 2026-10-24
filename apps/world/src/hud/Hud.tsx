import { LINEAGES, PRESET_BY_ID, RELATIONSHIP_LABEL, ROOMS, ROOM_IDS, pendingApprovals, relationshipsOf, roomAngle, type ApprovalRecord, type LatticeState, type RoomId } from "@ceo/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { clock } from "../clock.ts";
import type { GlitchLevel } from "../glitches/scheduler.ts";
import { useCast } from "../cast/castStore.ts";
import { useWorld } from "../store.ts";
import { Decode, TideScript } from "../tide/Decode.tsx";
import { ROOM_ABOUT } from "../rooms/about.ts";
import { Dossier } from "./Dossier.tsx";
import { DayClock, DeckButton, KernelConsole, PanelButtons, TrophyPanel, usePanels } from "./Extras.tsx";
import { unlock } from "../achievements/achievements.ts";
import { feedLines, formatClock, type FeedLine } from "./format.ts";
import { navigate } from "../route.ts";
import { noticeVisible } from "../kernel/notices.ts";
import { pinned, useCatchup } from "../kernel/catchup.ts";
import { enterEyes, useEyes } from "../eyes/eyes.ts";
import { roomRgb, weaveBus } from "../weave/bus.ts";
import { goToView } from "../map/view.ts";
import { useStreaming } from "../scene/roomScope.ts";

/** A room's thread colour as a CSS variable, for the Weave's rules and threads (weave/weave.css). */
const rgbVar = (room: RoomId | null) => ({ "--lw-rgb": roomRgb(room ?? undefined) }) as React.CSSProperties;

/**
 * The HUD, in The Tide's interface language: hairlines and wide-tracked labels on near-black, text that
 * decodes out of the Tide's script, boxes only for things that really are objects (approval requests).
 */

const asset = (p: string) => `${import.meta.env.BASE_URL}tide/${p}`;
const shortName = (room: RoomId) => ROOMS[room].name.replace(/^The /, "");

function useLatticeClock() {
  const [time, setTime] = useState("00:00:00");
  useEffect(() => {
    const id = setInterval(() => setTime(formatClock(clock.sim)), 500);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function roomStats(lattice: LatticeState, room: RoomId) {
  const agents = Object.values(lattice.agents).filter((a) => a.place.room === room);
  const tasks = Object.values(lattice.tasks).filter((t) => t.room === room);
  return {
    agents: agents.length,
    running: tasks.filter((t) => t.status === "running").length,
    shipped: tasks.filter((t) => t.status === "success").length,
    oops: tasks.filter((t) => t.status === "failure").length,
    waiting: Object.values(lattice.approvals).filter((a) => a.status === "pending" && a.request.room === room).length,
  };
}

function TopBar() {
  const focus = useWorld((s) => s.focus);
  const setFocus = useWorld((s) => s.setFocus);
  // The C.E.O.'s count is real work only; the demo's approvals wait inside their rooms.
  const pending = useWorld((s) => pendingApprovals(s.lattice, true).length);
  const time = useLatticeClock();
  return (
    <header className="topbar">
      {/* A room change runs one thread in its colour under the bar, as a Desk page change does (#374). */}
      <span key={focus ?? "lattice"} className="lw-change" style={rgbVar(focus)} aria-hidden="true" />
      <button className="mark" onClick={() => setFocus(null)} aria-label="C.E.O. — back to the overview">
        <img src={asset("syntherion-sigil.webp")} alt="" />
        <span className="mark__name">C.E.O.</span>
      </button>
      <span className="topbar__rule" />
      <nav className="nav" aria-label="Rooms">
        <button className={focus === null ? "on" : ""} onClick={() => setFocus(null)} data-room="overview">
          Lattice
        </button>
        {ROOM_IDS.map((id) => (
          <button key={id} className={focus === id ? "on" : ""} onClick={() => setFocus(id)} data-room={id} title={ROOMS[id].workstream}>
            {shortName(id)}
          </button>
        ))}
      </nav>
      <div className="topbar__right">
        <ViewSwitch />
        <a className="topbar__desk" href="/" onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate("today"); }} title="Back to the Desk">
          Desk
        </a>
        <DayClock />
        <span className="tracked faint">Lattice time</span>
        <span className="tracked">{time}</span>
        <span className={`ring-count ${pending ? "ring-count--hot" : ""}`} title="Waiting on the C.E.O.">
          {pending}
        </span>
      </div>
    </header>
  );
}

/**
 * The way out to the map, and from one room on its own to the whole ring (#332). One room in 3D loads only that room;
 * the whole Lattice is its own, heavier view.
 */
function ViewSwitch() {
  const solo = useStreaming((s) => s.solo);
  return (
    <>
      <button className="topbar__view" onClick={() => goToView({ kind: "map" })} data-view="map" title="Back to the map of the ring">
        ← Map
      </button>
      {solo && (
        <button className="topbar__view" onClick={() => goToView({ kind: "ring", room: solo })} data-view="ring" title="Load all ten rooms in 3D (heavier)">
          Whole Lattice
        </button>
      )}
    </>
  );
}

const OVERVIEW_LINES = ["Agents work.", "The Lattice responds.", "The C.E.O. approves."];

function TitleBlock({ children }: { children?: React.ReactNode }) {
  const focus = useWorld((s) => s.focus);
  const lattice = useWorld((s) => s.lattice);
  const [about, setAbout] = useState(false);
  const index = focus ? String(ROOM_IDS.indexOf(focus) + 1).padStart(2, "0") : "00";
  const title = focus ? ROOMS[focus].name : "The Lattice";
  const sub = focus ? ROOMS[focus].workstream : "Command Everything, Obviously";
  const lines = useMemo(() => {
    if (!focus) return OVERVIEW_LINES;
    const st = roomStats(lattice, focus);
    return [`Agents ${st.agents} · Running ${st.running}`, `Shipped ${st.shipped} · Oops ${st.oops}`, st.waiting ? `Waiting on you ${st.waiting}` : "Nothing waiting on you"];
  }, [focus, lattice]);
  const info = focus ? ROOM_ABOUT[focus] : null;
  return (
    <section className="title-block" style={rgbVar(focus)}>
      <p className="eyebrow">
        {index} / {focus ? shortName(focus) : "Lattice"}
        <span key={focus ?? "lattice"} className="lw-rule" aria-hidden="true" />
      </p>
      <h1 className="display">
        <Decode text={title.toUpperCase()} />
      </h1>
      <p className="tracked muted sub">
        <Decode text={sub} delay={200} tick={16} />
      </p>
      {info ? (
        <>
          {/* One status line; the rest waits behind "About this room" (#328). */}
          <p className="tracked faint status-line">{lines.join(" · ")}</p>
          <button className="tracked about__toggle" onClick={() => setAbout(!about)} aria-expanded={about}>
            {about ? "− Less about this room" : "+ About this room"}
          </button>
          {about && (
            <div className="about">
              <p className="about__blurb">{info.blurb}</p>
              <dl>
                {Object.entries(info.stations).map(([id, what]) => (
                  <div key={id}>
                    <dt className="tracked">{ROOMS[focus!].stations.find((st) => st.id === id)?.label ?? id}</dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
              <p className="about__phase">
                <span className="tracked faint">Today</span> {info.today}
              </p>
              <p className="about__phase">
                <span className="tracked faint">Next</span> {info.next}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="lines">
          {lines.map((l) => (
            <p key={l} className="tracked faint">
              {l}
            </p>
          ))}
        </div>
      )}
      {children}
      <span className="lw-dots" aria-hidden="true">
        <i />
      </span>
    </section>
  );
}

function Roster({ open, folded = false }: { open: boolean; folded?: boolean }) {
  const [unfolded, setUnfolded] = useState(false);
  const all = useWorld((s) => s.lattice.agents);
  const tasks = useWorld((s) => s.lattice.tasks);
  const focus = useWorld((s) => s.focus);
  const cast = useCast((s) => s.cast);
  const openStudio = useCast((s) => s.openStudio);
  const agents = useMemo(
    () =>
      Object.values(all)
        .filter((a) => !focus || a.place.room === focus)
        .map((a) => {
          const p = cast.profiles[a.agent.id];
          const task = a.taskId ? tasks[a.taskId] : undefined;
          return {
            id: a.agent.id,
            name: p?.name ?? a.agent.name,
            lineage: p?.lineage ?? a.agent.lineage,
            accent: p?.look.accent ?? LINEAGES[a.agent.lineage].accent,
            role: p?.role ?? a.agent.role,
            costume: p?.look.preset ? PRESET_BY_ID[p.look.preset]?.name : undefined,
            traits: p?.personality.traits ?? [],
            room: a.place.room,
            task: task?.status === "running" ? task : undefined,
            rels: relationshipsOf(cast, a.agent.id).slice(0, 2),
            activity: a.motion && clock.sim < a.motion.startTs + a.motion.duration ? "walking" : a.activity,
          };
        }),
    [all, tasks, focus, cast],
  );
  const selected = useWorld((s) => s.selectedAgent);
  const selectAgent = useWorld((s) => s.selectAgent);
  const hoverAgent = useWorld((s) => s.hoverAgent);
  if (folded && !unfolded && !open) {
    // In a room the roster is one line in the room's panel: who's here, and a tap for the list (#328).
    return (
      <section className="roster roster--panel" aria-label="Agents">
        <button className="tracked roster__fold" onClick={() => setUnfolded(true)} aria-expanded={false}>
          In {focus ? shortName(focus) : "the Lattice"} · {agents.length ? agents.map((a) => a.name).join(", ") : "nobody"} ▸
        </button>
      </section>
    );
  }
  return (
    <section className={`${folded && !open ? "roster--panel" : "rail"} roster ${focus ? "roster--room" : ""} ${open ? "rail--open" : ""}`} aria-label="Agents">
      {folded ? (
        <button className="tracked roster__fold eyebrow" onClick={() => setUnfolded(false)} aria-expanded>
          In {focus ? shortName(focus) : "the Lattice"} · {agents.length} ▾
        </button>
      ) : (
        <p className="eyebrow">{focus ? `In ${shortName(focus)} · ${agents.length}` : "Roster"}</p>
      )}
      <ul>
        {agents.length === 0 && <li className="roster__empty">Nobody's here right now.</li>}
        {agents.map((a) => (
          <li key={a.id}>
            <button
              className={selected === a.id ? "on" : ""}
              onClick={() => selectAgent(selected === a.id ? null : a.id)}
              onMouseEnter={() => hoverAgent(a.id)}
              onMouseLeave={() => hoverAgent(null)}
            >
              <i className="ring" style={{ boxShadow: `0 0 8px ${a.accent}` }} />
              <span className="roster__name">{a.name}</span>
              <span className={`roster__act act--${a.activity}`}>{a.activity}</span>
              <span className="roster__meta">
                {focus ? `${a.role}${a.costume ? ` · ${a.costume}` : ""}` : `${LINEAGES[a.lineage].name} · ${shortName(a.room)}`}
              </span>
              {focus && (
                <span className="roster__more">
                  {a.task && (
                    <span className="roster__task">
                      {a.task.title}
                      <i className="roster__bar">
                        <i style={{ width: `${Math.round(a.task.progress * 100)}%`, background: a.accent }} />
                      </i>
                    </span>
                  )}
                  {a.traits.length > 0 && <span className="roster__traits">{a.traits.slice(0, 3).join(" · ")}</span>}
                  {a.rels.map((r) => (
                    <span key={r.index} className="roster__rel">
                      {RELATIONSHIP_LABEL[r.kind]} · {cast.profiles[r.other]?.name ?? r.other}
                    </span>
                  ))}
                </span>
              )}
            </button>
            <button className="roster__edit" onClick={() => openStudio(a.id)} aria-label={`Open ${a.name} in the agent studio`} title="Agent studio">
              ✎
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Signals({ open, full }: { open: boolean; full: boolean }) {
  const lattice = useWorld((s) => s.lattice);
  const focus = useWorld((s) => s.focus);
  const kernelLog = useWorld((s) => s.kernelLog);
  const profiles = useCast((s) => s.cast.profiles);
  const catchup = useCatchup((s) => s.catchup);
  const lines = useMemo(() => {
    // The Lattice-wide view hears only real agents; each room still shows its demo and the Kernel's calls.
    const events = feedLines(lattice, 22, (id) => profiles[id]?.name, focus, !focus);
    const kernel: FeedLine[] = (focus ? kernelLog.filter((k) => k.room === focus) : [])
      .slice(0, 8)
      .map((k) => ({ id: k.id, ts: k.ts, kind: "kernel", who: "Skippy", text: k.text, room: k.room ?? undefined }));
    // The catch-up in full, in every view (the PA clamps it to two lines).
    if (catchup) kernel.push({ id: `catchup-${catchup.step}`, ts: catchup.ts, kind: "kernel", who: "Skippy", text: `While you were away: ${catchup.text}` });
    return [...events, ...kernel].sort((x, y) => y.ts - x.ts).slice(0, 22);
  }, [lattice, profiles, focus, kernelLog, catchup]);
  const selectAgent = useWorld((s) => s.selectAgent);
  const knotRef = useCallback((el: HTMLElement | null) => {
    if (el) weaveBus.knot = el;
    else if (weaveBus.knot && !weaveBus.knot.isConnected) weaveBus.knot = null;
  }, []);
  return (
    // A one-line ticker of the latest signal; the whole feed on hover, on F, or as the phone's tab (#328).
    <section id="feed-panel" className={`rail signals ${open ? "rail--open" : ""} ${full || open ? "" : "signals--ticker"}`} aria-label="Signals" tabIndex={-1}>
      <p className="eyebrow">
        {/* Where a real signal's thread lands (weave/WeaveProbe.tsx). */}
        <i className="lw-knot" ref={knotRef} aria-hidden="true" />
        {focus ? `Signals · ${shortName(focus)}` : "Signals"}
      </p>
      <ol>
        {lines.length === 0 && (
          <li className="sig sig--empty">{focus ? "Quiet in here. Suspiciously quiet." : "No real agents on the line yet. The Relay is first."}</li>
        )}
        {lines.map((l) => (
          <li key={l.id} className={`sig sig--${l.kind}`}>
            <time>{formatClock(l.ts).slice(3)}</time>
            <span>
              {l.kind === "kernel" ? (
                <b className="sig__kernel">Skippy</b>
              ) : (
                l.who && (
                  <button className="link" onClick={() => l.agentId && selectAgent(l.agentId)}>
                    {l.who}
                  </button>
                )
              )}{" "}
              {l.text}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ApprovalCard({ rec }: { rec: ApprovalRecord }) {
  const agentName = useCast((s) => s.cast.profiles[rec.request.agentId]?.name);
  const resolve = useWorld((s) => s.resolveApproval);
  const setFocus = useWorld((s) => s.setFocus);
  const r = rec.request;
  return (
    <article className={`approval risk--${r.risk}`} data-approval={r.id}>
      <header>
        <button className="link tracked" onClick={() => setFocus(r.room)}>
          {agentName ?? r.agentId} · {shortName(r.room)}
        </button>
        <span className="tracked approval__risk">{r.risk}</span>
      </header>
      <p className="approval__summary">{r.summary}</p>
      {r.detail && <p className="approval__detail">{r.detail}</p>}
      <footer>
        <span className="approval__policy">{r.action} · approve</span>
        <button
          className="smoky"
          onClick={() => {
            unlock("no-boss");
            resolve(r.id, "denied");
          }}
        >
          Deny
        </button>
        <button
          className="smoky smoky--bright"
          onClick={() => {
            unlock("yes-boss");
            resolve(r.id, "approved");
          }}
        >
          Approve
        </button>
      </footer>
    </article>
  );
}

function Approvals() {
  const pending = useWorld(useShallow((s) => pendingApprovals(s.lattice)));
  const focus = useWorld((s) => s.focus);
  const setFocus = useWorld((s) => s.setFocus);
  // A room shows everything waiting in it; the Lattice-wide view shows only real agents' asks.
  const here = focus ? pending.filter((p) => p.request.room === focus) : pending.filter((p) => p.live);
  const elsewhere = pending.filter((p) => p.live).length - here.filter((p) => p.live).length;
  const shown = here.slice(0, 3);
  if (!here.length && elsewhere <= 0) return null;
  return (
    <section className="approvals" aria-label="Waiting for your approval">
      {shown.map((rec) => (
        <ApprovalCard key={rec.request.id} rec={rec} />
      ))}
      {here.length > shown.length && <div className="approvals__more tracked">+{here.length - shown.length} more here</div>}
      {focus && elsewhere > 0 && (
        <button className="approvals__more tracked link" onClick={() => setFocus(null)}>
          +{elsewhere} elsewhere
        </button>
      )}
    </section>
  );
}

/** The Kernel's PA, top centre: the catch-up pinned until read (#54), and after it one line at a time, gone once read. */
function PA() {
  const catchup = useCatchup((s) => pinned(s.catchup));
  const markRead = useCatchup((s) => s.read);
  return (
    <div className="pa">
      {catchup && (
        <div className="announce announce--pinned" role="status">
          <span className="eyebrow">Skippy · while you were away</span>
          <span className="announce__text" title={catchup.text}>
            {catchup.text}
          </span>
          <button className="announce__read tracked" onClick={markRead} aria-label="Mark “While you were away” as read">
            Read
          </button>
        </div>
      )}
      <Announcement />
    </div>
  );
}

function Announcement() {
  const a = useWorld((s) => s.announcement);
  const focus = useWorld((s) => s.focus);
  const [, force] = useState(0);
  useEffect(() => {
    if (!a) return;
    const t = setTimeout(() => force((n) => n + 1), Math.max(0, a.until - performance.now()));
    return () => clearTimeout(t);
  }, [a]);
  // A room's demo drills are heard in that room only; real events, achievements and night/day changes show anywhere.
  if (!a || a.until < performance.now() || !noticeVisible(a, focus)) return null;
  return (
    <div className={`announce announce--${a.tone}`} role="status" key={a.until}>
      <span className="announce__mark" aria-hidden="true" />
      <span className="eyebrow">Skippy · {a.tone === "assign" ? "dispatch" : a.tone === "scold" ? "incident" : a.tone === "nag" ? "reminder" : a.tone === "praise" ? "acknowledged" : "status"}</span>
      <span className="announce__text">{a.text}</span>
    </div>
  );
}

const SPEEDS = [0.5, 1, 2, 4];
const LEVELS: GlitchLevel[] = ["off", "normal", "unhinged"];
const LEVEL_LABEL: Record<GlitchLevel, string> = { off: "Serious", normal: "Normal", unhinged: "Unhinged" };

/** The footer strip: like the Tide's "Observe / Discover / Preserve", but every word is a switch. */
function Footer() {
  const focus = useWorld((st) => st.focus);
  const s = useWorld(
    useShallow((st) => ({
      timeScale: st.timeScale,
      setTimeScale: st.setTimeScale,
      glitchLevel: st.glitchLevel,
      setGlitchLevel: st.setGlitchLevel,
      sound: st.sound,
      setSound: st.setSound,
      quality: st.quality,
      setQuality: st.setQuality,
    })),
  );
  const next = <T,>(list: T[], v: T) => list[(list.indexOf(v) + 1) % list.length]!;
  const [more, setMore] = useState(false);
  return (
    <footer className="footer">
      <p className="footer__left tracked faint">
        <span className="footer__rule" /> A living lattice of agents
      </p>
      {more && (
        // Keys and settings, behind "?" (#328).
        <div className="footer__more" role="group" aria-label="Keys and settings">
          <p className="tracked faint footer__keys">
            {focus ? "S · outward" : "W · inward"} · A D · rooms · E · studio · B · Brogu's eyes · F · signals · H · clean view
          </p>
          <div className="controls">
            <button className="tracked" onClick={() => s.setTimeScale(next(SPEEDS, s.timeScale))} data-control="speed">
              Speed <b>{s.timeScale}×</b>
            </button>
            <span className="slash">/</span>
            <button className="tracked" onClick={() => s.setGlitchLevel(next(LEVELS, s.glitchLevel))} data-control="glitches">
              Glitches <b>{LEVEL_LABEL[s.glitchLevel]}</b>
            </button>
            <span className="slash">/</span>
            <button className="tracked" onClick={() => s.setSound(!s.sound)} data-control="sound">
              Sound <b>{s.sound ? "On" : "Off"}</b>
            </button>
            <span className="slash">/</span>
            <button className="tracked" onClick={() => s.setQuality(s.quality === "high" ? "low" : "high")} data-control="fx">
              FX <b>{s.quality}</b>
            </button>
          </div>
        </div>
      )}
      <div className="footer__right controls" role="group" aria-label="Controls">
        <button className="tracked" onClick={enterEyes} data-control="eyes" title="Walk Brogu round the room you're looking at, and see it through his eyes (B)">
          Brogu's <b>eyes</b>
        </button>
        <span className="slash">/</span>
        <PanelButtons />
        <span className="slash">/</span>
        <DeckButton />
        <span className="slash">/</span>
        <button className={`tracked footer__q ${more ? "on" : ""}`} onClick={() => setMore(!more)} aria-expanded={more} aria-label="Keys and settings" title="Keys and settings">
          <b>?</b>
        </button>
      </div>
    </footer>
  );
}

/** In a room, the bearing and the Lattice's time are one line of its panel (#328). */
function CoordsLine() {
  const focus = useWorld((s) => s.focus);
  const time = useLatticeClock();
  if (!focus) return null;
  return (
    <p className="tracked faint coords-line">
      {((roomAngle(focus) * 180) / Math.PI).toFixed(3)}° θ / 34.000 R / {time}
    </p>
  );
}

/** Bottom-right, on the overview: the Lattice's name in the Tide's script and the time, in a bracketed box. */
function Coordinates() {
  const focus = useWorld((s) => s.focus);
  const time = useLatticeClock();
  const bearing = focus ? ((roomAngle(focus) * 180) / Math.PI).toFixed(3) : "0.000";
  return (
    <div className="coords">
      <div className="coords__box">
        <TideScript text={focus ? shortName(focus) : "Lattice"} />
      </div>
      <p className="tracked faint">
        {bearing}° θ / {focus ? "34.000 R" : "0.000 R"} / {time}
      </p>
    </div>
  );
}

/** The overlay's own state (#328): faded after a quiet spell, hidden for a clean view (H), the full feed (F). */
export const useOverlay = create<{ clean: boolean; full: boolean; toggleClean: () => void; toggleFull: () => void }>((set) => ({
  clean: false,
  full: false,
  toggleClean: () => set((s) => ({ clean: !s.clean })),
  toggleFull: () => set((s) => ({ full: !s.full })),
}));

const IDLE_MS = 4000;

/** True after IDLE_MS without a pointer, key, wheel or touch; any of them brings the panels straight back. */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      clearTimeout(t);
      setIdle(false);
      t = setTimeout(() => setIdle(true), IDLE_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    return () => {
      clearTimeout(t);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, []);
  return idle;
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Behind Brogu's eyes the keys walk him (eyes/EyesHud.tsx); B and Esc in and out are handled there too.
      if (e.defaultPrevented || useEyes.getState().active) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const s = useWorld.getState();
      if (e.key === "`") {
        e.preventDefault();
        return usePanels.getState().toggle("console");
      }
      if (e.key === "Escape") {
        if (usePanels.getState().open) return usePanels.getState().close();
        if (useCast.getState().studio) return useCast.getState().openStudio(null);
        if (s.selectedAgent) s.selectAgent(null);
        s.setFocus(null);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "h") return useOverlay.getState().toggleClean();
      if (k === "f") return useOverlay.getState().toggleFull();
      // WASD: A/D step between rooms, W goes in, S backs out.
      if (k === "d") s.cycleFocus(1);
      else if (k === "a") s.cycleFocus(-1);
      else if (k === "w") {
        if (!s.focus) s.setFocus(ROOM_IDS[0]!);
      } else if (k === "s") {
        if (useCast.getState().studio) useCast.getState().openStudio(null);
        else if (s.selectedAgent) s.selectAgent(null);
        else s.setFocus(null);
      }
      // 1 to 9 are the first nine rooms, 0 the tenth (the Studio).
      else if (/^[0-9]$/.test(e.key) && ROOM_IDS[e.key === "0" ? 9 : Number(e.key) - 1]) s.setFocus(ROOM_IDS[e.key === "0" ? 9 : Number(e.key) - 1]!);
      else if (e.key === "0") s.setFocus(null);
      else if (e.key.toLowerCase() === "e" && s.selectedAgent) useCast.getState().openStudio(s.selectedAgent);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function Hud() {
  useKeyboard();
  const [panel, setPanel] = useState<"roster" | "signals" | null>(null);
  const studio = useCast((s) => s.studio !== null);
  const selected = useWorld((s) => s.selectedAgent);
  const eyes = useEyes((s) => s.active);
  const focus = useWorld((s) => s.focus);
  const idle = useIdle();
  const clean = useOverlay((s) => s.clean);
  const full = useOverlay((s) => s.full);
  useEffect(() => {
    weaveBus.idle = idle && !panel;
  }, [idle, panel]);
  return (
    <div className={`hud ${studio ? "hud--studio" : ""} ${eyes ? "hud--eyes" : ""} ${idle && !panel ? "hud--idle" : ""} ${clean ? "hud--clean" : ""}`}>
      <TopBar />
      <div className="leftcol">
        {focus ? (
          <TitleBlock>
            <CoordsLine />
            <Roster open={panel === "roster"} folded />
          </TitleBlock>
        ) : (
          <>
            <TitleBlock />
            <Roster open={panel === "roster"} />
          </>
        )}
      </div>
      <PA />
      {selected && !studio ? <Dossier key={selected} id={selected} open={panel === "signals"} /> : <Signals open={panel === "signals"} full={full} />}
      <Approvals />
      <KernelConsole />
      <TrophyPanel />
      {!focus && <Coordinates />}
      <Footer />
      <div className="mobile-tabs">
        <button className={`tracked ${panel === "roster" ? "on" : ""}`} onClick={() => setPanel(panel === "roster" ? null : "roster")}>
          Roster
        </button>
        <button className={`tracked ${panel === "signals" ? "on" : ""}`} onClick={() => setPanel(panel === "signals" ? null : "signals")}>
          Signals
        </button>
      </div>
    </div>
  );
}
