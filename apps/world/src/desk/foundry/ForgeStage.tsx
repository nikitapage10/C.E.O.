import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CREW, DOCK_CREW, modelOf, shippedToday, type Change, type Crate, type FoundryData } from "../../foundry.ts";
import { countdown, nextRuns } from "../crewRuns.ts";
import { FOUNDRY_THREAD, formatWait } from "../deskData.ts";
import { RC, samplePath, useFlow, type FlowLayoutFn, type FlowLine, type PathSpec, type Pt } from "../flow/index.ts";
import { ideaTitle } from "../IdeaCard.tsx";
import { BAD, clamp, HOT, mixRgb, OK, RUN, WHITE } from "../wvCanvas.ts";
import { leftWords, MILESTONES, progressWords, sourceWords, stepWords, type Progress } from "./progress.ts";
import { forgeEvents, forgeLanes, GATE_U, LANES, queueOf, shipWords, snapshot, STAGE_U, STAGE_WORDS, type Lane, type Stage } from "./forge.ts";

/**
 * The Foundry's stage (#432), on the Desk's flow kit in Today's language with the Builder's forge orange. The particle
 * lines are the pipeline itself, left to right: each idea on the bench is a thread held at the queue's gate until
 * Nikita picks it; the queue is one line whose weight is the work waiting; it fans into the forge's four lanes (the
 * crew's cap: Rusty and his dock crew, or Rocky and Rivet on theirs), one job each; every lane runs lit as far as its
 * job has got (building, its pull request open, its checks at the gate, green) and dashed and cold beyond; the gate is
 * a falling curtain of light that is main's own checks; and the lanes gather into Shipped. A real change runs a packet
 * down its line (picked up, pull request opened, checks green), and a ship raises its words off the end, falling to sand.
 *
 * Signature (one idea of its own, per the kit): a job's line is lit only as far as the job has really got.
 */

const ACCENT = RC.foundry!;
const IDEA_RGB = mixRgb(ACCENT, HOT, 0.55);
const GREEN_RGB = mixRgb(ACCENT, OK, 0.55);
const CHECK_RGB = mixRgb(ACCENT, RUN, 0.35);
const READY_RGB = mixRgb(ACCENT, WHITE, 0.45);
const BAD_RGB = mixRgb(ACCENT, BAD, 0.7);
const HOUR = 3_600_000;
const NUM = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const words = (n: number) => NUM[n] ?? String(n);
const pic = (id: string) => `/desk/agent-${id}.webp`;
const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
/** The most ideas that get their own thread on the stage (the rest are counted). */
const IDEA_THREADS = 4;
/** Rusty's hands in bay order: a free one waits in its bay. */
const HANDS = ["Rusty", ...DOCK_CREW.map((d) => d.name)];

/** How each stage's lit part runs: colour, pace (px/s), weight, scatter. */
const LOOK: Record<Stage, { rgb: string; rate: number; density: number; spread: number; bright?: number }> = {
  waiting: { rgb: ACCENT, rate: 10, density: 0.2, spread: 2 },
  paused: { rgb: ACCENT, rate: 8, density: 0.25, spread: 2 },
  building: { rgb: ACCENT, rate: 44, density: 0.85, spread: 2.6 },
  pr: { rgb: ACCENT, rate: 52, density: 0.88, spread: 2.6 },
  checks: { rgb: CHECK_RGB, rate: 66, density: 0.92, spread: 2.8 },
  red: { rgb: BAD_RGB, rate: 14, density: 0.45, spread: 3.6 },
  green: { rgb: GREEN_RGB, rate: 80, density: 0.95, spread: 2.6 },
  ready: { rgb: READY_RGB, rate: 20, density: 0.6, spread: 2.2 },
  stuck: { rgb: BAD_RGB, rate: 8, density: 0.32, spread: 4.5 },
};
const PILL: Record<Stage, "run" | "ok" | "hot" | "bad" | "off"> = { waiting: "off", paused: "off", building: "run", pr: "run", checks: "run", red: "bad", green: "ok", ready: "hot", stuck: "bad" };
const STEPS = ["Idea", "Queue", "Forge", "Checks", "Shipped"];
const stepOf = (s: Stage) => (s === "waiting" ? 1 : s === "paused" || s === "building" || s === "stuck" || s === "pr" ? 2 : s === "green" || s === "ready" ? 3.5 : 3);

