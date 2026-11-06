import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CREW, modelOf, shippedToday, type Crate, type FoundryData } from "../../../apps/world/src/foundry.ts";
import { countdown, nextRuns } from "@ceo/desk/crewRuns.ts";
import { FOUNDRY_THREAD, formatWait } from "@ceo/desk/deskData.ts";
import { ideaTitle } from "@ceo/desk/IdeaCard.tsx";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { MILESTONES, progressWords, stepWords, type Progress } from "../data/progress.ts";
import { forgeLanes, LANES, queueOf, STAGE_WORDS, type Lane, type Stage } from "../data/forge.ts";
import { CHECKS, coilState, furnaceOf, heightOf, mainCoil, paintOf, SLOT_HANDS, TRAIL, trailStep, type CoilState } from "../data/furnace.ts";
import type { Furnace, FurnaceSlotView, FurnaceView } from "./furnaceScene.ts";

/**
 * The Foundry's stage as the Deep Furnace (#813, second pass #922): the forge shaft in 3D (furnaceScene.ts, lazy
 * loaded with three.js) filling the screen, with a light overlay over it, no side panels. The headline and what needs
 * Nikita sit top left, five numbers top right; each slot's job carries a small card that rides its ingot up the shaft
 * and says at a glance what is being built (the job's Short line), and a card (or the ingot, a hand, the cart, the
 * hatch) opens the full one: the job's Trail (Work, Pictures, Checks, Ship), its five checks, its progress and its
 * links. Pointing shows it, a tap or click pins it, and it stands beside the shaft, never over it. Until the 3D is up,
 * and on a device without WebGL, the tags stand in a flat shaft drawn in CSS, so the page is whole and usable at once.
 */

type GL = "idle" | "loading" | "on" | "off";
const PHONE_Q = "(max-width: 760px)";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_Q).matches;
const HOUR = 3_600_000;
const NUM = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const words = (n: number) => NUM[n] ?? String(n);
const pic = (id: string) => `/desk/agent-${id}.webp`;
const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const PILL: Record<Stage, "run" | "ok" | "hot" | "bad" | "off"> = { waiting: "off", paused: "off", building: "run", pr: "run", checks: "run", red: "bad", green: "ok", ready: "hot", stuck: "bad" };
const COIL_WORD: Record<CoilState, string> = { wait: "not yet", run: "running", pass: "passed", fail: "red" };
/** Where each tag stands in the flat shaft before the 3D is up (percent of the stage). */
/** The tags kept apart on screen (the zone labels sit off the shaft and never meet them). */
const TAGS = new Set(["s0", "s1", "s2", "s3", "rivet", "rocky", "queue", "ship"]);
/** The zone labels, laid out after the tags so they can step out from under them (#932). */
const ZONES = ["z-ship", "z-checks", "z-pictures", "z-work"];
const FLAT: Record<string, [number, number]> = { s0: [30, 78], s1: [43, 70], s2: [57, 70], s3: [70, 78], rivet: [86, 70], rocky: [14, 70], queue: [22, 84], ship: [50, 16], more: [22, 34] };
/** What a job is building, at a glance: its Short line, or its title. */
const shortOf = (c: Crate) => (c.short || ideaTitle(c.title)).replace(/\.$/, "");

export interface FurnaceProps {
  data: FoundryData;
  ideas: Crate[];
  progress?: Map<number, Progress>;
  now: number;
  connected: boolean;
  lead: string;
  /** Stop, for a build the Builder approved itself. */
  stop: (c: Crate) => ReactNode;
  onSuggest: () => void;
  onIdea: (n: number) => void;
  onShips: () => void;
}

/** One slot's view for the scene. */
function slotView(hand: string, lane: Lane | null, progress?: Map<number, Progress>): FurnaceSlotView {
  if (!lane) return { hand, paint: paintOf(hand), busy: false, u: 0, coil: "wait", bad: false, held: false, hammer: false, ready: false };
  const s = lane.stage;
  return {
    hand: lane.hand,
    paint: paintOf(lane.hand),
    busy: true,
    u: heightOf(s, progress?.get(lane.crate.number)),
    coil: coilState(s),
    bad: s === "red" || s === "stuck",
    held: s === "waiting" || s === "paused",
    hammer: s === "building",
    ready: s === "ready",
  };
}

