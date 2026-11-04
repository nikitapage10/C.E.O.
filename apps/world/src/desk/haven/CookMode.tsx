import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Cook } from "./cook.ts";
import "./cook.css";

/**
 * Cook mode (#705): tonight's dinner full screen, one step at a time in big type, the parts and amounts beside it (a
 * panel on a phone). Next and Back are big enough for a messy hand; the arrow keys, a swipe or the step marks move
 * too, and Escape or Close leaves. The screen is kept awake with the browser's Wake Lock while it's open; where the
 * browser doesn't offer it or says no, it simply isn't, and nothing else changes. Built by `cookOf` (cook.ts) from the
 * night as customized; nothing new is read or stored.
 */

const ROLE: Record<string, string> = { protein: "Protein", carb: "Carb", side: "Side" };
const PORTION: Record<number, string> = { 0.75: "¾", 1: "1", 1.25: "1¼", 1.5: "1½" };

/** The screen wake lock while mounted; true while it's held. Quiet where the browser lacks it or refuses. */
function useWakeLock(): boolean {
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const ask = async () => {
      if (gone || !("wakeLock" in navigator) || document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const got = await navigator.wakeLock.request("screen");
        if (gone) {
          void got.release().catch(() => undefined);
          return;
        }
        lock = got;
        setAwake(true);
        got.addEventListener("release", () => setAwake(false));
      } catch {
        setAwake(false);
      }
    };
    void ask();
    // The browser lets go of the lock when the tab is hidden; take it again when the cook comes back.
    const back = () => void ask();
    document.addEventListener("visibilitychange", back);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", back);
      if (lock && !lock.released) void lock.release().catch(() => undefined);
    };
  }, []);
  return awake;
}