/** Cut a sampled path at the first point past `x` after index `from`: the lit part and the cold rest. */
function cutAt(xs: number[], ys: number[], from: number, x: number): [PathSpec, PathSpec] {
  let k = from;
  while (k < xs.length - 1 && xs[k]! < x) k++;
  k = Math.max(1, Math.min(xs.length - 2, k));
  return [
    { xs: xs.slice(0, k + 1), ys: ys.slice(0, k + 1) },
    { xs: xs.slice(k), ys: ys.slice(k) },
  ];
}

const nearest = (xs: number[], ys: number[], p: Pt) => {
  let best = 0;
  let d = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const e = (xs[i]! - p[0]) ** 2 + (ys[i]! - p[1]) ** 2;
    if (e < d) {
      d = e;
      best = i;
    }
  }
  return best;
};

export interface ForgeProps {
  data: FoundryData;
  ideas: Crate[];
  /** How far along each job in flight is and how long it has left, by issue (#488); empty until the trails arrive. */
  progress?: Map<number, Progress>;
  now: number;
  connected: boolean;
  lead: string;
  /** Stop, for a build the Builder approved itself. */
  stop: (c: Crate) => ReactNode;
  onSuggest: () => void;
  /** Go to an idea's card on the bench. */
  onIdea: (n: number) => void;
  /** Go to the Changelog. */
  onShips: () => void;
}

