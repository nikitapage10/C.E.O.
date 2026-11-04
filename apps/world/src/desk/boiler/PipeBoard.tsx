import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/overpass-mono";
import { navigateTo } from "../../route.ts";
import { refreshWorldClock } from "../../worldClock.ts";
import { useEmail } from "../email/email.ts";
import { groceryAction, isKrogerSignIn } from "../haven/groceries.ts";
import { googleAction } from "../homeDevices.ts";
import { reducedMotion } from "../wvCanvas.ts";
import { pipeHeadline, sinceWords, type Fix } from "./pipes.ts";
import { layout, roomCounts, roomFaults, roomState, STATE_SAY, type RoomPipe, type RoomSection } from "./rooms.ts";
import type { MapTarget, PipeScene } from "./pipeScene.ts";
import "./pipes.css";

/**
 * The Boiler Room's Map (#732, room by room since #743): every room its own manifold off the boiler (boiler/rooms.ts,
 * drawn by boiler/pipeScene.ts, loaded lazily), a strip of the rooms over it (picking one focuses its section), a card
 * on hover (a tap on a phone) for any pipe, valve or gauge (what it is, its state and why, when it last worked, what it
 * reads and how it signs in, any cap, what it needs from Nikita, and its Fix), and the fault panel beside it: one broken
 * thing at a time, its cause, a single Fix wired to the action the Desk already has, the steps when there's no button,
 * and the queue of the rest. Every word here is a state or a count; fixes that need a passkey ask for a sign-in.
 */

const LINE = "The Pessimist keeps the boiler. He expected this.";

const NEEDS_SIGN_IN = (f: Fix) => f.kind === "gmail" || f.kind === "google" || f.kind === "kroger" || (f.kind === "nav" && f.signedIn === true);

/** Go to a Desk page, then bring an anchor on it into view once it has drawn. */
function goTo(path: string) {
  const [p, hash] = path.split("#");
  navigateTo(p! + window.location.search);
  if (!hash) return;
  let tries = 0;
  const look = () => {
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ block: "start" });
    else if (tries++ < 30) window.setTimeout(look, 100);
  };
  window.setTimeout(look, 60);
}

/** Run one fix. Returns what to say, or null when the page is leaving for a sign-in. */
async function runFix(fix: Fix): Promise<string | null> {
  switch (fix.kind) {
    case "url":
      window.open(fix.url, "_blank", "noopener,noreferrer");
      return "Opened on GitHub.";
    case "nav":
      goTo(fix.path);
      return null;
    case "gmail":
      await useEmail.getState().connect();
      return useEmail.getState().error ?? "Asked Google. The gauge moves when Gmail answers.";
    case "google": {
      const r = await googleAction({ action: "connect", grant: fix.grant });
      if (r.ok && r.url) {
        window.location.assign(r.url);
        return null;
      }
      return "Google didn't start the sign-in. Try again from Controls.";
    }
    case "kroger": {
      const r = await groceryAction({ action: "connect" });
      if (r.ok && r.url && isKrogerSignIn(r.url)) {
        window.location.assign(r.url);
        return null;
      }
      return "King Soopers didn't start the sign-in. Try again from Controls.";
    }
    case "clock":
      await refreshWorldClock();
      return "Read the clock again.";
  }
}

const KIND_WORD: Record<RoomPipe["kind"], string> = { link: "connection", part: "part", job: "scheduled job", planned: "planned" };

function FixButton({ fix, kind, signedIn, busy, onFix }: { fix: Fix; kind: string; signedIn: boolean; busy: boolean; onFix: () => void }) {
  if (!signedIn && NEEDS_SIGN_IN(fix)) return <p className="bp-note">Sign in on the Desk to fix this one.</p>;
  return (
    <button className={`bp-fix is-${kind}`} type="button" disabled={busy} onClick={onFix}>
      {busy ? "Working…" : fix.label}
    </button>
  );
}

/** The hover card: everything about one pipe. */
/** A long fact, three lines until tapped. */
function Clamp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  return (
    <dd className={long && !open ? "is-clamp" : undefined}>
      {text}
      {long ? (
        <button type="button" className="bp-clamp" onClick={() => setOpen((o) => !o)}>
          {open ? "less" : "more"}
        </button>
      ) : null}
    </dd>
  );
}

