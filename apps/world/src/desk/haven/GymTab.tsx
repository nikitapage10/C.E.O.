import { useEffect, useMemo, useState } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import {
  GYM_NOTE,
  WEEKDAY_LONG,
  doseOf,
  WEEKDAY_SHORT,
  gymLine,
  loadGym,
  logGym,
  minutesOf,
  nextSession,
  resetGymPlan,
  saveGymPlan,
  scoreOf,
  unlogGym,
  weekOf,
  type GymExercise,
  type GymLoad,
  type GymLogEntry,
  type GymPlan,
  type GymSession,
  type GymView,
  type Weekday,
} from "./gym.ts";
import { demoUrl, frameUrl, refFor, useExerciseRefs, type ExerciseRef, type RefMatch } from "./gymRef.ts";
import "@fontsource-variable/geist-mono";
import "./gym.css";

/**
 * The Haven's Gym (#660): the weekly plan as the gym's own small app. Its form is the session laid out in time: each
 * exercise a row, each set a block where it falls in the session's twenty minutes, the rests the gaps between, so the
 * plan reads as the session will feel. Above it the week (which days carry a session, which are done); below it the
 * log button and the last eight weeks. Adjust turns the doses into steppers. Passkey only; the plan never shows signed
 * out (the house-wide strip has the counts).
 */

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayOf = (iso: string) => WEEKDAY_SHORT[new Date(iso).getDay()];