export function CookMode({ cook, onClose }: { cook: Cook; onClose: () => void }) {
  const n = Math.max(1, cook.steps.length);
  const [at, setAt] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [side, setSide] = useState(false);
  const i = Math.min(at, n - 1);
  const step = cook.steps[i];
  const last = i === n - 1;
  const awake = useWakeLock();
  const box = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);

  const go = useCallback(
    (to: number) => {
      const k = Math.max(0, Math.min(n - 1, to));
      setDir(k >= i ? 1 : -1);
      setAt(k);
    },
    [i, n],
  );

  // Keys: Escape leaves (this view only, not the Kitchen under it), arrows and Page keys move, Home and End jump.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      if (k === "Escape") {
        if (side) setSide(false);
        else onClose();
      } else if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown") go(i + 1);
      else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") go(i - 1);
      else if (k === "Home") go(0);
      else if (k === "End") go(n - 1);
      else if (k === "Tab") {
        // Keep focus inside while it's open.
        const all = [...(box.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])].filter((el) => el.offsetParent !== null);
        if (!all.length) return;
        const first = all[0]!,
          end = all[all.length - 1]!;
        if (e.shiftKey && document.activeElement === first) end.focus();
        else if (!e.shiftKey && document.activeElement === end) first.focus();
        else return;
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [go, i, n, onClose, side]);

  // Focus starts on Next and goes back to whatever opened it; the page under it doesn't scroll.
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    const flow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    next.current?.focus({ preventScroll: true });
    return () => {
      document.documentElement.style.overflow = flow;
      was?.focus?.({ preventScroll: true });
    };
  }, []);

  // A sideways swipe on the step: left for the next, right for the one before. Touch and pen only.
  const from = useRef<{ x: number; y: number; id: number } | null>(null);
  const down = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse") from.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const up = (e: ReactPointerEvent) => {
    const s = from.current;
    from.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x,
      dy = e.clientY - s.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? i + 1 : i - 1);
  };

  const amounts = cook.portions === 1 ? "Amounts for one" : `Amounts for ${cook.portions}`;
  return createPortal(
    <div data-room="haven" className="ck-portal">
      <div ref={box} className={`ck${side ? " is-side" : ""}`} role="dialog" aria-modal="true" aria-label={`Cook mode: ${cook.name}`}>
        <header className="ck-head">
          <div className="ck-title">
            <p className="ck-eyb">
              {cook.course === "lunch" ? `${cook.dayName}'s lunch` : cook.dayName} · {cook.cuisine}
              <span className="ck-min"> · {cook.minutes} min</span>
            </p>
            <h2>{cook.name}</h2>
          </div>
          <div className="ck-tools">
            {awake ? (
              <span className="ck-awake" title="The screen stays on while cook mode is open">
                <i aria-hidden="true" />
                Screen stays on
              </span>
            ) : null}
            <button type="button" className="ck-ghost ck-sideBtn" aria-expanded={side} aria-controls="ck-side" onClick={() => setSide((v) => !v)}>
              {side ? "Back to the step" : "Ingredients"}
            </button>
            <button type="button" className="ck-close" aria-label="Close cook mode" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        <nav className="ck-marks" aria-label="Steps">
          {Array.from({ length: n }, (_, k) => (
            <button key={k} type="button" className={k < i ? "is-done" : k === i ? "is-now" : ""} aria-label={`Step ${k + 1}`} aria-current={k === i ? "step" : undefined} onClick={() => go(k)} />
          ))}
        </nav>

        <div className="ck-body">
          <section className="ck-stage" aria-live="polite" onPointerDown={down} onPointerUp={up} onPointerCancel={() => (from.current = null)}>
            <div key={i} className={`ck-step ${dir > 0 ? "is-fwd" : "is-back"}`}>
              <p className="ck-count">
                <b>{i + 1}</b>
                <span>of {n}</span>
              </p>
              {step?.skip ? <p className="ck-skip">{step.skip}: skip this one.</p> : null}
              <p className="ck-text">
                {step ? (
                  step.runs.map((r, k) =>
                    r.swap ? (
                      <mark key={k} title="Swapped in for tonight">
                        {r.text}
                      </mark>
                    ) : (
                      <span key={k}>{r.text}</span>
                    ),
                  )
                ) : (
                  <span>No steps written for this one. The parts and amounts are all here.</span>
                )}
              </p>
            </div>
          </section>

          <aside id="ck-side" className="ck-side" aria-label={cook.course === "lunch" ? "Lunch's parts and amounts" : "Tonight's parts and amounts"}>
            <h3>{cook.course === "lunch" ? "Lunch" : "Tonight"}</h3>
            <ul className="ck-parts">
              {cook.parts.map((p, k) => (
                <li key={k}>
                  <span className="ck-k">{ROLE[p.role] ?? p.role}</span>
                  <b>{p.name}</b>
                  {p.was ? <small>for {p.was}</small> : null}
                </li>
              ))}
              <li>
                <span className="ck-k">Cooking</span>
                <b>{cook.portions === 1 ? "1 portion" : `${cook.portions} portions`}</b>
                {cook.portion !== 1 || cook.why.length ? <small>{[cook.portion !== 1 ? `each ${PORTION[cook.portion] ?? cook.portion} size` : "", ...cook.why].filter(Boolean).join(" · ")}</small> : null}
              </li>
              <li>
                <span className="ck-k">Heat</span>
                <b className={`is-${cook.spice}`}>{cook.spice}</b>
                {cook.spiceWas ? <small>written {cook.spiceWas}</small> : null}
              </li>
            </ul>
            <h3>{amounts}</h3>
            <ul className="ck-lines">
              {cook.lines.map((l, k) => (
                <li key={k} className={l.pantry ? "is-pantry" : ""}>
                  <span>
                    {l.item}
                    {l.pantry ? <small> pantry</small> : null}
                  </span>
                  <b>{l.amount}</b>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <footer className="ck-foot">
          <button type="button" className="ck-btn is-back" disabled={i === 0} onClick={() => go(i - 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Back
          </button>
          <button ref={next} type="button" className="ck-btn is-next" onClick={() => (last ? onClose() : go(i + 1))}>
            {last ? "Done" : "Next step"}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {last ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M9 5l7 7-7 7" />}
            </svg>
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
