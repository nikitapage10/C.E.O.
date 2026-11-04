import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { eyeSpec, type EyeState } from "./nanites.ts";
import { irisLayout, type IrisLayout } from "./layout.ts";
import { MANNERS, SKIPPY_MANNER } from "./manner.ts";
import type { Council, CouncilMember } from "./councilScene.ts";
import { CREW, useFoundry } from "../../foundry.ts";
import { ideaTitle } from "../IdeaCard.tsx";
import { roomLink } from "../hero/roomLink.ts";
import type { PulseState, RoomPulse } from "../roomPulse.ts";
import { useSkippy } from "../skippy/chat.ts";
import { mtTime } from "../todaySchedule.ts";
import { RC, reducedMotion, useViz } from "../wvCanvas.ts";
import { Talks, useTalks } from "../confluence/Talks.tsx";
import "./iris.css";

/**
 * The Council of Skippies as the Iris (#666; Nikita 2026-11-04: "the Council of Skippies, like their actual models...
 * surrounding the central Skippy... not ominous, but not holy exactly"), the right side of Today. Skippy, the
 * Magnificent floats large in the middle, the pupil of a vast eye whose lids are two streams of nanites; the ten
 * subminds sit round him on a ring, the same admiral can each time, in their rooms' colours, each moving in its own
 * personality (manner.ts), dim and still when it isn't active yet. Point at one and a light falls on it from above
 * with its name and what it's doing; click and a small card says what its room is doing now, what's held for you
 * there, and your talks with it (signed in only for the words, Talks.tsx). The 3D (councilScene.ts) loads lazily with
 * three.js once the page has painted; until then, and on a device without WebGL, the nanites draw each room's sigil
 * on its seat. Reduced motion: every member holds its pose and the nanites hold still. Phones: the ring sits under the
 * list, drawn at a lower resolution and at most 30 frames a second.
 */

