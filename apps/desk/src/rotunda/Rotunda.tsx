import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { useFoundry } from "../../../world/src/foundry.ts";
import { useWorldFeed } from "../../../world/src/chronicle.ts";
import { useTalks } from "../confluence/Talks.tsx";
import { COUNCIL_RC as RC } from "../council/deskPulses.ts";
import { councilLines, memberLive, SKIPPY_MODEL, type CouncilPulse } from "../council/live.ts";
import { MemberCard } from "../council/MemberCard.tsx";
import { modelReady } from "../modelCache.ts";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import type { ChamberLink } from "../../../../rooms/today/web/TodayNow.tsx";
import type { Rotunda as Scene, RotundaSeat } from "./rotundaScene.ts";
import { createVoice, setSound, useRotundaSound, type RotundaVoice } from "./voice.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import "./rotunda.css";

/**
 * The Senate (#740, the round 3 concept Nikita picked on 2026-11-04): Today's Council as a round chamber.
 * Skippy chairs it from the podium; the subminds sit round the bowl on bronze pods, each floating on a short field of
 * sigils and motes in its room's colour. A pod is lit from real state: dim when its submind isn't active, glowing when
 * it is, brightest while its room is at work (live.ts). The docket's items play on the floor one by one (rite.ts), and
 * between items a lit member flies in and says what it's doing, from the same real feed (councilLines).
 *
 * The 3D (rotundaScene.ts) loads with three.js in its own chunk once the page has painted. Until then, and on a device
 * without WebGL, the chamber is drawn flat in CSS with every pod in place, so the page is whole at once. Every pod is a
 * button either way: point at it for its name and state, click for its card (MemberCard.tsx).
 */

