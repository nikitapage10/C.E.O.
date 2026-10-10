import { LINEAGES, ROOMS, ROOM_IDS, pendingApprovals, roomAngle, type ApprovalRecord, type LatticeState, type RoomId } from "@ceo/core";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { clock } from "../clock.ts";
import type { GlitchLevel } from "../glitches/scheduler.ts";
import { useCast } from "../cast/castStore.ts";
import { useWorld } from "../store.ts";
import { Decode, TideScript } from "../tide/Decode.tsx";
import { feedLines, formatClock } from "./format.ts";

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
  const pending = useWorld((s) => pendingApprovals(s.lattice).length);
  const time = useLatticeClock();
  return (
    <header className="topbar">
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
        <span className="tracked faint">Lattice time</span>
        <span className="tracked">{time}</span>
        <span className={`ring-count ${pending ? "ring-count--hot" : ""}`} title="Waiting on the C.E.O.">
          {pending}
        </span>
      </div>
    </header>
  );
}

const OVERVIEW_LINES = ["Agents work.", "The Lattice responds.", "The C.E.O. approves."];

function TitleBlock() {
  const focus = useWorld((s) => s.focus);
  const lattice = useWorld((s) => s.lattice);
  const index = focus ? String(ROOM_IDS.indexOf(focus) + 1).padStart(2, "0") : "00";
  const title = focus ? ROOMS[focus].name : "The Lattice";
  const sub = focus ? ROOMS[focus].workstream : "Command Everything, Obviously";
  const lines = useMemo(() => {
    if (!focus) return OVERVIEW_LINES;
    const st = roomStats(lattice, focus);
    return [`Agents ${st.agents} · Running ${st.running}`, `Shipped ${st.shipped} · Oops ${st.oops}`, st.waiting ? `Waiting on you ${st.waiting}` : "Nothing waiting on you"];
  }, [focus, lattice]);
  return (
    <section className="title-block">
      <p className="eyebrow">
        {index} / {focus ? shortName(focus) : "Lattice"}
        <span className="eyebrow__rule" />
      </p>
      <h1 className="display">
        <Decode text={title.toUpperCase()} />
      </h1>
      <p className="tracked muted sub">
        <Decode text={sub} delay={200} tick={16} />
      </p>
      <div className="lines">
        {lines.map((l) => (
          <p key={l} className="tracked faint">
            {l}
          </p>
        ))}
      </div>
      <span className="short-rule" />
    </section>
  );
}

function Roster({ open }: { open: boolean }) {
  const all = useWorld((s) => s.lattice.agents);
  const focus = useWorld((s) => s.focus);
  const profiles = useCast((s) => s.cast.profiles);
  const openStudio = useCast((s) => s.openStudio);
  const agents = useMemo(
    () =>
      Object.values(all)
        .map((a) => ({
          id: a.agent.id,
          name: profiles[a.agent.id]?.name ?? a.agent.name,
          lineage: profiles[a.agent.id]?.lineage ?? a.agent.lineage,
          accent: profiles[a.agent.id]?.look.accent ?? LINEAGES[a.agent.lineage].accent,
          room: a.place.room,
          activity: a.motion && clock.sim < a.motion.startTs + a.motion.duration ? "walking" : a.activity,
        }))
        .sort((a, b) => Number(b.room === focus) - Number(a.room === focus)),
    [all, focus, profiles],
  );
  const selected = useWorld((s) => s.selectedAgent);
  const selectAgent = useWorld((s) => s.selectAgent);
  const hoverAgent = useWorld((s) => s.hoverAgent);
  return (
    <section className={`rail roster ${open ? "rail--open" : ""}`} aria-label="Agents">
      <p className="eyebrow">Roster</p>
      <ul>
        {agents.map((a) => (
          <li key={a.id} className={focus && a.room !== focus ? "dim" : ""}>
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
                {LINEAGES[a.lineage].name} · {shortName(a.room)}
              </span>
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

function Signals({ open }: { open: boolean }) {
  const lattice = useWorld((s) => s.lattice);
  const profiles = useCast((s) => s.cast.profiles);
  const lines = useMemo(() => feedLines(lattice, 22, (id) => profiles[id]?.name), [lattice, profiles]);
  const selectAgent = useWorld((s) => s.selectAgent);
  return (
    <section id="feed-panel" className={`rail signals ${open ? "rail--open" : ""}`} aria-label="Signals">
      <p className="eyebrow">Signals</p>
      <ol>
        {lines.map((l) => (
          <li key={l.id} className={`sig sig--${l.kind}`}>
            <time>{formatClock(l.ts).slice(3)}</time>
            <span>
              {l.who && (
                <button className="link" onClick={() => l.agentId && selectAgent(l.agentId)}>
                  {l.who}
                </button>
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
        <button className="smoky" onClick={() => resolve(r.id, "denied")}>
          Deny
        </button>
        <button className="smoky smoky--bright" onClick={() => resolve(r.id, "approved")}>
          Approve
        </button>
      </footer>
    </article>
  );
}

function Approvals() {
  const pending = useWorld(useShallow((s) => pendingApprovals(s.lattice)));
  const shown = pending.slice(0, 3);
  if (!pending.length) return null;
  return (
    <section className="approvals" aria-label="Waiting for your approval">
      {shown.map((rec) => (
        <ApprovalCard key={rec.request.id} rec={rec} />
      ))}
      {pending.length > shown.length && <div className="approvals__more tracked">+{pending.length - shown.length} more</div>}
    </section>
  );
}

const SPEEDS = [0.5, 1, 2, 4];
const LEVELS: GlitchLevel[] = ["off", "normal", "unhinged"];
const LEVEL_LABEL: Record<GlitchLevel, string> = { off: "Serious", normal: "Normal", unhinged: "Unhinged" };

/** The footer strip: like the Tide's "Observe / Discover / Preserve", but every word is a switch. */
function Footer() {
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
  return (
    <footer className="footer">
      <p className="footer__left tracked faint">
        A living lattice of agents <span className="footer__rule" /> <span className="muted">The Syntherion</span>
      </p>
      <div className="footer__right controls" role="group" aria-label="Controls">
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
    </footer>
  );
}

/** Bottom-left: the Tide's "scroll inward" hint, as keyboard help. */
function Inward() {
  const focus = useWorld((s) => s.focus);
  return (
    <div className="inward" aria-hidden="true">
      <span className="inward__line" />
      <span className="inward__ring" />
      <span className="tracked faint">{focus ? "Esc · outward" : "1–7 · inward"}</span>
    </div>
  );
}

/** Bottom-right: the room's name in the Tide's script, with its bearing in the Lattice, in a bracketed box. */
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

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      const s = useWorld.getState();
      if (e.key === "Escape") {
        if (useCast.getState().studio) return useCast.getState().openStudio(null);
        if (s.selectedAgent) s.selectAgent(null);
        s.setFocus(null);
      } else if (e.key === "ArrowRight") s.cycleFocus(1);
      else if (e.key === "ArrowLeft") s.cycleFocus(-1);
      else if (/^[1-7]$/.test(e.key)) s.setFocus(ROOM_IDS[Number(e.key) - 1]!);
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
  return (
    <div className={`hud ${studio ? "hud--studio" : ""}`}>
      <TopBar />
      <TitleBlock />
      <Roster open={panel === "roster"} />
      <Signals open={panel === "signals"} />
      <Approvals />
      <Inward />
      <Coordinates />
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
