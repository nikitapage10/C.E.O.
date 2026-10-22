import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadLattice } from "../../route.ts";
import { CouncilButton } from "../CouncilButton.tsx";
import { dailyOpening } from "../motion.tsx";
import { link } from "../nav.ts";
import { greeting, roomPhrase, skippyLine, type RoomPulse } from "../roomPulse.ts";
import { SkippyAsk, SkippyAvatar } from "../skippy/index.ts";
import { eOut, kick, reducedMotion, useViz } from "../wvCanvas.ts";
import { FAN, fanSpec, type FanItem, type FanState } from "./fan.ts";
import { Opening } from "./Opening.tsx";
import { roomLink } from "./roomLink.ts";

const Council = lazy(() => import("../Council.tsx").then((m) => ({ default: m.Council })));

/** The fan's order, as the approved Weave has it: the busiest rooms on top, the rooms not set up below. */
const FAN_ORDER = ["foundry", "boiler", "breakroom", "archive", "relay", "spire", "exchange", "green", "workshop"] as const;
const FAN_STATE: Record<RoomPulse["state"], FanState> = { busy: "busy", steady: "active", waiting: "wait", down: "down", sim: "off" };

/**
 * Today's first screen, as the approved Weave draws it (Nikita's picks, 2026-10-22): Skippy's line, the greeting in
 * the big serif, how many things need a human, the rooms with real work in a short line, and on the right the fan,
 * every room's thread running out of Skippy's knot to its name and a word on how it's doing. The first open of the day
 * plays the opening (Opening.tsx); later opens settle in half a second. Below it, the way into the Lattice, the
 * Council and the Ask Skippy line, quiet. `onPre` hides the page's cards until they rise in with the hero.
 */
export function TodayHero({ now, pulses, todo, onPre }: { now: number; pulses: RoomPulse[]; todo: number; onPre: (pre: boolean) => void }) {
  const [opening, setOpening] = useState(() => dailyOpening(now) === "first" && !reducedMotion());
  const [run, setRun] = useState(0);
  // The greeting: hidden while the opening runs, then written in letter by letter (start and step in ms).
  const [write, setWrite] = useState<{ start: number; step: number } | null>(() => (opening ? null : { start: 60, step: 14 }));
  const [glow, setGlow] = useState(false);
  const [council, setCouncil] = useState(false);
  const labels = useRef<HTMLUListElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);

  const byId = useMemo(() => new Map(pulses.map((p) => [p.id as string, p])), [pulses]);
  const fanned = FAN_ORDER.map((id) => byId.get(id)).filter((p): p is RoomPulse => !!p);
  const key = fanned.map((p) => `${p.id}${p.state}${p.activity.toFixed(2)}${p.short}`).join("|");
  // Rebuilt only when what it draws changes; the threads themselves are kept (fan.ts).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo<FanItem[]>(() => fanned.map((p) => ({ id: p.id, st: FAN_STATE[p.state], lvl: p.activity })), [key]);
  const spec = useMemo(() => fanSpec(items, labels), [items]);
  useViz(cv, spec);

  // Later opens: the fan grows in and the page rises, about half a second. Once an opening ends, nothing more to do.
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
  const closeCouncil = useCallback(() => setCouncil(false), []);

  const text = greeting(now);
  const status = pulses.filter((p) => p.real);
  const phrases = status.map((p) => ({ p, words: roomPhrase(p) }));
  if (phrases[0]) phrases[0].words = phrases[0].words.charAt(0).toUpperCase() + phrases[0].words.slice(1);
  const hover = (id: string | null) => {
    FAN.hot = id;
    kick();
  };

  return (
    <>
      <header className="wv-hero" aria-label="Today at a glance">
        <div className="wv-hero-txt">
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
            {text.split("").map((ch, i) => (
              <span key={`${run}-${i}`} className="wv-ch" aria-hidden="true" style={write ? ({ "--d": `${write.start + i * write.step}ms` } as React.CSSProperties) : undefined}>
                {ch}
              </span>
            ))}
          </h1>
          <p className="wv-say" data-in>
            {skippyLine(todo, pulses)}
          </p>
          <p className="wv-status" data-in>
            {phrases.map(({ p, words }) => (
              <span key={p.id} data-room={p.id} className={`is-${p.state}`}>
                <i className={`wv-dot${p.state === "waiting" ? " is-ring" : ""}`} />
                {words}
              </span>
            ))}
          </p>
        </div>
        <div className="wv-fan" data-in>
          <canvas ref={cv} className="wv-cv" aria-hidden="true" />
          <ul className="wv-fan-l" ref={labels} aria-label="Rooms reporting in">
            {fanned.map((p) => (
              <li key={p.id} data-room={p.id} className={p.real ? "" : "is-quiet"}>
                <a href={p.href} onClick={roomLink(p.href)} onPointerEnter={() => hover(p.id)} onPointerLeave={() => hover(null)} onFocus={() => hover(p.id)} onBlur={() => hover(null)} title={p.status}>
                  {p.name}
                  <span>{p.short}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <button className="wv-replay wv-link" type="button" onClick={replay}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8M2.6 2.4v2.9h2.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Replay the {partWord(now)} opening
        </button>
      </header>

      <div className="wv-hero-do" data-in>
        <a className="wv-door" href="/lattice" onClick={link("lattice")} onMouseEnter={() => void loadLattice()} onFocus={() => void loadLattice()}>
          <svg viewBox="0 0 28 20" aria-hidden="true">
            <path d="M1 10c4-7 8-7 13 0s9 7 13 0" />
            <path d="M1 10c4 7 8 7 13 0s9-7 13 0" />
          </svg>
          <span>
            <b>Enter the Lattice</b>
            <small>Walk the nine rooms</small>
          </span>
        </a>
        <CouncilButton pulses={pulses} onOpen={() => setCouncil(true)} />
        <SkippyAsk className="wv-ask" />
      </div>

      {opening && <Opening key={run} onLift={() => {}} onWrite={onWrite} onRise={onRise} onDone={onDone} />}
      {council && (
        <Suspense fallback={null}>
          <Council pulses={pulses} open onClose={closeCouncil} />
        </Suspense>
      )}
    </>
  );
}

const partWord = (now: number) => {
  const h = new Date(now).getHours();
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
};
