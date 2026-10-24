import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dailyOpening } from "../motion.tsx";
import { greeting, skippyLine, type PulseState, type RoomPulse } from "../roomPulse.ts";
import { SKIPPY_PORTRAIT, SkippyAvatar } from "../skippy/index.ts";
import { eOut, kick, reducedMotion, useViz } from "../wvCanvas.ts";
import { FAN, fanSpec, type FanItem, type FanState } from "./fan.ts";
import { Opening } from "./Opening.tsx";
import { roomLink } from "./roomLink.ts";

/** The strands' order: the rooms with real work on top, the rooms not set up below. */
const FAN_ORDER = ["foundry", "boiler", "breakroom", "archive", "relay", "spire", "exchange", "green", "workshop", "studio"] as const;
const FAN_STATE: Record<RoomPulse["state"], FanState> = { busy: "busy", steady: "active", waiting: "wait", down: "down", sim: "off" };
/** How busy a room is, in one word, beside its name. */
const STATE_WORD: Record<PulseState, string> = { busy: "Busy", steady: "Steady", waiting: "Waiting", down: "Needs a look", sim: "Not set up" };
/** The busy meter's five ticks. */
const TICKS = [0, 1, 2, 3, 4];

/**
 * Today's one picture (#336, Nikita 2026-10-23: "way too much like a dashboard page… I like the little dots flowing…
 * showing how busy one of the rooms are and what are they doing currently"). Skippy's line and the greeting in the
 * big serif, then the rooms' strands: every room's thread runs out of Skippy's knot to its submind, who sits on its end
 * with the room's name, how busy it is and what it is doing right now. Hovering or focusing a strand brings its
 * submind's report up under the picture and lights its report in the Council below (#363, `hot`); a click walks into the room. `under` and `aside` sit beside the greeting: Right now and the rail. The first
 * open of the day plays the opening (Opening.tsx); later opens grow in, in half a second. Real data only (roomPulse.ts).
 */