type GL = "idle" | "loading" | "on" | "off";
const PHONE_Q = "(max-width: 760px)";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_Q).matches;
const hex = (rgb: string) => `#${rgb.split(",").map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
/** The pods' order round the bowl, left to right (the concept's). */
const ORDER = ["foundry", "relay", "exchange", "green", "spire", "archive", "boiler", "breakroom", "workshop", "studio", "annex", "haven"];
const STATE_WORD = { busy: "at work", steady: "steady", waiting: "waiting", down: "needs a look", sim: "not set up" } as const;

/** Where a pod sits in the flat chamber, in percent of the stage: the same arc as the 3D bowl, seen from the rim. */
function flatSeat(i: number, n: number) {
  const u = i / Math.max(1, n - 1);
  const a = Math.PI / 2 + Math.PI * 0.27 + u * Math.PI * 1.46;
  // Spread evenly across, so no two pods' buttons overlap; the arc gives the depth.
  return { x: 7 + u * 86, y: 50 + Math.sin(a) * 15 - (i % 2 ? 6 : 0) };
}

export interface RotundaProps {
  link: ChamberLink;
  pulses: CouncilPulse[];
  now: number;
  since: number;
  held: Record<string, number>;
  skippySays: string;
  /** Lets the docket light a room's pod while one of its cards is pointed at. */
  hotRef: MutableRefObject<(room: string | null) => void>;
}

export function Rotunda({ link, pulses, now, since, held, skippySays, hotRef }: RotundaProps) {
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene | null>(null);
  const seatEls = useRef(new Map<string, HTMLElement>());
  const [gl, setGl] = useState<GL>("idle");
  // Today's room loader (#752, #759) holds until the chamber's first real frame (or its flat fallback, without WebGL).
  useRoomReady(gl === "on" || gl === "off");
  const [hot, setHot] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [phone, setPhone] = useState(isPhone);
  useTalks();
  const changelog = useFoundry((s) => s.data.changelog);
  const world = useWorldFeed().feed;

  const ordered = useMemo(() => [...pulses].sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99)), [pulses]);
  const seats: RotundaSeat[] = useMemo(
    () => ordered.map((p) => ({ id: p.id, title: p.submind.title, room: p.name, colour: hex(RC[p.id] ?? "200,200,220"), alive: p.submind.active && p.state !== "sim", working: memberLive(p, now) > 0 })),
    [ordered, now],
  );
  const seatSig = JSON.stringify(seats);
  const ambient = useMemo(
    () =>
      Object.values(councilLines({ pulses, changes: changelog, ilyr: world?.recent ?? [], now }))
        .filter((l) => l.length)
        .map((l) => ({ by: l[0]!.room, text: l[0]!.text })),
    [pulses, changelog, world, now],
  );
  const ambientSig = JSON.stringify(ambient);

  // The latest of everything the scene calls back into, read through a ref so the scene is built once.
  const live = useRef({ link, seats, ambient });
  live.current = { link, seats, ambient };

  useEffect(() => {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(PHONE_Q) : null;
    const on = () => setPhone(!!mq?.matches);
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);

  // Without the 3D, a card brought to the floor is still marked as the one on the floor.
  useEffect(() => {
    if (gl !== "on") link.bring.current = (key) => live.current.link.onFloor(key);
  }, [gl, link.bring]);

  // The 3D: loaded once the page has painted (at once if the model is already here this visit).
  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el) return;
    let dead = false;
    const placed = new Map<string, { x: number; y: number }>();
    // The voices (#755): quiet until the sound button is on; the scene paces itself by them.
    const voice: RotundaVoice | undefined = typeof Audio === "function" ? createVoice() : undefined;
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./rotundaScene.ts")
        .then((m) =>
          m.createRotunda(el, cv, {
            phone: isPhone(),
            reduce: reducedMotion(),
            seats: live.current.seats,
            voice,
            onFloor: (key) => live.current.link.onFloor(key),
            onDone: (key) => live.current.link.onDone(key),
            onPlace: (id, x, y, visible) => {
              const s = seatEls.current.get(id);
              if (!s) return;
              // Moved only once it has drifted a few pixels: the button stays still enough to point at while the pod bobs.
              const was = placed.get(id);
              if (!was || Math.abs(was.x - x) > 3 || Math.abs(was.y - y) > 3) {
                placed.set(id, { x, y });
                s.style.setProperty("--gx", `${Math.round(x)}px`);
                s.style.setProperty("--gy", `${Math.round(y)}px`);
              }
              s.classList.toggle("is-away", !visible);
            },
            safeBottom: () => {
              if (isPhone()) return 0;
              const dock = el.closest(".rt-hall")?.querySelector<HTMLElement>(".rt-dock");
              return dock ? dock.offsetHeight + 16 : 190;
            },
          }),
        )
        .then((c) => {
          if (dead) return c.dispose();
          scene.current = c;
          c.setDocket(live.current.link.docket);
          c.setAmbient(live.current.ambient);
          live.current.link.bring.current = c.bring;
          setGl("on");
        })
        .catch(() => !dead && setGl("off"));
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const viaIdle = !modelReady(SKIPPY_MODEL) && typeof w.requestIdleCallback === "function";
    const idle = !viaIdle ? window.setTimeout(start, modelReady(SKIPPY_MODEL) ? 0 : 400) : w.requestIdleCallback!(start, { timeout: 1500 });
    return () => {
      dead = true;
      if (viaIdle) w.cancelIdleCallback?.(idle);
      else window.clearTimeout(idle);
      scene.current?.dispose();
      scene.current = null;
      voice?.dispose();
    };
  }, []);

  // Real state into the scene as it changes.
  useEffect(() => {
    scene.current?.setSeats(live.current.seats);
  }, [seatSig, gl]);
  useEffect(() => {
    scene.current?.setDocket(link.docket);
  }, [link.docket, gl]);
  useEffect(() => {
    scene.current?.setAmbient(live.current.ambient);
  }, [ambientSig, gl]);
  const lit = hot ?? sel;
  useEffect(() => {
    scene.current?.setHot(lit === "kernel" ? null : lit);
  }, [lit, gl]);
  hotRef.current = setHot;

  useEffect(() => {
    if (!sel) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    const away = (e: PointerEvent) => !(e.target as Element | null)?.closest?.(".ti-card, .rt-pod, .rt-pres") && setSel(null);
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", away);
    };
  }, [sel]);

  const active = pulses.filter((p) => p.submind.active).length;
  const seatRef = (id: string) => (el: HTMLElement | null) => {
    if (el) seatEls.current.set(id, el);
    else seatEls.current.delete(id);
  };
  const point = (id: string | null) => setHot(id);

  return (
    <div ref={stage} className="rt-stage" data-gl={gl} role="group" aria-label={`The Senate, the Council of Skippies in session: ${active} of ${pulses.length} subminds active`}>
      <div className="rt-flat" aria-hidden="true">
        <i className="rt-flat-shaft" />
        <i className="rt-flat-podium" />
      </div>
      <canvas ref={canvas} className="rt-gl" aria-hidden="true" />
      <div className="rt-vig" aria-hidden="true" />
      <div ref={host} className="rt-host" />
      <button
        ref={seatRef("kernel")}
        type="button"
        className={`rt-pres${lit === "kernel" ? " is-lit" : ""}`}
        style={{ "--fx": "50%", "--fy": "48%" } as CSSProperties}
        aria-expanded={sel === "kernel"}
        aria-label="Skippy, the Magnificent: open what he says"
        onClick={() => setSel(sel === "kernel" ? null : "kernel")}
        onPointerEnter={() => point("kernel")}
        onPointerLeave={() => point(null)}
        onFocus={() => point("kernel")}
        onBlur={() => point(null)}
      >
        <b>Skippy, the Magnificent</b>
        <span>presiding</span>
      </button>
      {ordered.map((p, i) => {
        const s = seats[i]!;
        const f = flatSeat(i, ordered.length);
        return (
          <button
            key={p.id}
            ref={seatRef(p.id)}
            type="button"
            className={`rt-pod${s.alive ? "" : " is-still"}${s.working ? " is-working" : ""}${lit === p.id ? " is-lit" : ""}${held[p.id] ? " is-held" : ""}`}
            data-room={p.id}
            style={{ "--fx": `${f.x}%`, "--fy": `${f.y}%`, "--c": RC[p.id] ?? "200,200,220" } as CSSProperties}
            aria-expanded={sel === p.id}
            aria-label={`${p.submind.title}, ${p.name}: ${p.state === "sim" ? "not set up" : p.status}${held[p.id] ? `, ${held[p.id]} held for you` : ""}`}
            onClick={() => setSel(sel === p.id ? null : p.id)}
            onPointerEnter={() => point(p.id)}
            onPointerLeave={() => point(null)}
            onFocus={() => point(p.id)}
            onBlur={() => point(null)}
          >
            <i className="rt-pod-body" aria-hidden="true" />
            {lit === p.id && !sel && (
              <span className="rt-tip" aria-hidden="true">
                <b>{p.submind.title}</b>
                <span>
                  {p.name} · {p.state === "sim" ? "not set up yet" : s.working ? STATE_WORD.busy : STATE_WORD[p.state]}
                </span>
              </span>
            )}
          </button>
        );
      })}
      <SoundButton />
      {sel && <MemberCard id={sel} pulses={pulses} now={now} since={since} held={held} skippySays={skippySays} active={active} phone={phone} onClose={() => setSel(null)} />}
    </div>
  );
}

/**
 * The chamber's sound (#755): off by default, remembered on this device. On, the chair and the subminds speak their
 * lines (voice.ts) and a small level moves while one does.
 */
function SoundButton() {
  const on = useRotundaSound((s) => s.on);
  const speaking = useRotundaSound((s) => s.speaking);
  // On, but the phone held the voices back until a tap: the button asks for that tap instead of turning the sound off.
  const blocked = useRotundaSound((s) => s.on && s.blocked);
  return (
    <button
      type="button"
      className={`rt-sound${on ? " is-on" : ""}${on && speaking ? " is-speaking" : ""}${blocked ? " is-blocked" : ""}`}
      aria-pressed={on}
      title={blocked ? "Tap to hear the chamber" : on ? "Turn the chamber's voices off" : "Hear the chamber: Skippy and the subminds speak their lines"}
      onClick={() => setSound(blocked ? true : !on)}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path className="rt-sound-c" d="M3 7.5h3l4-3.5v12l-4-3.5H3z" />
        {on ? <path className="rt-sound-w" d="M13 7a4 4 0 0 1 0 6M15.2 5a7 7 0 0 1 0 10" /> : <path className="rt-sound-w" d="M13.5 8l4 4M17.5 8l-4 4" />}
      </svg>
      <span className="rt-sound-t">{blocked ? "Tap to hear" : on ? "Sound on" : "Sound off"}</span>
      {on && (
        <span className="rt-sound-lv" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </button>
  );
}
