import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { dailyOpening } from "../motion.tsx";
import { greeting, skippyLine, type RoomPulse } from "../roomPulse.ts";
import { Ephemeris, IlyrReadout, useRuns } from "../TodayRail.tsx";
import { eOut, kick, reducedMotion } from "../wvCanvas.ts";
import { Astrolabe } from "./Astrolabe.tsx";
import { Opening } from "./Opening.tsx";
import { ORB } from "./orrery.ts";

/**
 * Today's bridge (#385, Nikita 2026-10-24 04:58Z: "The today page… still got designed too safe, be more unique"):
 * Today is the bridge of Skippy's ship over Ilyr. On the left, the helm: his greeting in the big serif, what needs
 * Nikita right now (`helm`), the ephemeris of what the crew does next, and the deck (`deck`: the channel to Skippy and
 * the day's broadcast). On the right, the astrolabe (Astrolabe.tsx), with Ilyr's hour read off its corner. On a phone
 * it all stacks in reading order: greeting, right now, the chart, what's next, the deck.
 * The first open of the day plays the opening (Opening.tsx), its particles gathering onto the strands; later opens
 * draw the strands out of the sun in about half a second. Real data only.
 */
export function TodayHero({ now, pulses, todo, since, onPre, hot, onHot, helm, deck }: { now: number; pulses: RoomPulse[]; todo: number; since: number; onPre: (pre: boolean) => void; hot: string | null; onHot: (id: string | null) => void; helm?: ReactNode; deck?: ReactNode }) {
  const [opening, setOpening] = useState(() => dailyOpening(now) === "first" && !reducedMotion());
  const [run, setRun] = useState(0);
  // The greeting: hidden while the opening runs, then written in letter by letter (start and step in ms).
  const [write, setWrite] = useState<{ start: number; step: number } | null>(() => (opening ? null : { start: 60, step: 14 }));
  const [glow, setGlow] = useState(false);
  const [hotRun, setHotRun] = useState<string | null>(null);
  const { now: rnow, runs } = useRuns();

  // Later opens: the strands grow out of the sun and the page rises, about half a second.
  const played = useRef(false);
  useEffect(() => {
    if (opening) {
      played.current = true;
      onPre(true);
      return;
    }
    if (played.current || reducedMotion()) {
      ORB.am = 1;
      onPre(false);
      return;
    }
    onPre(true);
    ORB.am = 0;
    const t0 = performance.now();
    let raf = requestAnimationFrame(function grow() {
      // A tab hidden mid-grow stops here; the chart shows in full when it comes back.
      if (document.visibilityState === "hidden") {
        ORB.am = 1;
        return;
      }
      const k = (performance.now() - t0) / 620;
      ORB.am = eOut(k);
      kick();
      if (k < 1) raf = requestAnimationFrame(grow);
    });
    const rise = requestAnimationFrame(() => requestAnimationFrame(() => onPre(false)));
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(rise);
      ORB.am = 1;
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

  return (
    <section className={`td-bridge${glow ? " is-glow" : ""}`} aria-label="The bridge">
      <header className="td-head" data-in>
        <p className="td-k td-sig">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3.2" />
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="10.6" strokeDasharray="1.5 2.6" />
            <circle cx="19" cy="12" r="1.3" className="is-pl" />
          </svg>
          <span>Skippy, the Magnificent</span> from the Kernel
        </p>
        <h1 className={`desk__title wv-greet td-greet${write ? "" : " is-writing"}`} aria-label={text}>
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
        <p className="td-say">{skippyLine(todo, pulses)}</p>
      </header>

      <div className="td-helm">{helm}</div>

      <div className="td-chart" data-in>
        <IlyrReadout now={rnow} />
        <Astrolabe pulses={pulses} now={now} since={since} hot={hot} onHot={onHot} runs={runs} rnow={rnow} hotRun={hotRun} onHotRun={setHotRun} />
        <button className="td-replay" type="button" onClick={replay}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.8M2.6 2.4v2.9h2.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Replay the {partWord(now)} opening
        </button>
      </div>

      <div className="td-ephw" data-in>
        <Ephemeris runs={runs} now={rnow} hotRun={hotRun} onHotRun={setHotRun} />
      </div>

      <div className="td-deck" data-in>
        {deck}
      </div>

      {opening && <Opening key={run} onLift={() => {}} onWrite={onWrite} onRise={onRise} onDone={onDone} />}
    </section>
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