export function FurnaceStage({ data, ideas, progress, now, connected, lead, stop, onSuggest, onIdea, onShips }: FurnaceProps) {
  const stage = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Furnace | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const at = useRef(new Map<string, [number, number]>());
  const card = useRef<HTMLDivElement>(null);
  const [gl, setGl] = useState<GL>("idle");
  useRoomReady(gl === "on" || gl === "off");
  const [hot, setHot] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const open = sel ?? hot;

  const { lanes, more: past } = useMemo(() => forgeLanes(data.crates, data.prs ?? []), [data.crates, data.prs]);
  const furnace = useMemo(() => furnaceOf(lanes, past), [lanes, past]);
  const queue = useMemo(() => queueOf(data.crates), [data.crates]);
  const today = shippedToday(data.changelog, now);
  const week = data.changelog.filter((c) => now - c.at < 7 * 24 * HOUR).length;
  const main = data.checks.state;
  const decisions = data.crates.filter((c) => c.kind !== "idea" && (c.state === "ready" || c.state === "stuck"));
  const questions = ideas.filter((c) => !c.revising && c.asking && c.question);
  const toPick = ideas.filter((c) => !c.revising).length - questions.length;
  const rivetLane = furnace.rivet[0] ?? null;
  const rockyBusy = furnace.slots.some((s) => s.lane?.hand === "Rocky");

  const view: FurnaceView = useMemo(
    () => ({
      slots: furnace.slots.map((s) => slotView(s.hand, s.lane, progress)),
      rivet: rivetLane ? slotView("Rivet", rivetLane, progress) : null,
      queue: queue.length,
      shipped: today,
      main: mainCoil(main),
    }),
    [furnace, rivetLane, progress, queue.length, today, main],
  );
  const live = useRef(view);
  live.current = view;

  // Where the card stands: beside its anchor on a wide screen (a bottom sheet on a phone, in CSS).
  const placeCard = () => {
    const c = card.current;
    const st = stage.current;
    const id = open;
    if (!c || !st || !id) return;
    const p = at.current.get(id) ?? (FLAT[id] ? ([(FLAT[id]![0] / 100) * st.clientWidth, (FLAT[id]![1] / 100) * st.clientHeight] as [number, number]) : null);
    if (!p) return;
    const W = st.clientWidth;
    const H = st.clientHeight;
    const w = c.offsetWidth || 360;
    const h = c.offsetHeight || 300;
    // Beside the shaft, never over its rings: on the side the anchor is on when there is room, else the other side.
    const L = at.current.get("shaft-l")?.[0] ?? W * 0.36;
    const R = at.current.get("shaft-r")?.[0] ?? W * 0.64;
    const roomL = L - 40 >= w;
    const roomR = W - R - 40 >= w;
    const side = p[0] < W / 2 ? (roomL ? "l" : roomR ? "r" : null) : roomR ? "r" : roomL ? "l" : null;
    const below = (sel: string) => {
      const el = st.querySelector(sel);
      return el ? el.getBoundingClientRect().bottom - st.getBoundingClientRect().top + 16 : 96;
    };
    const top = side === "l" ? below(".fo-needs") : side === "r" ? below(".fo-stats") : 96;
    const x = side === "l" ? Math.max(16, L - w - 28) : side === "r" ? Math.min(W - w - 16, R + 28) : Math.max(16, Math.min(W - w - 16, p[0] < W * 0.58 ? p[0] + 96 : p[0] - w - 96));
    const y = Math.max(top, Math.min(H - h - 16, p[1] - h * 0.35));
    c.style.setProperty("--cx", `${Math.round(x)}px`);
    c.style.setProperty("--cy", `${Math.round(y)}px`);
  };
  const placeRef = useRef(placeCard);
  /** Lays the tags out again (after a render hands them new elements). */
  const respread = useRef<() => void>(() => {});
  placeRef.current = placeCard;

  // The 3D: loaded once the page has painted.
  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el) return;
    let dead = false;
    let settle = 0;
    // The tags ride their anchors, but never on top of one another: lowest first, each one that would cover a tag
    // already placed fans out sideways at its own height (jobs on the deck spread across it, not up over the rings),
    // and only when there's no room either side is it lifted just above.
    const spread = () => {
      type Box = { l: number; r: number; t: number; b: number };
      const boxes: Box[] = [];
      const st = stage.current;
      const W = st?.clientWidth ?? window.innerWidth;
      const phone = isPhone();
      // The head's words and its numbers stand over the top of the hall: a tag that would land on them goes under them
      // instead (#932: the Shipped tag sat on the numbers).
      const fixed: Box[] = [];
      if (st) {
        const top = st.getBoundingClientRect();
        for (const el of st.querySelectorAll(".fo-head>*")) {
          const r = el.getBoundingClientRect();
          if (r.width && r.height) fixed.push({ l: r.left - top.left - 6, r: r.right - top.left + 6, t: r.top - top.top - 6, b: r.bottom - top.top + 6 });
        }
      }
      const L = at.current.get("shaft-l")?.[0] ?? W * 0.3;
      const R = at.current.get("shaft-r")?.[0] ?? W * 0.7;
      const mid = (L + R) / 2;
      const list = [...TAGS].map((id) => ({ id, p: at.current.get(id), el: els.current.get(id) })).filter((x) => x.p && x.el && !x.el.classList.contains("is-away"));
      // Rivet's and Rocky's tags go first, so they keep their place by their models and the rest move round them.
      const pinned = (id: string) => id === "rivet" || id === "rocky";
      list.sort((a, b) => Number(pinned(b.id)) - Number(pinned(a.id)) || b.p![1] - a.p![1]);
      for (const { id, p, el } of list) {
        const w = el!.offsetWidth;
        const h = el!.offsetHeight;
        // Kept on screen from the start, so a tag whose model stands near the edge stays by it rather than being
        // fanned off across the hall (#932: Rivet's and Rocky's tags on a phone).
        let x = Math.max(w / 2 + 8, Math.min(W - w / 2 - 8, p![0]));
        let y = p![1];
        // On a phone the jobs ride beside the shaft, not over it (#932): left of it or right, by which side their ingot is on.
        const side = phone && /^s\d$/.test(id);
        if (side) x = p![0] < mid ? Math.max(w / 2 + 6, L - w / 2 - 4) : Math.min(W - w / 2 - 6, R + w / 2 + 4);
        el!.classList.toggle("is-side", side);
        const boxAt = (bx: number, by: number) => ({ l: bx - w / 2 - 4, r: bx + w / 2 + 4, t: by - 12 - h - 4, b: by - 12 + 4 });
        const hits = (b: Box) => boxes.find((o) => o.l < b.r && b.l < o.r && o.t < b.b && b.t < o.b);
        const under = (b: Box) => fixed.find((o) => o.l < b.r && b.l < o.r && o.t < b.b && b.t < o.b);
        for (let k = 0; k < 8; k++) {
          const f = under(boxAt(x, y));
          if (f) {
            y = f.b + h + 12 + 4;
            continue;
          }
          let placed = false;
          for (const n of side || pinned(id) ? [0] : [0, -1, 1, -2, 2]) {
            const bx = x + n * (w + 8);
            if (bx - w / 2 < 8 || bx + w / 2 > W - 8) continue;
            const box = boxAt(bx, y);
            if (!hits(box) && !under(box)) {
              boxes.push(box);
              x = bx;
              placed = true;
              break;
            }
          }
          if (placed) break;
          const hit = hits(boxAt(x, y));
          // A job beside the shaft steps down under the one it meets (up would run it into the head's numbers).
          if (side) y = (hit ? hit.b : y) + h + 12 + 4;
          else y = (hit ? hit.t : y - h) + 12 - 4;
        }
        el!.style.setProperty("--gx", `${Math.round(x)}px`);
        el!.style.setProperty("--gy", `${Math.round(y)}px`);
      }
      // The zone labels hang off the shaft's left side; one a card would cover steps left of it, and one the screen's
      // edge would clip goes over to the shaft's right (#932: WORKING under Rusty's card, CHECKS and PICTURES clipped).
      // A phone has no room beside the shaft once the cards are there, so its labels sit in the shaft, on their rings.
      for (const id of ZONES) {
        const el = els.current.get(id);
        const p = at.current.get(id);
        if (!el || !p) continue;
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let x = p[0];
        let mode: "l" | "r" | "in" = "l";
        if (phone) {
          mode = "in";
          x = mid;
        } else {
          for (let k = 0; k < 4; k++) {
            // The label ends at x and its rule runs on 26 px past it toward the shaft.
            const box = { l: x - w - 2, r: x + 28, t: p[1] - h / 2 - 2, b: p[1] + h / 2 + 2 };
            const hit = boxes.find((o) => o.l < box.r && box.l < o.r && o.t < box.b && box.t < o.b);
            if (!hit) break;
            x = hit.l - 30;
          }
          if (x - w < 8) {
            mode = "r";
            x = Math.max(R, mid + (mid - p[0]));
          }
        }
        el.dataset.side = mode;
        el.style.setProperty("--gx", `${Math.round(x)}px`);
        el.style.setProperty("--gy", `${Math.round(p[1])}px`);
      }
    };
    respread.current = () => {
      if (!settle) settle = requestAnimationFrame(() => ((settle = 0), spread()));
    };
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./furnaceScene.ts")
        .then((m) => {
          if (!m.canDraw3D()) throw new Error("no WebGL");
          return m.createFurnace(el, cv, {
            phone: isPhone(),
            reduce: reducedMotion(),
            view: live.current,
            onPlace: (id, x, y, on) => {
              at.current.set(id, [x, y]);
              if (id.startsWith("shaft-")) return;
              const t = els.current.get(id);
              if (TAGS.has(id) || ZONES.includes(id)) {
                t?.classList.toggle("is-away", !on);
                respread.current();
              } else if (t) {
                t.style.setProperty("--gx", `${Math.round(x)}px`);
                t.style.setProperty("--gy", `${Math.round(y)}px`);
                t.classList.toggle("is-away", !on);
              }
              placeRef.current();
            },
            onPoint: (id) => setHot(id),
            onPick: (id) => setSel((s) => (s === id ? null : id)),
          });
        })
        .then((f) => {
          if (dead) return f.dispose();
          scene.current = f;
          setGl("on");
        })
        .catch(() => !dead && setGl("off"));
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const viaIdle = typeof w.requestIdleCallback === "function";
    const idle = viaIdle ? w.requestIdleCallback!(start, { timeout: 600 }) : window.setTimeout(start, 120);
    return () => {
      dead = true;
      cancelAnimationFrame(settle);
      if (viaIdle) w.cancelIdleCallback?.(idle);
      else window.clearTimeout(idle);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  const viewSig = JSON.stringify(view);
  useEffect(() => {
    scene.current?.set(live.current);
  }, [viewSig, gl]);
  useEffect(() => {
    scene.current?.setHot(open);
    placeCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gl]);

  useEffect(() => {
    if (!sel) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.(".fo-pop, .fo-tag, .fo-gl")) setSel(null);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", away);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", away);
    };
  }, [sel]);

  const ref = (id: string) => (el: HTMLElement | null) => {
    if (el) {
      els.current.set(id, el);
      const p = at.current.get(id);
      if (TAGS.has(id) || ZONES.includes(id)) respread.current();
      else if (p) {
        el.style.setProperty("--gx", `${Math.round(p[0])}px`);
        el.style.setProperty("--gy", `${Math.round(p[1])}px`);
      }
    } else els.current.delete(id);
  };
  const flat = (id: string) => ({ "--fx": `${FLAT[id]?.[0] ?? 50}%`, "--fy": `${FLAT[id]?.[1] ?? 50}%` }) as CSSProperties;
  const tagProps = (id: string) => ({
    ref: ref(id),
    "aria-expanded": sel === id,
    onClick: () => setSel((s) => (s === id ? null : id)),
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === "mouse" && setHot(id),
    onPointerLeave: () => setHot(null),
    onFocus: () => setHot(id),
    onBlur: () => setHot(null),
  });

  // The headline: who is at the forge, or what it waits on.
  const hands = [...new Set([...furnace.slots.map((s) => s.lane), rivetLane].filter((l): l is Lane => !!l && l.flight === "running" && l.crate.state === "working").map((l) => l.hand))];
  const running = furnace.slots.filter((s) => s.lane && s.lane.flight === "running" && s.lane.crate.state === "working").length;
  const h1: ReactNode = !connected ? (
    <>
      The furnace is <em>waking.</em>
    </>
  ) : hands.length ? (
    <>
      {hands.length > 3 ? "Every hand is" : hands.length === 1 ? `${hands[0]} is` : `${hands.slice(0, -1).join(", ")} and ${hands.at(-1)} are`} <em>at the furnace.</em>
    </>
  ) : ideas.length ? (
    <>
      The furnace waits on <em>your pick.</em>
    </>
  ) : (
    <>
      The furnace is <em>banked.</em>
    </>
  );
  const day = new Date(now).toLocaleDateString(undefined, { weekday: "long" });
  const firstPick = ideas.find((c) => !c.revising && !(c.asking && c.question));

  let pop: ReactNode = null;
  if (open) {
    const slot = /^s\d$/.test(open) ? furnace.slots[Number(open.slice(1))] : null;
    if (slot?.lane) pop = <LaneCard lane={slot.lane} progress={progress?.get(slot.lane.crate.number)} now={now} stop={stop} />;
    else if (slot) pop = <FreeCard hand={slot.hand} i={slot.i} connected={connected} />;
    else if (open === "rivet") pop = rivetLane ? <LaneCard lane={rivetLane} progress={progress?.get(rivetLane.crate.number)} now={now} stop={stop} extra={furnace.rivet.length - 1} /> : <RivetCard main={main} connected={connected} />;
    else if (open === "rocky") pop = <RockyCard connected={connected} />;
    else if (open === "queue") pop = <QueueCard queue={queue} now={now} connected={connected} />;
    else if (open === "ship") pop = <ShipCard data={data} now={now} today={today} week={week} onShips={onShips} />;
    else if (open === "more") pop = <MoreCard more={furnace.more} progress={progress} />;
  }

  return (
    <section ref={stage} className="fo-stage fo-hall" data-gl={gl} aria-label="The Foundry at a glance: the Deep Furnace">
      <div className="fo-flat" aria-hidden="true">
        <i className="fo-flat-shaft" />
        <i className="fo-flat-melt" />
      </div>
      <div ref={host} className="fo-host">
        <canvas ref={canvas} className="fo-gl" aria-hidden="true" />
      </div>
      <div className="fo-vig" aria-hidden="true" />

      <header className="fo-head">
        <p className="fo-eyb">
          Foundry <i /> {day}
        </p>
        <h1 className="fo-h1 desk__title">{h1}</h1>
        <p className="fo-say">{lead}</p>
        <div className="fo-needs" aria-label="Held for you">
          {decisions.map((c) => (
            <a key={c.number} className="fo-chip-b" data-tone={c.state === "stuck" ? "bad" : "hot"} href={FOUNDRY_THREAD} target="_blank" rel="noreferrer" title={ideaTitle(c.title)}>
              <b>{c.state === "stuck" ? "Stuck" : "Ship it?"}</b> #{c.number}
            </a>
          ))}
          {questions.map((c) => (
            <button key={c.number} type="button" className="fo-chip-b" data-tone="hot" onClick={() => onIdea(c.number)} title={c.question}>
              <b>Rivet asks</b> about #{c.number}
            </button>
          ))}
          {toPick > 0 && (
            <button type="button" className="fo-chip-b" data-tone="hot" onClick={() => firstPick && onIdea(firstPick.number)}>
              <b>{words(toPick)}</b> {toPick === 1 ? "idea" : "ideas"} to pick
            </button>
          )}
          {furnace.more.length > 0 && (
            <button type="button" className={`fo-chip-b fo-more${open === "more" ? " is-lit" : ""}`} aria-expanded={sel === "more"} onClick={() => setSel((s) => (s === "more" ? null : "more"))}>
              <b>+{furnace.more.length}</b> more in hand
            </button>
          )}
          <button type="button" className="fo-chip-b is-sug" onClick={onSuggest}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Suggest an idea
          </button>
        </div>
        <dl className="fo-stats">
          <div className={ideas.length ? "is-hot" : undefined}>
            <dt>Ideas</dt>
            <dd>{connected ? ideas.length : "—"}</dd>
          </div>
          <div>
            <dt>Queued</dt>
            <dd>{connected ? queue.length : "—"}</dd>
          </div>
          <div className={running ? "is-hot" : undefined}>
            <dt>At the furnace</dt>
            <dd>
              {connected ? running : "—"}
              <small>/{LANES}</small>
            </dd>
          </div>
          <div data-tone={main}>
            <dt>Main checks</dt>
            <dd>{main === "pass" ? "Green" : main === "fail" ? "Red" : main === "running" ? "Running" : "—"}</dd>
          </div>
          <div>
            <dt>Shipped today</dt>
            <dd>{connected ? today : "—"}</dd>
          </div>
        </dl>
      </header>


      <div className="fo-zones" aria-hidden="true">
        {(
          [
            ["z-ship", TRAIL[3]],
            ["z-checks", TRAIL[2]],
            ["z-pictures", TRAIL[1]],
            ["z-work", TRAIL[0]],
          ] as const
        ).map(([id, w]) => (
          <span key={id} ref={ref(id)} className="fo-zone">
            {w}
          </span>
        ))}
        {CHECKS.map((c, i) => (
          <span key={c} ref={ref(`c${i}`)} className="fo-coil-l">
            {c}
          </span>
        ))}
      </div>

      <ol className="fo-tags" aria-label="Jobs in flight: four slots, and Rivet outside them">
        {furnace.slots.map((s) => {
          const id = `s${s.i}`;
          const l = s.lane;
          return (
            <li key={id}>
              <button type="button" className={`fo-tag${l ? " fo-job" : " is-free"}${open === id ? " is-lit" : ""}`} data-slot={s.i} data-stage={l?.stage} style={{ ...flat(id), "--c": paintOf(s.hand) } as CSSProperties} {...tagProps(id)}>
                {l ? <JobTag lane={l} /> : (
                  <>
                    <b>{s.hand}</b>
                    <small>{connected ? "asleep on the ring" : "waiting for GitHub"}</small>
                  </>
                )}
              </button>
            </li>
          );
        })}
        <li>
          <button type="button" className={`fo-tag is-rivet${rivetLane ? " fo-job" : " is-free"}${open === "rivet" ? " is-lit" : ""}`} data-slot="rivet" data-stage={rivetLane?.stage} style={{ ...flat("rivet"), "--c": paintOf("Rivet") } as CSSProperties} {...tagProps("rivet")}>
            {rivetLane ? <JobTag lane={rivetLane} /> : (
              <>
                <b>Rivet</b>
                <small>on watch</small>
              </>
            )}
          </button>
        </li>
        {!rockyBusy && (
          <li>
            <button type="button" className={`fo-tag is-free${open === "rocky" ? " is-lit" : ""}`} data-slot="rocky" style={{ ...flat("rocky"), "--c": paintOf("Rocky") } as CSSProperties} {...tagProps("rocky")}>
              <b>Rocky</b>
              <small>{connected ? "asleep over the plan" : "waiting for GitHub"}</small>
            </button>
          </li>
        )}
        <li>
          <button type="button" className={`fo-tag is-zone${open === "queue" ? " is-lit" : ""}`} data-slot="queue" style={flat("queue")} {...tagProps("queue")}>
            <b>Queue</b>
            <span className="fo-tag-n">{connected ? queue.length : "—"}</span>
            <small>{queue.length ? `next #${queue[0]!.number}` : connected ? "the cart is empty" : "waiting"}</small>
          </button>
        </li>
        <li>
          <button type="button" className={`fo-tag is-zone is-ship${open === "ship" ? " is-lit" : ""}`} data-slot="ship" data-tone={main} style={flat("ship")} {...tagProps("ship")}>
            <b>Shipped</b>
            <span className="fo-tag-n">{connected ? today : "—"}</span>
            <small>today · main {main === "pass" ? "green" : main === "fail" ? "red" : main === "running" ? "running" : "no run yet"}</small>
          </button>
        </li>
      </ol>

      {pop && (
        <div ref={card} className={`fo-pop${sel ? " is-pinned" : ""}`} role="dialog" aria-label="Details" onPointerEnter={() => hot && setHot(hot)}>
          {sel && (
            <button type="button" className="fo-pop-x" aria-label="Close" onClick={() => setSel(null)}>
              ×
            </button>
          )}
          {pop}
        </div>
      )}
    </section>
  );
}