function Stepper({ label, value, unit, step, min, max, onChange }: { label: string; value: number; unit?: string; step: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <span className="gy-step" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
        −
      </button>
      <output>
        {value}
        {unit && <small>{unit}</small>}
      </output>
      <button type="button" aria-label={`More: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
        +
      </button>
    </span>
  );
}

function Score({ session, rest, editing, onEdit }: { session: GymSession; rest: [number, number]; editing: boolean; onEdit: (i: number, e: GymExercise) => void }) {
  const score = useMemo(() => scoreOf(session, rest), [session, rest]);
  const total = Math.max(60, score.total);
  const pct = (s: number) => `${(s / total) * 100}%`;
  const ticks: number[] = [];
  for (let m = 0; m * 60 <= total; m += total > 1500 ? 10 : 5) ticks.push(m);
  return (
    <div className="gy-score" key={session.id}>
      <div className="gy-axis" aria-hidden="true">
        <span className="gy-axisK">min</span>
        <div className="gy-axisT">
          {ticks.map((m) => (
            <i key={m} style={{ left: pct(m * 60) }}>
              {m}
            </i>
          ))}
          <b style={{ left: "100%" }}>{minutesOf(score.total)}</b>
        </div>
      </div>
      <ol className="gy-rows" aria-label={`${session.name}, in order`}>
        {score.rows.map((row, i) => {
          const e = row.exercise;
          return (
            <li className="gy-row" key={`${e.name}-${i}`} style={{ ["--i" as string]: i }}>
              <div className="gy-ex">
                <span className="gy-n">{String(i + 1).padStart(2, "0")}</span>
                <b>
                  <Private>{e.name}</Private>
                </b>
                {editing ? (
                  <span className="gy-steps">
                    <Stepper label={`${e.name} sets`} value={e.sets} unit="sets" step={1} min={1} max={10} onChange={(sets) => onEdit(i, { ...e, sets })} />
                    {e.reps !== null ? (
                      <Stepper label={`${e.name} reps`} value={e.reps} unit={e.perSide ? "reps/side" : "reps"} step={1} min={1} max={100} onChange={(reps) => onEdit(i, { ...e, reps })} />
                    ) : (
                      <Stepper label={`${e.name} seconds`} value={e.seconds ?? 30} unit={e.perSide ? "s/side" : "s"} step={5} min={5} max={600} onChange={(seconds) => onEdit(i, { ...e, seconds })} />
                    )}
                  </span>
                ) : (
                  <span className="gy-dose">{row.dose}</span>
                )}
              </div>
              <div className="gy-track" aria-hidden="true">
                {ticks.map((m) => (
                  <u key={m} style={{ left: pct(m * 60) }} />
                ))}
                <s style={{ left: pct(row.from), width: pct(row.to - row.from) }} />
                {row.sets.map((set, k) => (
                  <i key={k} className={e.reps === null ? "is-hold" : undefined} style={{ left: pct(set.at), width: pct(set.len), ["--k" as string]: k }} />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="gy-legend">
        <span>
          <i aria-hidden="true" /> a set
        </span>
        <span>
          <i className="is-hold" aria-hidden="true" /> a hold
        </span>
        <span>
          <s aria-hidden="true" /> rest {rest[0]}–{rest[1]} s
        </span>
        <span className="gy-legendNote">About {minutesOf(score.total)} laid out at {score.rest} s rests and an even tempo: an estimate, not a timer.</span>
      </p>
    </div>
  );
}

/** An exercise's two frames, crossfading in a loop like a flip book (still on the first in reduced motion). */
function Frames({ ex: r, big }: { ex: ExerciseRef; big?: boolean }) {
  return (
    <span className={`gy-frames${big ? " is-big" : ""}`} data-two={r.frames > 1 ? "" : undefined}>
      {Array.from({ length: Math.max(1, r.frames) }, (_, k) => (
        <img key={k} src={frameUrl(r.id, k)} alt="" loading="lazy" decoding="async" />
      ))}
    </span>
  );
}

/** The open exercise, in full: its frames, the steps, the muscles it works, its kit and a demo to watch. */
function Detail({ e, m }: { e: GymExercise; m: RefMatch | null }) {
  return (
    <section className="gy-detail" aria-label={`${e.name}: how to`}>
      {m ? <Frames ex={m.ref} big /> : <span className="gy-frames is-big is-none" aria-hidden="true" />}
      <div className="gy-detailTxt">
        <p className="gy-k">{doseOf(e)}</p>
        <h4>{e.name}</h4>
        {m && !m.exact ? <p className="gy-detailNote">Closest in the reference: {m.ref.name}</p> : null}
        {m ? (
          <>
            <ul className="gy-muscles" aria-label="Muscles worked">
              {m.ref.primary.map((x) => (
                <li key={x} className="is-main">
                  {x}
                </li>
              ))}
              {m.ref.secondary.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="gy-detailMeta">
              <span>
                <span className="gy-k">Equipment</span> {m.ref.equipment === "body only" ? "none (body weight)" : m.ref.equipment}
              </span>
              <span>
                <span className="gy-k">Level</span> {m.ref.level}
              </span>
            </p>
            <ol className="gy-steps">
              {m.ref.instructions.map((t, k) => (
                <li key={k}>{t}</li>
              ))}
            </ol>
          </>
        ) : (
          <p className="gy-detailNote">No reference card for this one yet: the demo below shows the form.</p>
        )}
        <a className="gy-demo" href={demoUrl(e.name)} target="_blank" rel="noopener noreferrer">
          Watch a demo <span aria-hidden="true">↗</span>
        </a>
        <p className="gy-credit">Pictures and steps: free-exercise-db, public domain.</p>
      </div>
    </section>
  );
}

/**
 * The session's exercises as cards (#718): since #729 each shows its two photographed frames from the exercise
 * reference (gymRef.ts), looping, with its dose and a ring that fills set by set. Tap one for the steps, the muscles,
 * the equipment and a demo.
 */
function Cards({ session, refs }: { session: GymSession; refs: ExerciseRef[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = open !== null ? session.exercises[open] : undefined;
  return (
    <>
      <ol className="gy-cards" aria-label={`${session.name}: the exercises`}>
        {session.exercises.map((e, i) => {
          const m = refFor(e.name, refs);
          return (
            <li key={`${e.name}-${i}`} className="gy-card" style={{ ["--i" as string]: i }}>
              <button type="button" className="gy-cardBtn" aria-expanded={open === i} aria-label={`${e.name}, ${doseOf(e)}: how to`} onClick={() => setOpen((v) => (v === i ? null : i))}>
                <span className={`gy-art${m ? " is-ready" : ""}`}>
                  {m ? <Frames ex={m.ref} /> : <span className="gy-artN">{String(i + 1).padStart(2, "0")}</span>}
                  <span className="gy-artSets" aria-hidden="true">
                    {Array.from({ length: e.sets }, (_, k) => (
                      <i key={k} style={{ animationDelay: `${0.4 + i * 0.12 + k * 0.18}s` }} />
                    ))}
                  </span>
                </span>
                <span className="gy-cardT">
                  <b>{e.name}</b>
                  <span>{doseOf(e)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {shown ? <Detail e={shown} m={refFor(shown.name, refs)} key={open} /> : null}
    </>
  );
}

function History({ weeks, per }: { weeks: number[]; per: number }) {
  return (
    <figure className="gy-hist">
      <figcaption>Last {weeks.length} weeks</figcaption>
      <ol>
        {weeks.map((n, i) => {
          const label = i === weeks.length - 1 ? "this week" : `${weeks.length - 1 - i} wk ago`;
          return (
            <li key={i} aria-label={`${label}: ${n} of ${per}`} className={i === weeks.length - 1 ? "is-now" : undefined}>
              <span className="gy-pips">
                {Array.from({ length: Math.max(per, n) }, (_, k) => (
                  <i key={k} className={k < n ? (k >= per ? "is-extra" : "is-on") : undefined} />
                ))}
              </span>
              <small>{i === weeks.length - 1 ? "now" : `−${weeks.length - 1 - i}`}</small>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

export function GymTab({ onCounts }: { onCounts?: (gym: { perWeek: number; doneThisWeek: number }) => void } = {}) {
  const [load, setLoad] = useState<GymLoad>({ state: "idle" });
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [just, setJust] = useState<GymLogEntry | null>(null);
  const [draft, setDraft] = useState<GymPlan | null>(null);
  const refs = useExerciseRefs();

  useEffect(() => {
    let gone = false;
    void loadGym().then((l) => {
      if (gone) return;
      if (l.state === "out") useDeskAuth.getState().lost();
      else setLoad(l);
    });
    return () => void (gone = true);
  }, []);

  if (load.state !== "ready")
    return (
      <>
        <p className="hv-say">{load.state === "idle" ? "Reading the Gym's plan…" : load.state === "off" ? "The Gym's plan isn't served on this copy of the Desk." : "The Gym's plan didn't load. It'll try again when you come back."}</p>
        <div className="gy gy-empty" aria-busy={load.state === "idle"}>
          <p className="hv-wait">
            <i aria-hidden="true" />
            {load.state === "idle" ? "Reading…" : "Waiting for the private store."}
          </p>
        </div>
      </>
    );

  const view: GymView = load.view;
  const plan = draft ?? view.plan;
  const today = new Date().getDay();
  const done = view.week.done;
  const doneIds = new Set(done.map((e) => e.session));
  const session = plan.sessions.find((s) => s.id === pick) ?? nextSession(plan, done, today);
  const loggedThis = [...done].reverse().find((e) => e.session === session.id) ?? null;
  const per = plan.sessions.length;

  const apply = (got: Awaited<ReturnType<typeof logGym>>) => {
    if (got.ok) {
      setLoad({ state: "ready", view: got.view });
      onCounts?.({ perWeek: got.view.plan.sessions.length, doneThisWeek: got.view.week.done.length });
      setNote(null);
      return true;
    }
    if (got.error === "signed-out") useDeskAuth.getState().lost();
    setNote(GYM_NOTE[got.error] ?? GYM_NOTE.failed!);
    return false;
  };
  const log = async () => {
    setBusy(true);
    const got = await logGym(session.id);
    setBusy(false);
    if (apply(got) && got.ok) setJust(got.entry ?? null);
  };
  const undo = async (id: string) => {
    setBusy(true);
    const got = await unlogGym(id);
    setBusy(false);
    if (apply(got)) setJust(null);
  };
  const editExercise = (i: number, e: GymExercise) =>
    setDraft((d) => {
      const base = d ?? view.plan;
      return { ...base, sessions: base.sessions.map((s) => (s.id === session.id ? { ...s, exercises: s.exercises.map((x, k) => (k === i ? e : x)) } : s)) };
    });
  const editDay = (day: Weekday) => setDraft((d) => {
    const base = d ?? view.plan;
    return { ...base, sessions: base.sessions.map((s) => (s.id === session.id ? { ...s, day } : s)) };
  });
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const got = await saveGymPlan(draft);
    setBusy(false);
    if (apply(got)) setDraft(null);
  };
  const reset = async () => {
    setBusy(true);
    const got = await resetGymPlan();
    setBusy(false);
    if (apply(got)) setDraft(null);
  };

  return (
    <>
      <p className="hv-say">{gymLine(plan, done, today)}</p>
      <div className={`gy${draft ? " is-editing" : ""}`}>
        <header className="gy-top">
          <div>
            <h3 className="gy-name">{plan.name}</h3>
            <p className="gy-meta">
              <b>{per}</b> {per === 1 ? "session" : "sessions"} a week · rest <b>{plan.rest[0]}–{plan.rest[1]}</b> s between sets
            </p>
          </div>
          {draft ? (
            <div className="gy-acts">
              <button type="button" className="gy-btn" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="button" className="gy-btn is-pri" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save the plan"}
              </button>
            </div>
          ) : (
            <button type="button" className="gy-btn" onClick={() => setDraft(view.plan)}>
              Adjust
            </button>
          )}
        </header>

        <ol className="gy-week" aria-label="This week">
          {weekOf(plan).map(({ wd, session: s }) => {
            const isDone = s ? doneIds.has(s.id) : false;
            const cls = ["gy-day", wd === today && "is-today", s && "is-plan", isDone && "is-done", s?.id === session.id && "is-on"].filter(Boolean).join(" ");
            return (
              <li key={wd} className={cls}>
                <span className="gy-dayK">{WEEKDAY_SHORT[wd]}</span>
                {s ? (
                  <button type="button" aria-pressed={s.id === session.id} aria-label={`${s.name}, ${WEEKDAY_LONG[wd]}${isDone ? ", done" : ""}`} onClick={() => setPick(s.id)}>
                    {s.id.toUpperCase()}
                  </button>
                ) : (
                  <i aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>

        <div className="gy-sess">
          <div className="gy-letter" aria-hidden="true">
            {session.id.toUpperCase()}
          </div>
          <div className="gy-sessT">
            <h4>{session.name}</h4>
            <p>
              {draft ? (
                <label className="gy-dayPick">
                  on{" "}
                  <select value={session.day} onChange={(e) => editDay(Number(e.target.value) as Weekday)}>
                    {WEEKDAY_LONG.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>{WEEKDAY_LONG[session.day]}s</>
              )}{" "}
              · about {session.minutes} min · {session.exercises.length} exercises
            </p>
          </div>
          {!draft && (
            <div className="gy-log">
              {loggedThis ? (
                <p className="gy-done" role="status">
                  <span className="gy-check" aria-hidden="true" />
                  Done {dayOf(loggedThis.at)} {clock(loggedThis.at)}
                  {loggedThis.via === "phone" ? " · from the phone" : ""}
                  {just?.id === loggedThis.id && (
                    <button type="button" className="gy-link" disabled={busy} onClick={() => void undo(loggedThis.id)}>
                      Undo
                    </button>
                  )}
                </p>
              ) : (
                <button type="button" className="gy-btn is-log" disabled={busy} onClick={() => void log()}>
                  {busy ? "Logging…" : `Log day ${session.id.toUpperCase()}`}
                </button>
              )}
            </div>
          )}
        </div>

        {!draft && <Cards session={session} refs={refs} key={session.id} />}

        <Score session={session} rest={plan.rest} editing={draft !== null} onEdit={editExercise} />

        {note && (
          <p className="hv-note is-warn" role="status">
            {note}
          </p>
        )}

        <footer className="gy-foot">
          <div className="gy-notes">
            {plan.progress && (
              <p>
                <span className="gy-k">Progress</span> {plan.progress}
              </p>
            )}
            <p>
              <span className="gy-k">Phone</span> Say "Skippy, did core day {session.id.toUpperCase()}" or "log core workout" to log it.
            </p>
            {draft && !view.isDefault && (
              <button type="button" className="gy-link" disabled={busy} onClick={() => void reset()}>
                Back to the default plan
              </button>
            )}
          </div>
          <History weeks={view.weeks} per={per} />
        </footer>
      </div>
    </>
  );
}
