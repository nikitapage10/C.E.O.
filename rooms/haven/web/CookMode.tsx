import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Cook, CookLine, CookStep } from "./cook.ts";
import { findPhotos, photoUrl, stepShotsOf, type PhotoState } from "./mealPhotos.ts";
import "./cook.css";
import { useScreenContext } from "@ceo/engine/web/screen.ts";

/**
 * Cook mode (#705; phone-first since #1010): tonight's dinner full screen. Every step is on one scrolling list: the one
 * you're on opened up in big type with the ingredients and amounts it uses and its picture, the ones ahead readable
 * below it, the ones done dimmed above; tapping any step goes to it. The whole recipe's parts and amounts sit beside
 * the steps on a wide screen and in a sheet from the bottom on a phone, where each ingredient can be ticked off as
 * it's got out (kept while the page is open). Next, Back and Ingredients are big and at the thumb; the arrow keys and
 * a sideways swipe on the step move too, and Escape or Close leaves. The screen is kept awake with the browser's Wake
 * Lock while it's open; where the browser doesn't offer it or says no, it simply isn't. Built by `cookOf` (cook.ts)
 * from the night as customized; the step pictures come from the meal photo library (`stepShotsOf`), made when the
 * week was finalized (#1016), read once here and never holding anything up.
 */

const ROLE: Record<string, string> = { protein: "Protein", carb: "Carb", side: "Side" };
const PORTION: Record<number, string> = { 0.75: "¾", 1: "1", 1.25: "1¼", 1.5: "1½" };

/** What's ticked off, per meal and night, while the page is open: closing cook mode for a minute keeps it. */
const ticked = new Map<string, Set<number>>();

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

interface Pic {
  id: string;
  status: PhotoState;
}

/**
 * The steps' pictures (#1010): read from the library once when cook mode opens. They're made when the week is
 * finalized (#1016), never here: a step without one simply shows none. Null when the library isn't there.
 */
function useStepPics(cook: Cook): Map<number, Pic> | null {
  const [pics, setPics] = useState<Map<number, Pic> | null>(null);
  const shots = useMemo(() => stepShotsOf(cook), [cook]);
  // The shots as text: the same recipe as cooked reads once, however often the planner draws a new `cook`.
  const sig = JSON.stringify(shots.map((s) => [s.shot.meal, s.shot.description, s.shot.components]));
  const want = useRef(shots);
  want.current = shots;
  useEffect(() => {
    const asked = want.current;
    if (!asked.length) return;
    let gone = false;
    void findPhotos(asked.map((s) => s.shot)).then((got) => {
      if (gone || !got) return;
      const m = new Map<number, Pic>();
      asked.forEach((s, j) => {
        const t = got[j];
        if (t) m.set(s.step, { id: t.id, status: t.status });
      });
      setPics(m);
    });
    return () => {
      gone = true;
    };
  }, [sig]);
  return pics;
}

/** A step's picture, or a quiet stand-in while it's being made; nothing when there won't be one. */
function StepPic({ pic, n }: { pic: Pic | undefined; n: number }) {
  const [broken, setBroken] = useState(false);
  if (!pic || broken || pic.status === "failed" || pic.status === "budget") return null;
  const ready = pic.status === "ready";
  return (
    <figure className={`ck-pic${ready ? " is-ready" : ""}`}>
      {ready ? (
        <img src={photoUrl(pic.id)} alt="" decoding="async" onError={() => setBroken(true)} />
      ) : (
        <figcaption>
          <i aria-hidden="true">{n}</i>
          Picture on its way
        </figcaption>
      )}
    </figure>
  );
}