export function ForgeStage({ data, ideas, progress, now, connected, lead, stop, onSuggest, onIdea, onShips }: ForgeProps) {
  const stage = useRef<HTMLElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | "more" | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const { lanes, more } = useMemo(() => forgeLanes(data.crates, data.prs ?? []), [data.crates, data.prs]);
  const queue = useMemo(() => queueOf(data.crates), [data.crates]);
  const bench = ideas;
  const threads = bench.slice(0, IDEA_THREADS);
  const today = shippedToday(data.changelog, now);
  const week = data.changelog.filter((c) => now - c.at < 7 * 24 * HOUR).length;
  const main = data.checks.state;
  const usedHands = new Set(lanes.map((l) => l.hand));
  const freeHands = HANDS.filter((h) => !usedHands.has(h)).slice(0, Math.max(0, LANES - lanes.length));
  const decisions = data.crates.filter((c) => c.kind !== "idea" && (c.state === "ready" || c.state === "stuck"));
  const questions = ideas.filter((c) => !c.revising && c.asking && c.question);
  const toPick = ideas.filter((c) => !c.revising).length - questions.length;
  const runs = nextRuns(new Date(now));

  // The layout is rebuilt only when what the lines carry changes, never on the minute's tick.
  const sig = `${connected}|${lanes.map((l) => `${l.crate.number}:${l.stage}:${l.hand}`).join()}|${more.length}|${queue.length}|${threads.map((c) => c.number).join()}|${main}|${today}|${week}|${open}`;
  const layout = useCallback<FlowLayoutFn>(
    ({ rel, phone, W }) => {
      const root = line.current;
      if (!root) return { lines: [] };
      const box = (sel: string) => {
        const el = root.querySelector(sel);
        if (!el) return null;
        const r = rel(el);
        return r.w || r.h ? r : null;
      };
      const mid = (sel: string): Pt | null => {
        const r = box(sel);
        return r ? [r.x + r.w / 2, r.y + r.h / 2] : null;
      };
      const q = mid("[data-fo=queue] .fo-dot");
      const s = mid("[data-fo=ship] .fo-dot");
      const gate = box("[data-fo=gate]");
      if (!q || !s || !gate) return { lines: [] };
      const gx = gate.x + gate.w / 2;
      const fan: Pt = phone ? [q[0], q[1] + 26] : [q[0] + 34, q[1]];
      const lines: FlowLine[] = [];

      // The ideas: threads held at the queue's gate until Nikita picks one.
      threads.forEach((c) => {
        const t = mid(`[data-fo-idea="${c.number}"] .fo-tail`);
        if (!t) return;
        lines.push({ id: `I:${c.number}`, path: { from: t, to: q, bend: phone ? 0.08 : -0.1 }, rgb: IDEA_RGB, rate: 14, density: 0.32, spread: 1.6, bright: 0.8, thin: { at: 0.78, keep: 0.06 }, knots: [0.995] });
      });
      if (!threads.length) {
        const t = mid("[data-fo=noidea] .fo-tail");
        if (t) lines.push({ id: "noidea", path: { from: t, to: q, bend: -0.06 }, waiting: true, rgb: IDEA_RGB });
      }

      // The queue: one line, as heavy as the work waiting.
      lines.push(
        queue.length
          ? { id: "queue", path: { from: q, to: fan, bend: 0 }, density: clamp(0.25 + queue.length * 0.18, 0, 1), rate: 30, spread: 2.4, bright: 0.9 }
          : { id: "queue", path: { from: q, to: fan, bend: 0 }, waiting: true },
      );

      // The forge's lanes: lit as far as each job has got, cold beyond.
      const rails = [...root.querySelectorAll<HTMLElement>("[data-fo-rail]")];
      let first = Infinity;
      let last = -Infinity;
      for (const el of rails) {
        const r = rel(el);
        const ly = r.y + r.h / 2;
        first = Math.min(first, ly);
        last = Math.max(last, ly);
        const rx = r.x;
        const re = r.x + r.w;
        const pts: Pt[] = phone ? [fan, [rx, ly - 14], [rx + 12, ly], [gx, ly], [re - 10, ly], s] : [fan, [rx - 28, ly], [rx + 10, ly], [gx, ly], [re, ly], s];
        const [xs, ys] = samplePath({ via: pts });
        const key = el.dataset.foRail!;
        const lane = lanes.find((l) => String(l.crate.number) === key);
        if (!lane) {
          lines.push({ id: `bay:${key}`, path: { xs, ys }, waiting: true, bed: 0.04 });
          continue;
        }
        const u = STAGE_U[lane.stage];
        const x = u <= GATE_U ? rx + (gx - rx) * (u / GATE_U) : gx + (re - 10 - gx) * ((u - GATE_U) / (1 - GATE_U));
        const [lit, rest] = cutAt(xs, ys, nearest(xs, ys, [rx, ly]), x);
        const look = LOOK[lane.stage];
        const held = lane.stage === "waiting" || lane.stage === "paused";
        const id = `L:${lane.crate.number}`;
        lines.push(held ? { id, path: lit, waiting: true, rgb: look.rgb, knots: [1] } : { id, path: lit, rgb: look.rgb, rate: look.rate, density: look.density, spread: look.spread, bright: look.bright ?? 1, knots: [0.998], bed: 0.16 });
        lines.push({ id: `${id}~`, path: rest, waiting: true, rgb: look.rgb, bed: 0.06 });
      }

      // The gate: main's own checks, a curtain of light falling through every lane.
      if (rails.length) {
        const top: Pt = [gx, first - (phone ? 26 : 34)];
        const bottom: Pt = [gx, last + (phone ? 22 : 30)];
        lines.push(
          main === "unknown"
            ? { id: "gate", path: { from: top, to: bottom, bend: 0 }, waiting: true, rgb: CHECK_RGB }
            : { id: "gate", path: { from: top, to: bottom, bend: 0 }, rgb: main === "pass" ? GREEN_RGB : main === "fail" ? BAD_RGB : CHECK_RGB, rate: main === "running" ? 70 : 18, density: main === "running" ? 0.8 : 0.45, spread: main === "fail" ? 3 : 1.4, bright: 0.75 },
        );
      }

      // Shipped: what reached the Lattice runs on off the stage, as many as this week's ships; today's are knots on it.
      if (!phone) {
        const end: Pt = [W + 12, s[1] - 30];
        const knots = today ? Array.from({ length: Math.min(today, 6) }, (_, i) => 0.22 + i * 0.11) : undefined;
        lines.push(week ? { id: "out", path: { from: s, to: end, bend: 0.06 }, rgb: GREEN_RGB, rate: 24, density: clamp(0.18 + week * 0.06, 0, 0.9), spread: 2, bright: 0.85, knots } : { id: "out", path: { from: s, to: end, bend: 0.06 }, waiting: true, rgb: GREEN_RGB });
      }
      return { lines, anchors: { ship: [s[0], s[1] - 26], queue: [q[0], q[1] - 22] } };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig],
  );

  const { cv, field, bind } = useFlow(layout, {
    accent: ACCENT,
    ground: true,
    backing: 650_000,
    onHover: (id) => setHot(id),
    onPick: (id) => {
      if (id.startsWith("L:")) setOpen(Number(id.slice(2).replace("~", "")));
      else if (id.startsWith("I:")) onIdea(Number(id.slice(2)));
      else if (id === "out" || id === "gate") onShips();
    },
  });

  // The lanes grow and shrink (one opens, the fonts arrive): the lines follow their rails.
  useEffect(() => {
    const el = line.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => field.relayout());
    ro.observe(el);
    void document.fonts?.ready.then(() => field.relayout(), () => undefined);
    return () => ro.disconnect();
  }, [field]);

  const hotLane = hot?.startsWith("L:") ? Number(hot.slice(2).replace("~", "")) : null;
  useEffect(() => field.setFocus(typeof open === "number" ? `L:${open}` : null), [field, open]);

  // What changed since the last read: a packet down its line, and a ship's words rising off the end.
  const prev = useRef<ReturnType<typeof snapshot> | null>(null);
  useEffect(() => {
    if (!connected) return;
    const snap = snapshot(lanes, queue, ideas, data.changelog, main);
    const events = forgeEvents(prev.current, snap, data.changelog);
    prev.current = snap;
    if (!events.length) return;
    const timers: number[] = [];
    // The new lines exist after the next layout; wait a beat for it.
    timers.push(
      window.setTimeout(() => {
        let ships = 0;
        for (const e of events) {
          if (e.kind === "idea") field.pulse(`I:${e.issue}`, { size: 8 });
          else if (e.kind === "queued") field.pulse("queue");
          else if (e.kind === "picked") {
            field.pulse("queue", { speed: 300 });
            timers.push(window.setTimeout(() => field.pulse(`L:${e.issue}`, { size: 10 }), 420));
          } else if (e.kind === "pr") field.pulse(`L:${e.issue}`, { size: 10 });
          else if (e.kind === "green") {
            field.pulse(`L:${e.issue}`, { size: 11, rgb: GREEN_RGB });
            field.burst(`L:${e.issue}`, { u: 1, n: 24, rgb: GREEN_RGB });
          } else if (e.kind === "red") field.burst(`L:${e.issue}`, { u: 1, n: 20, rgb: BAD_RGB });
          else if (e.kind === "shipped" && ships < 3) {
            ships++;
            field.burst("out", { u: 0, n: 36, rgb: GREEN_RGB });
            field.pulse("out", { size: 10 });
            field.rise(shipWords(e.change), { at: "ship", rgb: GREEN_RGB });
          } else if (e.kind === "main") {
            field.pulse("gate", { rgb: e.state === "pass" ? GREEN_RGB : BAD_RGB, size: 10 });
            if (e.state === "pass") field.rise("main is green", { at: "ship", rgb: GREEN_RGB });
          }
        }
      }, 80),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, data.changelog.length]);

  // The headline: who is at the forge, or what it waits on.
  const at = [...new Set(lanes.filter((l) => l.flight === "running" && l.crate.state === "working").map((l) => l.hand))];
  const h1: ReactNode = !connected ? (
    <>
      The forge is <em>waking.</em>
    </>
  ) : at.length ? (
    <>
      {at.length > 3 ? "Four hands are" : at.length === 1 ? `${at[0]} is` : `${at.slice(0, -1).join(", ")} and ${at.at(-1)} are`} <em>at the forge.</em>
    </>
  ) : ideas.length ? (
    <>
      The forge waits on <em>your pick.</em>
    </>
  ) : (
    <>
      The forge is <em>quiet.</em>
    </>
  );
  const running = lanes.filter((l) => l.flight === "running" && l.crate.state === "working").length;
  const day = new Date(now).toLocaleDateString(undefined, { weekday: "long" });

  return (
    <section ref={stage} className="fl-stage fo-stage" aria-label="The Foundry at a glance" {...bind} data-hot={hot ?? undefined}>
      <canvas ref={cv} className="fl-cv" aria-hidden="true" />
      <div className="fo-top">
        <header className="fo-head">
          <p className="fl-eyb">
            <span>Foundry</span>
            <i />
            {day}
            <small className="fo-eyb-x"> · the coding crew</small>
          </p>
          <h1 className="fl-h1 desk__title">{h1}</h1>
          <p className="fl-say">{lead}</p>
          <dl className="fl-ledger fo-ledger">
            <div className={ideas.length ? "is-hot" : undefined}>
              <dt>Ideas waiting</dt>
              <dd>{connected ? ideas.length : "—"}</dd>
            </div>
            <div>
              <dt>Queued</dt>
              <dd>{connected ? queue.length : "—"}</dd>
            </div>
            <div className={running ? "is-hot" : undefined}>
              <dt>At the forge</dt>
              <dd>
                {connected ? running : "—"}
                <small> of {LANES}</small>
              </dd>
            </div>
            <div data-tone={main}>
              <dt>Main checks</dt>
              <dd className="fo-checks">{main === "pass" ? "Green" : main === "fail" ? "Red" : main === "running" ? "Running" : "—"}</dd>
            </div>
            <div>
              <dt>Shipped today</dt>
              <dd>{connected ? today : "—"}</dd>
            </div>
          </dl>
        </header>
        <Held decisions={decisions} questions={questions} toPick={toPick} connected={connected} now={now} onIdea={onIdea} onSuggest={onSuggest} ideas={ideas} />
      </div>

      <div className="fo-line" ref={line} role="group" aria-label="The pipeline: ideas, the queue, the forge, checks, shipped">
        <ol className="fo-st" aria-hidden="true">
          <li className="fl-k">
            <span>Ideas</span> on the bench
          </li>
          <li className="fl-k">Queue</li>
          <li className="fl-k">
            <span>At the forge</span> · {running} of {LANES} hands busy
          </li>
          <li className="fl-k">Shipped</li>
        </ol>

        <ul className="fo-ideas" aria-label="Ideas on the bench">
          {threads.map((c) => (
            <li key={c.number} data-fo-idea={c.number}>
              <button type="button" className="fo-idea" onClick={() => onIdea(c.number)}>
                <b>{ideaTitle(c.title)}</b>
                <small>{c.asking ? "Rivet asks first" : c.revising ? "Rivet is rewriting it" : `${c.builder ? `for ${CREW[c.builder].name}` : "waiting"}${c.size ? ` · ${c.size}` : ""}`}</small>
              </button>
              <i className="fo-tail" aria-hidden="true" />
            </li>
          ))}
          {bench.length > IDEA_THREADS && <li className="fo-idea-more">+{bench.length - IDEA_THREADS} more on the bench</li>}
          {!threads.length && (
            <li data-fo="noidea" className="fo-noidea">
              <b className="fl-wait">{connected ? "The bench is clear" : "Waiting for GitHub"}</b>
              <small>{connected ? `The morning's three arrive ${countdown(runs.ideas, new Date(now))}, at 9:00.` : "The ideas show once GitHub answers."}</small>
              <i className="fo-tail" aria-hidden="true" />
            </li>
          )}
        </ul>

        <div className="fo-queue" data-fo="queue">
          <i className="fo-dot" aria-hidden="true" />
          <b className="fl-num">{connected ? queue.length : "—"}</b>
          <small>{queue.length ? `next: #${queue[0]!.number}` : connected ? "nothing queued" : "waiting"}</small>
          {queue.length > 0 && (
            <ul className="fo-q-l">
              {queue.slice(0, 3).map((c) => (
                <li key={c.number}>
                  <a href={c.url} target="_blank" rel="noreferrer" title={c.title}>
                    #{c.number} {c.short || ideaTitle(c.title)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="fo-lanes">
          <span className="fo-gate" data-fo="gate" aria-hidden="true" />
          <p className="fl-k fo-gate-h" aria-hidden="true">
            Checks
          </p>
          <ol className="fo-lane-l" aria-label="Jobs in flight">
            {lanes.map((l) => (
              <LaneRow key={l.crate.number} lane={l} progress={progress?.get(l.crate.number)} now={now} open={open === l.crate.number} lit={hotLane === l.crate.number} onOpen={() => setOpen((o) => (o === l.crate.number ? null : l.crate.number))} onHot={(on) => field.setFocus(on ? `L:${l.crate.number}` : typeof open === "number" ? `L:${open}` : null)} stop={stop} />
            ))}
            {freeHands.map((h, i) => (
              <li key={h} className="fo-lane is-free">
                <div className="fo-lane-h">
                  <span className="fo-hand">{h}</span>
                  <span className="fo-lane-t fl-wait">{connected ? "in the bay, free" : "waiting for GitHub"}</span>
                  <i className="fo-rail" data-fo-rail={`free${i}`} aria-hidden="true" />
                </div>
              </li>
            ))}
            {more.length > 0 && (
              <li className="fo-lane is-more" data-open={open === "more" || undefined}>
                <button type="button" className="fo-more" aria-expanded={open === "more"} onClick={() => setOpen((o) => (o === "more" ? null : "more"))}>
                  +{more.length} more in hand
                  <small>{[...new Set(more.map((l) => STAGE_WORDS[l.stage]))].join(", ")}</small>
                </button>
                {open === "more" && (
                  <ul className="fo-more-l">
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
                )}
              </li>
            )}
          </ol>
          <p className="fo-gate-k" data-tone={main}>
            main {main === "pass" ? "green" : main === "fail" ? "red" : main === "running" ? "running" : "no run yet"}
          </p>
        </div>

        <div className="fo-ship" data-fo="ship">
          <i className="fo-dot" aria-hidden="true" />
          <p className="fo-ship-n">
            <b className="fl-num">{connected ? today : "—"}</b>
            <span>shipped today{week > today ? ` · ${week} this week` : ""}</span>
          </p>
          <ul className="fo-ship-l">
            {data.changelog.slice(0, 3).map((c: Change) => (
              <li key={c.key}>
                <a href={c.landed?.url ?? c.issue?.url} target="_blank" rel="noreferrer">
                  {ideaTitle(c.title)}
                </a>
                <time>{now - c.at < 24 * HOUR ? clock(c.at) : `${formatWait(now - c.at)} ago`}</time>
              </li>
            ))}
          </ul>
          {data.changelog.length > 0 && (
            <button type="button" className="fo-link" onClick={onShips}>
              The changelog ↓
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** One job in flight: who has it, what it is, where it stands; open for its pull request, its stage and its history. */
function LaneRow({ lane, progress, now, open, lit, onOpen, onHot, stop }: { lane: Lane; progress?: Progress; now: number; open: boolean; lit: boolean; onOpen: () => void; onHot: (on: boolean) => void; stop: (c: Crate) => ReactNode }) {
  const c = lane.crate;
  const id = `fo-lane-${c.number}`;
  const step = stepOf(lane.stage);
  return (
    <li className="fo-lane" data-stage={lane.stage} data-open={open || undefined} data-lit={lit || undefined} onPointerEnter={() => onHot(true)} onPointerLeave={() => onHot(false)}>
      <button type="button" className="fo-lane-h" aria-expanded={open} aria-controls={id} onClick={onOpen} onFocus={() => onHot(true)} onBlur={() => onHot(false)}>
        <span className="fo-hand">{lane.hand}</span>
        <span className="fo-lane-t">
          <b>{ideaTitle(c.title)}</b>
          <small>
            #{c.number} · {modelOf(c, lane.who)} · {c.kind === "chat" ? "from chat" : c.kind} · {formatWait(now - c.updatedAt)}
          </small>
          {progress && <ProgressBar p={progress} />}
        </span>
        <span className={`fo-pill is-${PILL[lane.stage]}`}>{STAGE_WORDS[lane.stage]}</span>
        <i className="fo-rail" data-fo-rail={c.number} aria-hidden="true" />
      </button>
      {open && (
        <div className="fo-lane-x" id={id}>
          <div className="fo-lane-who">
            <img src={pic(lane.who)} alt="" />
            <p>
              {lane.hand === CREW[lane.who].name ? CREW[lane.who].name : `${lane.hand}, of Rusty's dock crew,`} {lane.stage === "stuck" ? "is stuck on it" : lane.stage === "ready" ? "needs your OK on a test before it ships" : "is building it"} on {modelOf(c, lane.who)}.{c.pitch ? ` ${c.pitch}` : ""}
            </p>
          </div>
          <ol className="fo-steps" aria-label="Stage">
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? "is-past" : i === Math.floor(step) ? "is-now" : undefined}>
                {s}
              </li>
            ))}
          </ol>
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
          <dl className="fo-hist">
            {c.createdAt && (
              <div>
                <dt>Opened</dt>
                <dd>{formatWait(now - c.createdAt)} ago</dd>
              </div>
            )}
            {lane.pr && (
              <div>
                <dt>Pull request</dt>
                <dd>
                  {formatWait(now - lane.pr.at)} ago{lane.pr.draft ? ", a draft" : ""}
                </dd>
              </div>
            )}
            <div>
              <dt>Last change</dt>
              <dd>{formatWait(now - c.updatedAt)} ago</dd>
            </div>
            {progress && (
              <div>
                <dt>Progress</dt>
                <dd>
                  {stepWords(progress)} ({progress.pct}%){leftWords(progress) ? `; ${leftWords(progress)}` : ""}
                  {progress.doing ? `. Now: ${progress.doing}` : ""} <span className="fo-prog-src">({sourceWords(progress)})</span>
                </dd>
              </div>
            )}
            {c.short && (
              <div>
                <dt>In short</dt>
                <dd>{c.short}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </li>
  );
}

/**
 * A job's progress under its title (#488): seven hairline segments in the forge's orange, one per milestone (assigned,
 * branch pushed, pull request open, checks running, checks green, merged, deployed), lit as far as it has really got,
 * then "57% · about 12 min left", the time measured from past jobs' steps.
 */
function ProgressBar({ p }: { p: Progress }) {
  return (
    <span className="fo-prog" title={`${stepWords(p)}${p.doing ? `: ${p.doing}` : ""}.`}>
      <span className="fo-prog-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} aria-valuetext={`${stepWords(p)}, ${p.pct}%`} aria-label="Progress">
        {MILESTONES.map((m, i) => (
          <i key={m} data-on={i < p.step || undefined} />
        ))}
      </span>
      <span className="fo-prog-t">{progressWords(p)}</span>
    </span>
  );
}

/** What needs Nikita, plainly: decisions first, then Rivet's questions and the ideas to pick; or that nothing does. */
function Held({ decisions, questions, toPick, connected, now, ideas, onIdea, onSuggest }: { decisions: Crate[]; questions: Crate[]; toPick: number; connected: boolean; now: number; ideas: Crate[]; onIdea: (n: number) => void; onSuggest: () => void }) {
  const n = decisions.length + questions.length + (toPick ? 1 : 0);
  const firstPick = ideas.find((c) => !c.revising && !(c.asking && c.question));
  return (
    <aside className="fl-panel fo-held" aria-label="Held for you">
      <p className="fl-k">
        <span>Held for you</span> · {connected ? (n ? `${words(n).toLowerCase()} ${n === 1 ? "thing" : "things"}` : "nothing") : "connecting"}
      </p>
      {!connected ? (
        <p className="fo-held-t fl-wait">Connecting to GitHub…</p>
      ) : !n ? (
        <>
          <h2 className="fl-h2">Nothing needs you.</h2>
          <p className="fo-held-p">The crew handles small fixes and upkeep on its own. The next queue check is {countdown(nextRuns(new Date(now)).queue, new Date(now))}.</p>
        </>
      ) : (
        <ul className="fo-held-l">
          {decisions.map((c) => (
            <li key={c.number} data-tone={c.state === "stuck" ? "bad" : "hot"}>
              <span className="fl-k">{c.state === "stuck" ? "Stuck" : "Ship it?"} · {formatWait(now - c.updatedAt)}</span>
              <b>{ideaTitle(c.title)}</b>
              <span className="fo-held-do">
                <a className="fl-btn is-pri" href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
                  {c.state === "stuck" ? "See why" : "Decide"}
                </a>
                <a className="fl-btn" href={c.url} target="_blank" rel="noreferrer">
                  #{c.number}
                </a>
              </span>
            </li>
          ))}
          {questions.map((c) => (
            <li key={c.number} data-tone="hot">
              <span className="fl-k">Rivet asks</span>
              <b>“{c.question}”</b>
              <span className="fo-held-do">
                <button type="button" className="fl-btn is-pri" onClick={() => onIdea(c.number)}>
                  Answer Rivet
                </button>
              </span>
            </li>
          ))}
          {toPick > 0 && (
            <li data-tone="hot">
              <span className="fl-k">The bench</span>
              <b>
                {words(toPick)} {toPick === 1 ? "idea waits" : "ideas wait"} for your pick
              </b>
              <span className="fo-held-do">
                <button type="button" className="fl-btn is-pri" onClick={() => firstPick && onIdea(firstPick.number)}>
                  See {toPick === 1 ? "it" : "them"}
                </button>
              </span>
            </li>
          )}
        </ul>
      )}
      <button type="button" className="fl-btn fo-sug" onClick={onSuggest}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
        Suggest an idea
      </button>
    </aside>
  );
}