interface CardProps {
  p: RoomPipe;
  room: RoomSection;
  now: number;
  signedIn: boolean;
  busy: boolean;
  onFix: (f: Fix) => void;
  onClose: () => void;
  onRoom: () => void;
  style: CSSProperties;
  pinned: boolean;
}

const PipeCard = forwardRef<HTMLDivElement, CardProps>(function PipeCard({ p, room, now, signedIn, busy, onFix, onClose, onRoom, style, pinned }, ref) {
  const last = p.lastOk ? sinceWords(p.lastOk, now) : "";
  return (
    <div ref={ref} className={`bp-card is-${p.state}`} style={style} role="dialog" aria-label={`${p.name}, ${STATE_SAY[p.state]}`} data-pipe={p.id}>
      <p className="bp-card-k">
        <b style={{ color: room.c }}>{room.name}</b> · {KIND_WORD[p.kind]}
        {pinned ? (
          <button type="button" className="bp-card-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        ) : null}
      </p>
      <h3>{p.name}</h3>
      <p className="bp-card-what">{p.what}</p>
      <p className={`bp-card-st is-${p.state}`}>
        <i aria-hidden="true" />
        <b>{STATE_SAY[p.state]}</b>
        {p.since ? <span>{p.since}</span> : null}
      </p>
      <p className="bp-card-why">{p.why}</p>
      {p.body ? <p className="bp-card-body">{p.body}</p> : null}
      <dl>
        <div>
          <dt>Last worked</dt>
          <dd>{last || (p.state === "ok" ? "no time reported" : "–")}</dd>
        </div>
        {p.facts ? (
          <>
            <div>
              <dt>What it does</dt>
              <Clamp text={p.facts.how} />
            </div>
            <div>
              <dt>Signs in</dt>
              <Clamp text={p.facts.auth} />
            </div>
            <div>
              <dt>How often</dt>
              <dd>{p.facts.when}</dd>
            </div>
          </>
        ) : null}
        {p.cap ? (
          <div>
            <dt>Cap</dt>
            <dd>{p.cap}</dd>
          </div>
        ) : null}
        <div>
          <dt>Needs you</dt>
          <dd className={p.needs ? "is-need" : undefined}>{p.needs ?? "Nothing."}</dd>
        </div>
      </dl>
      {p.fix ? <FixButton fix={p.fix} kind={p.state} signedIn={signedIn} busy={busy} onFix={() => onFix(p.fix!)} /> : null}
      {room.flow || room.pipes.length ? (
        <button type="button" className="bp-more" onClick={onRoom}>
          {room.name}'s whole line →
        </button>
      ) : null}
    </div>
  );
});

export function PipeBoard({ sections, now, signedIn, tabs, onOpenRoom }: { sections: RoomSection[]; now: number; signedIn: boolean; tabs: ReactNode; onOpenRoom: (room: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<PipeScene | null>(null);
  const [gl, setGl] = useState<"wait" | "on" | "none">("wait");
  const [cur, setCur] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const hoverTimer = useRef(0);
  const overCard = useRef(false);

  const faults = useMemo(() => roomFaults(sections), [sections]);
  const counts = useMemo(() => roomCounts(sections), [sections]);
  const fault = faults.find((f) => f.id === cur) ?? faults[0] ?? null;
  const head = pipeHeadline(faults);
  const bad = faults.filter((f) => f.kind !== "late");
  const pipes = useMemo(() => new Map(sections.flatMap((s) => s.pipes.map((p) => [p.id, p] as const))), [sections]);
  const cardId = pin ?? hover;
  const cardPipe = cardId ? (pipes.get(cardId) ?? null) : null;
  const cardRoom = cardPipe ? (sections.find((s) => s.id === cardPipe.room) ?? null) : null;

  const say = (t: string) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };
  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  // The scene's events, through refs so the scene is made once.
  const onPick = useRef<(t: MapTarget | null) => void>(() => undefined);
  onPick.current = (t) => {
    if (!t) return setPin(null);
    if ("room" in t) {
      setPin(null);
      return setFocus((f) => (f === t.room ? null : t.room));
    }
    setPin(t.pipe);
    if (faults.some((f) => f.id === t.pipe)) setCur(t.pipe);
  };
  const onHover = useRef<(t: MapTarget | null) => void>(() => undefined);
  onHover.current = (t) => {
    window.clearTimeout(hoverTimer.current);
    if (t && "pipe" in t) return setHover(t.pipe);
    hoverTimer.current = window.setTimeout(() => !overCard.current && setHover(null), 260);
  };

  useEffect(() => {
    let gone = false;
    void import("./pipeScene.ts")
      .then(({ PipeScene, canDraw3D }) => {
        if (gone || !host.current) return;
        if (!canDraw3D()) return setGl("none");
        try {
          const s = new PipeScene(host.current, { reduce: reducedMotion(), onPick: (t) => onPick.current(t), onHover: (t) => onHover.current(t) });
          s.onTrack = (x, y) => setAt({ x, y });
          scene.current = s;
          setGl("on");
        } catch {
          setGl("none");
        }
      })
      .catch(() => setGl("none"));
    return () => {
      gone = true;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  // The manifolds, re-laid only when the set of pipes changes; the states whenever they do.
  const shape = JSON.stringify(sections.map((s) => [s.id, s.pipes.map((p) => p.id + p.kind)]));
  useEffect(() => {
    if (gl !== "on" || !scene.current) return;
    scene.current.build(
      sections.map((s) => ({ id: s.id, name: s.name, c: s.c, pipes: s.pipes.map((p) => ({ id: p.id, name: p.name, kind: p.kind })) })),
      layout(sections),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, shape]);
  const states = JSON.stringify(sections.flatMap((s) => s.pipes.map((p) => p.state)));
  useEffect(() => {
    if (gl !== "on" || !scene.current) return;
    scene.current.set(Object.fromEntries(sections.flatMap((s) => s.pipes.map((p) => [p.id, p.state]))), focus, cardId ?? fault?.pipe ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, shape, states, focus, cardId, fault?.pipe]);
  useEffect(() => {
    if (!scene.current) return;
    scene.current.track = cardId;
    scene.current.wake();
    if (!cardId) setAt(null);
  }, [cardId, gl]);
  useEffect(() => {
    if (!pin && !focus) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pin) setPin(null);
      else setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin, focus]);

  const fix = async (f: Fix) => {
    setBusy(true);
    try {
      const said = await runFix(f);
      if (said) say(said);
    } finally {
      setBusy(false);
    }
  };

  const pickFault = (id: string) => {
    setCur(id);
    const f = faults.find((x) => x.id === id);
    if (f) setFocus(f.room);
  };

  // The card sits over its station on a desk (under it when there's no room above), kept inside the map; on a phone
  // it rises from the foot of the map.
  const card = useRef<HTMLDivElement>(null);
  const w = host.current?.clientWidth ?? 0;
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = card.current;
    const hb = host.current;
    if (!el || !hb || !at || hb.clientWidth < 600) return setCardPos(null);
    const cw = el.offsetWidth;
    const ch = el.offsetHeight;
    const mh = hb.clientHeight;
    const left = Math.max(cw / 2 + 8, Math.min(hb.clientWidth - cw / 2 - 8, at.x));
    const above = at.y - ch - 12;
    const top = above >= 8 ? above : Math.max(8, Math.min(at.y + 70, mh - ch - 8));
    setCardPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [at, cardId, cardPipe?.state]);
  const cardStyle: CSSProperties = cardPos ? { left: cardPos.left, top: cardPos.top } : w >= 600 ? { visibility: "hidden" } : {};

  const queue = (
    <div className="bp-queue">
      <small>{faults.length ? "Queue" : "All rooms"}</small>
      {faults.length ? (
        faults.map((g) => (
          <button key={g.id} type="button" aria-current={g === fault} onClick={() => pickFault(g.id)}>
            <i className={`is-${g.kind}`} aria-hidden="true" />
            <span>
              {g.title.replace(/\.$/, "")} <em>{g.line}</em>
            </span>
          </button>
        ))
      ) : (
        <p className="bp-count">
          {counts.ok} holding{counts.dry ? ` · ${counts.dry} not connected yet` : ""}
        </p>
      )}
      <p className="bp-flav">{LINE}</p>
    </div>
  );

  const n = fault && fault.kind !== "late" ? bad.indexOf(fault) + 1 : 0;

  return (
    <section className="bp" aria-label="The pipes">
      <div className="bp-top">
        <h1 className="bp-h desk__title">
          Boiler Room · <span className={head.ok ? "is-ok" : undefined}>{head.text}</span>
        </h1>
        <p className="bp-sub">
          {sections.length} rooms · {counts.ok} of {counts.total} pipes holding pressure{counts.dry ? ` · ${counts.dry} not connected yet` : ""}
        </p>
        {tabs}
      </div>
      <nav className="bp-rooms" aria-label="Rooms on the map">
        <button type="button" aria-pressed={focus === null} onClick={() => setFocus(null)}>
          All rooms
        </button>
        {sections.map((s) => {
          const st = roomState(s);
          const holding = s.pipes.filter((p) => p.state === "ok").length;
          return (
            <button key={s.id} type="button" aria-pressed={focus === s.id} onClick={() => setFocus(s.id)} style={{ "--rc": s.c } as CSSProperties}>
              <i className={`is-${st}`} aria-hidden="true" />
              {s.name}
              <small>
                {holding}/{s.pipes.length}
              </small>
            </button>
          );
        })}
      </nav>
      <div className={`bp-map is-${gl}${focus ? " is-focus" : ""}`} ref={host}>
        {gl === "none" ? <p className="bp-nogl">The 3D map needs WebGL. Every fault is still in the panel.</p> : null}
        <div className={`bp-toast${toast ? " is-on" : ""}`} role="status">
          {toast}
        </div>
        {cardPipe && cardRoom && (at || w < 600) ? (
          <div
            className="bp-card-wrap"
            onMouseEnter={() => {
              overCard.current = true;
              window.clearTimeout(hoverTimer.current);
            }}
            onMouseLeave={() => {
              overCard.current = false;
              if (!pin) hoverTimer.current = window.setTimeout(() => setHover(null), 200);
            }}
          >
            <PipeCard ref={card} p={cardPipe} room={cardRoom} now={now} signedIn={signedIn} busy={busy} onFix={(f) => void fix(f)} onClose={() => setPin(null)} onRoom={() => onOpenRoom(cardRoom.id)} style={cardStyle} pinned={pin === cardPipe.id || w < 600} />
          </div>
        ) : null}
        <ul className="bp-key" aria-hidden="true">
          <li>
            <i className="is-ok" />
            flowing
          </li>
          <li>
            <i className="is-late" />
            late
          </li>
          <li>
            <i className="is-leak" />
            broken or shut
          </li>
          <li>
            <i className="is-planned" />
            not connected · planned
          </li>
        </ul>
      </div>
      <aside className="bp-panel" aria-live="polite">
        {fault ? (
          <>
            <p className={`bp-k is-${fault.kind}`}>
              <b>
                {fault.kind === "late" ? "Running late" : `Fault ${n} of ${bad.length}`} · {fault.line}
              </b>
              <span>{fault.since}</span>
            </p>
            <h2 className="bp-title">{fault.title}</h2>
            {fault.body ? <p>{fault.body}</p> : null}
            <div className="bp-route" aria-label={fault.route.join(", ")}>
              {fault.route[0]} <i aria-hidden="true" /> {fault.route[1]} <i className="is-bad" aria-hidden="true" /> <em>{fault.route[2]} ✕</em>
            </div>
            {fault.fix ? <FixButton fix={fault.fix} kind={fault.kind} signedIn={signedIn} busy={busy} onFix={() => void fix(fault.fix!)} /> : null}
            {fault.steps.length ? (
              <ol>
                {fault.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            ) : null}
            <button className="bp-more" type="button" onClick={() => setPin(fault.pipe)}>
              Everything about this pipe →
            </button>
            {queue}
          </>
        ) : (
          <>
            <p className="bp-k is-ok">
              <b>All rooms</b>
              <span>just now</span>
            </p>
            <h2 className="bp-title">Everything is holding.</h2>
            <p>Every connected pipe has pressure and nothing is leaking. Nothing here needs you.</p>
            {queue}
          </>
        )}
      </aside>
    </section>
  );
}