const STATE_WORD: Record<PulseState, string> = { busy: "busy", steady: "steady", waiting: "waiting", down: "needs a look", sim: "not set up" };
const MOMENT: Partial<Record<string, string>> = { archive: "An hour of Ilyr written", relay: "Email checked", boiler: "A link checked" };
const job = (title: string) => title.replace(/^The /, "");
const hex = (rgb: string) => `#${rgb.split(",").map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
const PHONE_Q = "(max-width: 760px)";
const isPhoneNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_Q).matches;

export interface IrisProps {
  pulses: RoomPulse[];
  now: number;
  since: number;
  /** How many things are held for Nikita in each room. */
  held: Record<string, number>;
  skippySays: string;
  /** Lets the list light a room's member while one of its rows is pointed at. */
  hotRef: React.MutableRefObject<(room: string | null) => void>;
}

type GL = "idle" | "loading" | "on" | "off";

export function Iris({ pulses, now, since, held, skippySays, hotRef }: IrisProps) {
  const eye = useRef<HTMLCanvasElement>(null);
  const gl = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const council = useRef<Council | null>(null);
  const [L, setL] = useState<IrisLayout | null>(null);
  const [glState, setGl] = useState<GL>("idle");
  const [hot, setHot] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useTalks();

  const ids = useMemo(() => pulses.map((p) => p.id), [pulses]);
  const members: CouncilMember[] = useMemo(
    () => [
      { id: "kernel", colour: null, manner: SKIPPY_MANNER, alive: true },
      ...pulses.map((p) => ({ id: p.id, colour: hex(RC[p.id] ?? "200,200,220"), manner: MANNERS[p.id], alive: p.submind.active && p.state !== "sim" })),
    ],
    [pulses],
  );

  // What the nanites read each frame: changed in place, never a render per frame.
  const S = useRef<EyeState>({ L: null, members: [], hot: null, marks: true, listEdge: 0, ox: 0, oy: 0 }).current;
  S.members = pulses.map((p) => ({ id: p.id, rgb: RC[p.id] ?? "200,200,220", alive: p.submind.active && p.state !== "sim", activity: p.activity }));
  S.hot = hot ?? sel;
  S.marks = glState !== "on";
  const spec = useMemo(() => eyeSpec(() => S), [S]);
  const V = useViz(eye, spec);

  // The layout follows the stage's size; the eye runs left under the list on a wide screen.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const cv = eye.current?.getBoundingClientRect();
      const list = el.closest(".ti")?.querySelector(".ti-list")?.getBoundingClientRect();
      const phone = isPhoneNow();
      const reach = !phone && cv ? Math.max(0, r.left - cv.left) : 0;
      const next = irisLayout(Math.round(r.width), Math.round(r.height), ids, phone, reach);
      S.L = next;
      S.ox = cv ? r.left - cv.left : 0;
      S.oy = cv ? r.top - cv.top : 0;
      S.listEdge = !phone && list && cv ? list.right - cv.left : -1;
      setL((was) => (was && was.w === next.w && was.h === next.h && was.phone === next.phone && was.seats.length === next.seats.length ? was : next));
      V.current?.relayout();
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ids, S, V]);

  // The 3D: loaded once the page has painted and the stage is in view; its own frame loop, paused out of view.
  const inView = useRef(true);
  const kickRef = useRef<() => void>(() => {});
  useEffect(() => {
    const canvas = gl.current;
    const el = stage.current;
    if (!canvas || !el) return;
    let dead = false;
    let raf = 0;
    let last = 0;
    const phone = isPhoneNow();
    const still = reducedMotion();
    const step = phone ? 1000 / 30 : 1000 / 60;
    const loop = (t: number) => {
      raf = 0;
      if (dead || !council.current) return;
      if (document.visibilityState === "hidden" || !inView.current) return;
      raf = requestAnimationFrame(loop);
      if (t - last < step - 2) return;
      const dt = last ? Math.min(0.06, (t - last) / 1000) : 0;
      last = t;
      council.current.frame(dt);
    };
    const kick = () => {
      if (still || raf || dead || !council.current) return;
      last = 0;
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./councilScene.ts")
        .then((m) => m.createCouncil(canvas, { phone }))
        .then((c) => {
          if (dead) return c.dispose();
          council.current = c;
          setGl("on");
        })
        .catch(() => !dead && setGl("off"));
    };
    const io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((en) => {
            inView.current = en[en.length - 1]!.isIntersecting;
            if (inView.current) kick();
          })
        : null;
    io?.observe(el);
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const idle = typeof w.requestIdleCallback === "function" ? w.requestIdleCallback(start, { timeout: 1500 }) : window.setTimeout(start, 400);
    const vis = () => document.visibilityState === "visible" && kick();
    document.addEventListener("visibilitychange", vis);
    kickRef.current = kick;
    return () => {
      dead = true;
      if (typeof w.cancelIdleCallback === "function" && typeof w.requestIdleCallback === "function") w.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      cancelAnimationFrame(raf);
      io?.disconnect();
      document.removeEventListener("visibilitychange", vis);
      council.current?.dispose();
      council.current = null;
    };
  }, []);

  // Hand the scene its layout, its members and the light; with reduced motion, draw the one still frame again.
  useEffect(() => {
    const c = council.current;
    if (!c || glState !== "on" || !L) return;
    const phone = L.phone;
    const dpr = Math.min(window.devicePixelRatio || 1, phone ? 1.25 : 1.75) * (phone ? 0.8 : 1);
    c.layout(L, dpr);
    c.setMembers(members);
    c.setHot(hot ?? sel);
    if (reducedMotion()) c.frame(0);
    else kickRef.current();
  }, [glState, L, members, hot, sel]);

  const point = (id: string | null) => setHot(id);
  hotRef.current = point;

  useEffect(() => {
    if (!sel) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    const away = (e: PointerEvent) => !(e.target as Element | null)?.closest?.(".ti-card, .ti-seat") && setSel(null);
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", away);
    };
  }, [sel]);

  const active = pulses.filter((p) => p.submind.active).length;
  const lit = hot ?? sel;
  const litSeat = L && lit ? (lit === "kernel" ? { x: L.cx, y: L.cy, size: L.skippy } : (() => {
    const s = L.seats.find((x) => x.id === lit);
    return s ? { x: s.x, y: s.y, size: L.member } : null;
  })()) : null;
  const litPulse = lit && lit !== "kernel" ? pulses.find((p) => p.id === lit) : null;

  return (
    <div className="ti-council" data-gl={glState}>
      <canvas ref={eye} className="ti-eye" aria-hidden="true" />
      <div ref={stage} className="ti-stage" role="group" aria-label={`The Council of Skippies: ${active} of ${pulses.length} subminds active`}>
        <canvas ref={gl} className="ti-gl" aria-hidden="true" />
        {litSeat && (
          <span
            key={lit}
            className="ti-cone"
            aria-hidden="true"
            style={{ left: litSeat.x, height: litSeat.y + litSeat.size * 0.5, "--w": `${litSeat.size * 1.35}px`, "--c": lit === "kernel" ? "236,232,255" : RC[lit!] } as CSSProperties}
          />
        )}
        {L && (
          <>
            <button
              type="button"
              className={`ti-seat is-kernel${lit === "kernel" ? " is-lit" : ""}`}
              style={{ left: L.cx, top: L.cy, width: L.skippy * 0.62, height: L.skippy } as CSSProperties}
              aria-expanded={sel === "kernel"}
              aria-label="Skippy, the Magnificent: open what he says"
              onClick={() => setSel(sel === "kernel" ? null : "kernel")}
              onPointerEnter={() => point("kernel")}
              onPointerLeave={() => point(null)}
              onFocus={() => point("kernel")}
              onBlur={() => point(null)}
            >
              <span className="ti-name is-kernel">
                <b>Skippy</b>
                <i>the Magnificent</i>
              </span>
            </button>
            {pulses.map((p) => {
              const s = L.seats.find((x) => x.id === p.id);
              if (!s) return null;
              const alive = p.submind.active && p.state !== "sim";
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`ti-seat${alive ? "" : " is-still"}${lit === p.id ? " is-lit" : ""}${held[p.id] ? " is-held" : ""}`}
                  data-room={p.id}
                  style={{ left: s.x, top: s.y, width: L.member * 0.7, height: L.member, "--c": RC[p.id] } as CSSProperties}
                  aria-expanded={sel === p.id}
                  aria-label={`${p.submind.title}, ${p.name}: ${p.state === "sim" ? "not set up" : p.status}${held[p.id] ? `, ${held[p.id]} held for you` : ""}`}
                  onClick={() => setSel(sel === p.id ? null : p.id)}
                  onPointerEnter={() => point(p.id)}
                  onPointerLeave={() => point(null)}
                  onFocus={() => point(p.id)}
                  onBlur={() => point(null)}
                >
                  <span className="ti-name">{p.name}</span>
                </button>
              );
            })}
            {litPulse && litSeat && !sel && (
              <p className={`ti-tip${litSeat.x > L.w * 0.62 ? " is-left" : ""}`} style={{ left: litSeat.x, top: litSeat.y - litSeat.size * 0.62, "--c": RC[litPulse.id] } as CSSProperties} aria-hidden="true">
                <b>{litPulse.name}</b> · {litPulse.state === "sim" ? "not set up yet" : litPulse.status}
              </p>
            )}
          </>
        )}
        {sel && L && <Card id={sel} L={L} pulses={pulses} now={now} since={since} held={held} skippySays={skippySays} active={active} onClose={() => setSel(null)} />}
      </div>
    </div>
  );
}

function Card({ id, L, pulses, now, since, held, skippySays, active, onClose }: { id: string; L: IrisLayout; pulses: RoomPulse[]; now: number; since: number; held: Record<string, number>; skippySays: string; active: number; onClose: () => void }) {
  const setOpen = useSkippy((s) => s.setOpen);
  const changelog = useFoundry((s) => s.data.changelog);
  const box = useRef<HTMLElement>(null);
  useEffect(() => box.current?.focus({ preventScroll: true }), [id]);
  const p = pulses.find((x) => x.id === id) ?? null;
  const seat = L.seats.find((s) => s.id === id);
  // Beside its member on a wide screen, toward the middle; under the ring on a phone.
  const style: CSSProperties = L.phone
    ? {}
    : seat
      ? seat.x > L.cx
        ? { right: L.w - seat.x + L.member * 0.55, top: Math.max(8, Math.min(seat.y - 60, L.h - 330)) }
        : { left: seat.x + L.member * 0.55, top: Math.max(8, Math.min(seat.y - 60, L.h - 330)) }
      : { left: L.cx + L.skippy * 0.4, top: Math.max(8, L.cy - 150) };
  const close = (
    <button type="button" className="ti-card-x" onClick={onClose} aria-label="Close">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    </button>
  );

  if (!p) {
    return (
      <aside ref={box} tabIndex={-1} className="ti-card" style={{ ...style, "--c": "222,216,255" } as CSSProperties} aria-label="Skippy, the Magnificent">
        <header>
          <div>
            <h2>Skippy, the Magnificent</h2>
            <p>The Kernel · presiding</p>
          </div>
          {close}
        </header>
        <p className="ti-card-say">“{skippySays}”</p>
        <p className="ti-card-k">
          {active} of {pulses.length} subminds active, each with its own thread.
        </p>
        <div className="ti-card-acts">
          <button type="button" className="ti-btn" onClick={() => setOpen(true)}>
            Talk to Skippy
          </button>
        </div>
      </aside>
    );
  }

  const last =
    p.id === "foundry"
      ? (() => {
          const c = changelog.filter((x) => x.at >= since && x.at <= now).sort((a, b) => b.at - a.at)[0];
          return c ? { at: c.at, what: `Shipped${c.issue ? ` #${c.issue.number}` : ""} ${ideaTitle(c.title)}${c.by ? ` · ${CREW[c.by].name}` : ""}` } : null;
        })()
      : (() => {
          const t = p.events.filter((x) => x >= since && x <= now).sort((a, b) => b - a)[0];
          return t ? { at: t, what: MOMENT[p.id] ?? "A scene in Ilyr, set here" } : null;
        })();
  const n = held[p.id] ?? 0;

  return (
    <aside ref={box} tabIndex={-1} className="ti-card" data-room={p.id} style={{ ...style, "--c": RC[p.id] } as CSSProperties} aria-label={`${p.submind.title}, ${p.name}`}>
      <header>
        <div>
          <h2>{p.submind.title}</h2>
          <p>
            {p.name} · {STATE_WORD[p.state]}
            {p.submind.active ? " · active" : ""}
          </p>
        </div>
        {close}
      </header>
      <dl className="ti-card-l">
        <div>
          <dt>Now</dt>
          <dd>{p.state === "sim" ? "Not set up yet: no real work is connected here." : p.doing ?? p.status}</dd>
        </div>
        <div>
          <dt>Last</dt>
          <dd>{last ? <><time dateTime={new Date(last.at).toISOString()}>{mtTime(last.at)}</time> {last.what}</> : "Nothing yet today."}</dd>
        </div>
        <div>
          <dt>Open</dt>
          <dd>{n ? `${n} ${n === 1 ? "thing" : "things"} held for you here` : "Nothing held for you here"} · {p.drive}</dd>
        </div>
      </dl>
      <Talks room={p.id} who={p.submind.title} />
      <div className="ti-card-acts">
        <a className="ti-btn" href={p.href} onClick={roomLink(p.href)}>
          Open {p.name} ›
        </a>
        <span className="ti-card-job">{job(p.submind.title)}</span>
      </div>
    </aside>
  );
}