export function TodayHero({ now, pulses, todo, since, onPre, hot, onHot, under, aside }: { now: number; pulses: RoomPulse[]; todo: number; since: number; onPre: (pre: boolean) => void; hot: string | null; onHot: (id: string | null) => void; under?: ReactNode; aside?: ReactNode }) {
  const [opening, setOpening] = useState(() => dailyOpening(now) === "first" && !reducedMotion());
  const [run, setRun] = useState(0);
  // The greeting: hidden while the opening runs, then written in letter by letter (start and step in ms).
  const [write, setWrite] = useState<{ start: number; step: number } | null>(() => (opening ? null : { start: 60, step: 14 }));
  const [glow, setGlow] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);

  const byId = useMemo(() => new Map(pulses.map((p) => [p.id as string, p])), [pulses]);
  const fanned = FAN_ORDER.map((id) => byId.get(id)).filter((p): p is RoomPulse => !!p);
  const span = Math.max(1, now - since);
  const at = (t: number) => 0.14 + 0.82 * Math.min(1, Math.max(0, (t - since) / span));
  const key = fanned.map((p) => `${p.id}${p.state}${p.activity.toFixed(2)}${p.events.map((t) => at(t).toFixed(3)).join(",")}`).join("|");
  // Rebuilt only when what it draws changes; the strands themselves are kept (fan.ts).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo<FanItem[]>(() => fanned.map((p) => ({ id: p.id, st: FAN_STATE[p.state], lvl: p.activity, ev: p.events.filter((t) => t >= since && t <= now).map(at) })), [key]);
  const spec = useMemo(() => fanSpec(items), [items]);
  useViz(cv, spec);

  // Later opens: the strands grow in and the page rises, about half a second. Once an opening ends, nothing more to do.
  const played = useRef(false);
  useEffect(() => {
    if (opening) {
      played.current = true;
      onPre(true);
      return;
    }
    if (played.current || reducedMotion()) {
      FAN.am = 1;
      onPre(false);
      return;
    }
    onPre(true);
    FAN.am = 0;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function grow() {
      // A tab hidden mid-grow stops here; the strands show in full when it comes back.
      if (document.visibilityState === "hidden") {
        FAN.am = 1;
        return;
      }
      const k = (performance.now() - t0) / 520;
      FAN.am = eOut(k);
      kick();
      if (k < 1) raf = requestAnimationFrame(grow);
    });
    const rise = requestAnimationFrame(() => requestAnimationFrame(() => onPre(false)));
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(rise);
      FAN.am = 1;
    };
    // Runs once per open; the replay sets `opening` again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening]);

  const replay = () => {
    if (reducedMotion()) return;
    setWrite(null);
    setOpening(true);
    setRun((r) => r + 1);
    document.querySelector(".desk")?.scrollTo({ top: 0 });
  };
  const onWrite = useCallback((skipped: boolean) => {
    setWrite(skipped ? { start: 0, step: 0 } : { start: 0, step: 42 });
    window.setTimeout(() => {
      setGlow(true);
      window.setTimeout(() => setGlow(false), 650);
    }, 420);
  }, []);
  const onRise = useCallback(() => onPre(false), [onPre]);
  const onDone = useCallback(() => setOpening(false), []);

  const text = greeting(now);
  // The lit strand follows `hot`, from a strand here or a report in the Council below (#363).
  useEffect(() => {
    FAN.hot = hot;
    // A re-layout redraws even a still (reduced-motion) canvas; with motion the loop just carries on.
    if (reducedMotion()) FAN.V?.relayout();
    else kick();
  }, [hot]);
  useEffect(
    () => () => {
      FAN.hot = null;
    },
    [],
  );
  const hover = onHot;
  const lit = hot ? byId.get(hot) : null;
  const real = pulses.filter((p) => p.real).length;

  return (
    <>
      <div className="td-top">
      <div className="td-main">
      <header className="wv-hero wv-hero--one" aria-label="Today at a glance">
        <div className={`wv-skip${glow ? " is-glow" : ""}`} data-in>
          {/* Skippy, the Magnificent (#224): a click opens his chat (mounted once at the Desk's root, Desk.tsx). */}
          <span className="wv-skip-pf">
            <SkippyAvatar size="sm" className="wv-skip-can" />
          </span>
          <p>
            <b>Skippy, the Magnificent</b>
            <span>From the Kernel, keeping an eye on everything</span>
          </p>
        </div>
        <h1 className={`desk__title wv-greet${write ? "" : " is-writing"}`} aria-label={text}>
          {words(text).map((w) => (
            // Each word holds together, so a narrow screen breaks between words and never inside a name.
            <span key={`${run}-${w.at}`} className="wv-wd" aria-hidden="true">
              {w.text.split("").map((ch, k) => (
                <span key={k} className="wv-ch" style={write ? ({ "--d": `${write.start + (w.at + k) * write.step}ms` } as React.CSSProperties) : undefined}>
                  {ch}
                </span>
              ))}
            </span>
          ))}
        </h1>
        <p className="wv-say" data-in>
          {skippyLine(todo, pulses)}
        </p>
      </header>
      {under}
      </div>
      {aside}
      </div>

      <section className="wv-loom" id="td-rooms" data-in aria-label="The rooms right now">
        <div className="td-sechead">
          <p className="wv-eyb">The rooms, live</p>
          <h2 className="td-h2">Every strand runs from Skippy to a room</h2>
        </div>
        <div className="wv-loom-pic">
          <canvas ref={cv} className="wv-cv" aria-hidden="true" />
          <span className="wv-loom-knot" aria-hidden="true">
            <img src={SKIPPY_PORTRAIT} alt="" width={44} height={44} decoding="async" />
          </span>
          <ol className="wv-loom-l">
            {fanned.map((p) => {
              const lvl = p.real && p.state !== "waiting" ? Math.max(1, Math.round(p.activity * 5)) : 0;
              const doing = p.doing ?? p.status;
              return (
                <li key={p.id} data-room={p.id} className={`is-${p.state}${hot && hot !== p.id ? " is-dim" : ""}${hot === p.id ? " is-hot" : ""}`}>
                  <a
                    href={p.href}
                    onClick={roomLink(p.href)}
                    onPointerEnter={() => hover(p.id)}
                    onPointerLeave={() => hover(null)}
                    onFocus={() => hover(p.id)}
                    onBlur={() => hover(null)}
                    aria-label={`${p.name}, ${STATE_WORD[p.state].toLowerCase()}: ${doing}. ${p.submind.title} reports: ${p.report}`}
                  >
                    <span className="wv-loom-pf">
                      <img src={`/desk/agent-${p.submind.id}.webp`} alt="" width={36} height={36} decoding="async" />
                    </span>
                    <span className="wv-loom-t">
                      <span className="wv-loom-n">
                        <b>{p.name}</b>
                        <em>{STATE_WORD[p.state]}</em>
                      </span>
                      <span className="wv-loom-d">{doing}</span>
                    </span>
                    <span className="wv-loom-m" aria-hidden="true">
                      {TICKS.map((k) => (
                        <i key={k} className={k < lvl ? "is-on" : undefined} />
                      ))}
                    </span>
                  </a>
                </li>
              );
            })}
          </ol>
        </div>
        <div className="wv-loom-foot">
          <p key={lit?.id ?? "all"} className="wv-loom-cap" aria-hidden="true" data-room={lit?.id}>
            {lit ? (
              <>
                <b>{lit.submind.title}</b>
                <span>{lit.report}</span>
              </>
            ) : (
              <>
                <b>How to read it</b>
                <span>
                  {real} of {pulses.length} rooms run real work. The more dots, the busier the room; the knots are today's moments, from the morning at Skippy's end to now at the room's. Point at a strand to hear its submind; tap to walk in.
                </span>
              </>
            )}
          </p>
          <button className="wv-replay wv-link" type="button" onClick={replay}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8M2.6 2.4v2.9h2.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Replay the {partWord(now)} opening
          </button>
        </div>
      </section>

      {opening && <Opening key={run} onLift={() => {}} onWrite={onWrite} onRise={onRise} onDone={onDone} />}
    </>
  );
}

const partWord = (now: number) => {
  const h = new Date(now).getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
};

/** The greeting's words with where each starts, spaces kept on the word before so the letters keep their timing. */
function words(text: string) {
  const out: { text: string; at: number }[] = [];
  const re = /\S+\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push({ text: m[0], at: m.index });
  return out;
}