/** The small card a job carries up its chain: who, which issue, what it builds (its Short line) and where it stands. */
function JobTag({ lane }: { lane: Lane }) {
  return (
    <>
      <span className="fo-job-k">
        <i aria-hidden="true" />
        <b>{lane.hand}</b>
        <span className="fo-tag-n">#{lane.crate.number}</span>
      </span>
      <span className="fo-job-t">{shortOf(lane.crate)}</span>
      <small className={`fo-tag-s is-${PILL[lane.stage]}`}>{STAGE_WORDS[lane.stage]}</small>
    </>
  );
}

/** A job on its chain: who, what, where on the Trail, its five checks, how far along, and its links. */
function LaneCard({ lane, progress, now, stop, extra = 0 }: { lane: Lane; progress?: Progress; now: number; stop: (c: Crate) => ReactNode; extra?: number }) {
  const c = lane.crate;
  const step = trailStep(lane.stage);
  const coil = coilState(lane.stage);
  return (
    <div className="fo-pop-b" data-stage={lane.stage}>
      <p className="fo-pop-k" style={{ "--c": paintOf(lane.hand) } as CSSProperties}>
        <img src={pic(lane.who)} alt="" />
        <span>
          <b>{lane.hand}</b>
          {lane.hand !== CREW[lane.who].name ? ", of Rusty's dock crew" : ""} · {modelOf(c, lane.who)} · {c.kind === "chat" ? "from chat" : c.kind} · {formatWait(now - c.updatedAt)}
        </span>
      </p>
      <h3 className="fo-pop-h">
        <a href={c.url} target="_blank" rel="noreferrer">
          {ideaTitle(c.title)}
        </a>
        <span className="fo-pop-n">#{c.number}</span>
      </h3>
      <span className={`fo-pill is-${PILL[lane.stage]}`}>{STAGE_WORDS[lane.stage]}</span>
      <ol className="fo-steps" aria-label="Trail">
        {TRAIL.map((s, i) => (
          <li key={s} className={i < step ? "is-past" : i === step ? "is-now" : undefined}>
            {s}
          </li>
        ))}
      </ol>
      <ul className="fo-checks5" aria-label="The five checks">
        {CHECKS.map((k) => (
          <li key={k} data-s={coil} title={`${k}: ${COIL_WORD[coil]}`}>
            <i aria-hidden="true" />
            {k}
          </li>
        ))}
      </ul>
      {coil === "fail" && <p className="fo-pop-bad">Checks red. The pull request's checks page says which one; the ingot waits under the coils for the fix.</p>}
      {lane.stage === "stuck" && <p className="fo-pop-bad">Stuck after every rung: it needs your call.</p>}
      {progress && (
        <div className="fo-prog" title={`${stepWords(progress)}${progress.doing ? `: ${progress.doing}` : ""}.`}>
          <span className="fo-prog-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.pct} aria-valuetext={`${stepWords(progress)}, ${progress.pct}%`} aria-label="Progress">
            {MILESTONES.map((m, i) => (
              <i key={m} data-on={i < progress.step || undefined} />
            ))}
          </span>
          <span className="fo-prog-t">
            {progressWords(progress)}
            {progress.doing ? ` · ${progress.doing}` : ""}
          </span>
        </div>
      )}
      {(c.short || c.pitch) && (c.short || c.pitch).replace(/\.$/, "") !== ideaTitle(c.title) && <p className="fo-pop-p">{c.short || c.pitch}</p>}
      {extra > 0 && <p className="fo-pop-p">Rivet has {extra} more running as clones.</p>}
      <div className="fo-do">
        <a className="fl-btn is-pri" href={c.url} target="_blank" rel="noreferrer">
          The issue
        </a>
        {lane.pr && (
          <a className="fl-btn" href={lane.pr.url} target="_blank" rel="noreferrer">
            Pull request #{lane.pr.number}
          </a>
        )}
        {(c.state === "ready" || c.state === "stuck") && (
          <a className="fl-btn" href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
            {c.state === "stuck" ? "See why" : "Decide"}
          </a>
        )}
        {stop(c)}
      </div>
    </div>
  );
}

function FreeCard({ hand, i, connected }: { hand: string; i: number; connected: boolean }) {
  return (
    <div className="fo-pop-b">
      <p className="fo-pop-k" style={{ "--c": paintOf(hand) } as CSSProperties}>
        <img src={pic("tessellate")} alt="" />
        <span>
          <b>{hand}</b> · slot {i + 1} of {SLOT_HANDS.length}
        </span>
      </p>
      <h3 className="fo-pop-h">{connected ? "Free, asleep on the charging ring" : "Waiting for GitHub"}</h3>
      <p className="fo-pop-p">{i === 0 ? "Rusty's own slot. He takes the next build off the queue." : `${hand} wakes when a job runs past Rusty's own, and works it here beside him.`} Four jobs run at once at most; Rocky takes a free slot when he builds.</p>
    </div>
  );
}

function RockyCard({ connected }: { connected: boolean }) {
  return (
    <div className="fo-pop-b">
      <p className="fo-pop-k" style={{ "--c": paintOf("Rocky") } as CSSProperties}>
        <img src={pic("caret")} alt="" />
        <span>
          <b>Rocky</b> · master builder, one big job at a time
        </span>
      </p>
      <h3 className="fo-pop-h">{connected ? "Asleep over the plan at his drafting table" : "Waiting for GitHub"}</h3>
      <p className="fo-pop-p">When a big build comes his way he takes a free slot: he comes apart into nanites at his table and puts himself back together at its anvil, and that slot's hand steps aside for him.</p>
    </div>
  );
}

function RivetCard({ main, connected }: { main: FoundryData["checks"]["state"]; connected: boolean }) {
  return (
    <div className="fo-pop-b">
      <p className="fo-pop-k" style={{ "--c": paintOf("Rivet") } as CSSProperties}>
        <img src={pic("semicolon")} alt="" />
        <span>
          <b>Rivet</b> · first responder and upkeep, outside the four
        </span>
      </p>
      <h3 className="fo-pop-h">{connected ? "On watch at the alarm post" : "Waiting for GitHub"}</h3>
      <p className="fo-pop-p">
        Fixes and upkeep go to her first and never wait for a slot. The lamp on her post is main's own checks: {main === "pass" ? "green" : main === "fail" ? "red" : main === "running" ? "running" : "no run yet"}.
      </p>
    </div>
  );
}

function QueueCard({ queue, now, connected }: { queue: Crate[]; now: number; connected: boolean }) {
  return (
    <div className="fo-pop-b">
      <p className="fo-pop-k">
        <span>
          <b>Queue</b> · approved work nobody holds yet, oldest first
        </span>
      </p>
      <h3 className="fo-pop-h">{queue.length ? `${words(queue.length)} in the cart` : connected ? "The cart is empty" : "Waiting for GitHub"}</h3>
      {queue.length > 0 ? (
        <ul className="fo-pop-l">
          {queue.slice(0, 6).map((c, i) => (
            <li key={c.number}>
              <a href={c.url} target="_blank" rel="noreferrer">
                {i === 0 ? "Next: " : ""}
                {c.short || ideaTitle(c.title)}
              </a>
              <span>
                #{c.number} · {formatWait(now - c.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fo-pop-p">Fixes, builds, upkeep and work asked for in chat wait here. The next queue check is {countdown(nextRuns(new Date(now)).queue, new Date(now))}.</p>
      )}
    </div>
  );
}

function ShipCard({ data, now, today, week, onShips }: { data: FoundryData; now: number; today: number; week: number; onShips: () => void }) {
  const main = data.checks.state;
  return (
    <div className="fo-pop-b">
      <p className="fo-pop-k">
        <span>
          <b>Ship</b> · out of the hatch, onto the Lattice
        </span>
      </p>
      <h3 className="fo-pop-h">
        {words(today)} shipped today{week > today ? `, ${week} this week` : ""}
      </h3>
      <p className="fo-pop-p">
        main's checks: {main === "pass" ? "green" : main === "fail" ? "red" : main === "running" ? "running" : "no run yet"}
        {data.checks.url && (
          <>
            {" · "}
            <a className="fo-link" href={data.checks.url} target="_blank" rel="noreferrer">
              the run ↗
            </a>
          </>
        )}
      </p>
      <ul className="fo-pop-l">
        {data.changelog.slice(0, 4).map((c) => (
          <li key={c.key}>
            <a href={c.landed?.url ?? c.issue?.url} target="_blank" rel="noreferrer">
              {ideaTitle(c.title)}
            </a>
            <span>{now - c.at < 24 * HOUR ? clock(c.at) : `${formatWait(now - c.at)} ago`}</span>
          </li>
        ))}
      </ul>
      {data.changelog.length > 0 && (
        <button type="button" className="fl-btn" onClick={onShips}>
          The changelog ↓
        </button>
      )}
    </div>
  );
}

function MoreCard({ more, progress }: { more: Lane[]; progress?: Map<number, Progress> }) {
  return (
    <div className="fo-pop-b">
      <p className="fo-pop-k">
        <span>
          <b>In hand</b> · past the four slots
        </span>
      </p>
      <ul className="fo-pop-l">
        {more.map((l) => (
          <li key={l.crate.number}>
            <a href={l.crate.url} target="_blank" rel="noreferrer">
              #{l.crate.number} {ideaTitle(l.crate.title)}
            </a>
            <span>
              {l.hand}, {STAGE_WORDS[l.stage]}
              {progress?.get(l.crate.number) ? `, ${progressWords(progress.get(l.crate.number)!)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