/** The step's words, the swapped part marked. */
function Words({ step }: { step: CookStep }) {
  return (
    <>
      {step.runs.map((r, k) =>
        r.swap ? (
          <mark key={k} title="Swapped in for tonight">
            {r.text}
          </mark>
        ) : (
          <span key={k}>{r.text}</span>
        ),
      )}
    </>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <i className={`ck-tick${on ? " is-on" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </i>
  );
}

export function CookMode({ cook, onClose }: { cook: Cook; onClose: () => void }) {
  const n = Math.max(1, cook.steps.length);
  const [at, setAt] = useState(0);
  const [side, setSide] = useState(false);
  const i = Math.min(at, n - 1);
  const last = i === n - 1;
  const awake = useWakeLock();
  const pics = useStepPics(cook);
  const box = useRef<HTMLDivElement>(null);
  const flow = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const tickKey = `${cook.meal}:${cook.day}:${cook.course}`;
  const [got, setGot] = useState<Set<number>>(() => new Set(ticked.get(tickKey)));
  const tick = (k: number) =>
    setGot((was) => {
      const now = new Set(was);
      if (now.has(k)) now.delete(k);
      else now.add(k);
      ticked.set(tickKey, now);
      return now;
    });

  const go = useCallback((to: number) => setAt(Math.max(0, Math.min(n - 1, to))), [n]);

  // What Nikita is looking at (#1027), so "add a pico here" or "this step" needs no explaining: the step he's on, its
  // ingredients and amounts, the steps ahead and the whole list. The recipe itself goes in the private part only.
  const stepText = (s: CookStep | undefined) => (s ? (s.skip ?? s.runs.map((r) => r.text).join("")) : "");
  const lineText = (l: CookLine | undefined) => (l ? `${l.item}${l.amount ? ` ${l.amount}` : ""}` : "");
  useScreenContext({
    room: "haven",
    tab: "Kitchen",
    item: `Cook mode, step ${i + 1} of ${n}`,
    stage: "cooking",
    fields: { day: cook.day, course: cook.course, step: i + 1, steps: n, portions: cook.portions },
    private: {
      meal: cook.name,
      stepText: stepText(cook.steps[i]),
      stepIngredients: (cook.steps[i]?.uses ?? []).map((k) => lineText(cook.lines[k])).filter(Boolean),
      comingSteps: cook.steps.slice(i + 1, i + 4).map((s, k) => `${i + k + 2}. ${stepText(s)}`.slice(0, 160)),
      ingredients: cook.lines.map(lineText),
      ...(cook.changes.length && { tonight: cook.changes.join(", ") }),
    },
  });

  // The step you're on comes to the top of the list, the end of the one before it just showing above.
  const first = useRef(true);
  useEffect(() => {
    const list = flow.current;
    const now = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !now) return;
    const smooth = !first.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    first.current = false;
    list.scrollTo({ top: Math.max(0, now.offsetTop - 28), behavior: smooth ? "smooth" : "auto" });
  }, [i]);

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
        const all = [...(box.current?.querySelectorAll<HTMLElement>("button:not([disabled]):not([tabindex='-1'])") ?? [])].filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
        if (!all.length) return;
        const start = all[0]!,
          end = all[all.length - 1]!;
        if (e.shiftKey && document.activeElement === start) end.focus();
        else if (!e.shiftKey && document.activeElement === end) start.focus();
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
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    next.current?.focus({ preventScroll: true });
    return () => {
      document.documentElement.style.overflow = overflow;
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
  const linesOf = (s: CookStep) => s.uses.map((u) => ({ u, l: cook.lines[u] })).filter((x): x is { u: number; l: CookLine } => !!x.l);
  const gotCount = cook.lines.filter((_, k) => got.has(k)).length;

  const now = (s: CookStep | undefined, k: number) => (
    <li key={k} className="ck-item is-now" aria-current="step">
      <section className="ck-stage" aria-live="polite" onPointerDown={down} onPointerUp={up} onPointerCancel={() => (from.current = null)}>
        <p className="ck-count">
          <b>{k + 1}</b>
          <span>of {n}</span>
        </p>
        {s?.skip ? <p className="ck-skip">{s.skip}: skip this one.</p> : null}
        <p className="ck-text">{s ? <Words step={s} /> : <span>No steps written for this one. The parts and amounts are all here.</span>}</p>
        {s && s.uses.length ? (
          <div className="ck-need">
            <p className="ck-needH">This step uses</p>
            <ul className="ck-uses" aria-label="This step uses">
              {linesOf(s).map(({ u, l }) => (
                <li key={u}>
                  <button type="button" className={got.has(u) ? "is-got" : ""} aria-pressed={got.has(u)} onClick={() => tick(u)}>
                    <Tick on={got.has(u)} />
                    <b>{l.amount || "to taste"}</b>
                    <span>{l.item}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <StepPic key={pics?.get(k)?.id ?? "none"} pic={pics?.get(k)} n={k + 1} />
      </section>
    </li>
  );

  const other = (s: CookStep, k: number) => {
    const pic = pics?.get(k);
    return (
      <li key={k} className={`ck-item ${k < i ? "is-done" : k === i + 1 ? "is-up" : "is-later"}`}>
        <button type="button" className="ck-jump" onClick={() => go(k)}>
          <span className="ck-num" aria-hidden="true">
            {k < i ? <Tick on /> : k + 1}
          </span>
          <span className="ck-say">
            {k === i + 1 ? <small className="ck-upH">Coming up</small> : null}
            <span className="ck-sayText">
              <span className="ck-hide">Step {k + 1}: </span>
              {s.skip ? `${s.skip}. ` : ""}
              {s.runs.map((r) => r.text).join("")}
            </span>
            {s.uses.length && k >= i ? (
              <span className="ck-sayUses">
                {linesOf(s).map(({ u, l }) => (
                  <span key={u}>
                    <b>{l.amount}</b> {l.item}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
          {pic?.status === "ready" && k > i ? <img className="ck-thumb" src={photoUrl(pic.id)} alt="" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.hidden = true)} /> : null}
        </button>
      </li>
    );
  };

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
            <button type="button" className="ck-close" aria-label="Close cook mode" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </header>

        <div className="ck-bar" aria-hidden="true">
          <i style={{ width: `${((i + 1) / n) * 100}%` }} />
        </div>

        <div className="ck-body">
          <div ref={flow} className="ck-flow">
            <ol className="ck-steps" aria-label="Steps">
              {cook.steps.length ? cook.steps.map((s, k) => (k === i ? now(s, k) : other(s, k))) : now(undefined, 0)}
            </ol>
          </div>

          <div className="ck-scrim" aria-hidden="true" onClick={() => setSide(false)} />
          <aside id="ck-side" className="ck-side" aria-label={cook.course === "lunch" ? "Lunch's parts and amounts" : "Tonight's parts and amounts"}>
            <span className="ck-grab" aria-hidden="true" />
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
            <div className="ck-linesHead">
              <h3>{amounts}</h3>
              <span className="ck-gotN">{gotCount ? `${gotCount}/${cook.lines.length} out` : "Tap to tick off"}</span>
            </div>
            <ul className="ck-lines">
              {cook.lines.map((l, k) => (
                <li key={k} className={l.pantry ? "is-pantry" : ""}>
                  <button type="button" className={got.has(k) ? "is-got" : ""} aria-pressed={got.has(k)} onClick={() => tick(k)}>
                    <Tick on={got.has(k)} />
                    <span className="ck-lineItem">
                      {l.item}
                      {l.pantry ? <small> pantry</small> : null}
                    </span>
                    <b>{l.amount}</b>
                  </button>
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
          <button type="button" className={`ck-btn is-side${side ? " is-on" : ""}`} aria-expanded={side} aria-controls="ck-side" aria-label={side ? "Back to the step" : "Ingredients"} onClick={() => setSide((v) => !v)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {side ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M9 6h10M9 12h10M9 18h10M4.5 6h.01M4.5 12h.01M4.5 18h.01" />}
            </svg>
            <small aria-hidden="true">{side ? "Step" : "Ingredients"}</small>
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
