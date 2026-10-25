import type { ReactNode } from "react";
import { CREW, CREW_ORDER, CREW_RANK, DOCK_CREW, crewFor, crewOf, recentWork, sparesAwake, type Crate, type CrewId, type FoundryData } from "../../foundry.ts";
import type { WorldFeed } from "../../chronicle.ts";
import { formatUsd, foundryJobs, monthSpend, SPEND_CAP_USD, workByModel, type UsageFeed } from "../../usage.ts";
import { Private } from "../Private.tsx";
import { countdown, nextRuns, runTime } from "../crewRuns.ts";
import { FOUNDRY_THREAD } from "../deskData.ts";
import { ideaTitle, Mic, soon, useIdeaChoice, type Setup } from "../IdeaCard.tsx";
import { usePictureLinks } from "../ideaImages.ts";
import { ROOM_META, ROOM_ORDER } from "../roomPulse.ts";
import { DeskSignIn } from "../SignIn.tsx";
import { describeRun, useVisualQa } from "../visualqa/feed.ts";
import { isBuild } from "./forge.ts";

/**
 * The Foundry below its stage (#432), in the flow kit's type: the ideas on the bench as cards with their pictures
 * (Build, Not this one, Revise, Answer Rivet), the crew at their stations, the next runs, the month's spend and Visual
 * QA. Every number and name is real: GitHub, the issue trails, the world's ledger and the Visual QA feed; anything not
 * connected says so.
 */

const HOUR = 3_600_000;
const pic = (id: string) => `/desk/agent-${id}.webp`;
const NUM = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const words = (n: number) => NUM[n] ?? String(n);
const ago = (ms: number) => (ms < HOUR ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 24 * HOUR ? `${Math.round(ms / HOUR)} h` : `${Math.round(ms / (24 * HOUR))} d`);

/* ── The ideas on the bench ── */

/** Rooms of Ilyr an idea with no picture of its own shows (the Lattice's own renders). */
const IDEA_SCENES = ["lattice", "room-archive", "room-spire", "room-green", "room-workshop", "room-exchange"];

export function BenchCard({ crate, setup, now, i }: { crate: Crate; setup: Setup; now: number; i: number }) {
  const c = useIdeaChoice(crate, setup);
  const pictures = usePictureLinks(crate.images);
  const scene = IDEA_SCENES[Math.abs(crate.number) % IDEA_SCENES.length]!;
  const by = crate.builder ?? crewFor(crate);
  const age = crate.number > 0 && crate.createdAt ? `${ago(now - crate.createdAt)} ago` : "";
  return (
    <article className={`fo-card${c.mode === "done" ? " is-said" : ""}`} id={`fo-idea-${crate.number}`} data-asking={crate.asking || undefined} style={{ "--i": i } as React.CSSProperties}>
      <div className={`fo-card-img${pictures.length ? " is-own" : ""}`}>
        <img src={pictures[0] ?? `/desk/${scene}.webp`} alt={pictures.length ? "Your picture" : ""} loading="lazy" />
        {crate.size && <span className="fo-chip">{crate.size}</span>}
      </div>
      <div className="fo-card-b">
        <p className="fo-card-by">
          <img src={pic(crate.asking ? "semicolon" : by)} alt="" />
          {crate.asking ? "Rivet asks first" : `For ${CREW[by].name}`}
          {age ? `, ${age}` : ""}
          {crate.number > 0 && (
            <a className="fo-card-n" href={crate.url} target="_blank" rel="noreferrer">
              #{crate.number}
            </a>
          )}
        </p>
        <h3 className="fo-card-h">{ideaTitle(crate.title)}</h3>
        {crate.pitch && <p className="fo-card-p">{crate.pitch}</p>}
        {crate.asking && crate.question && <p className="fo-card-q">“{crate.question}”</p>}
        {pictures.length > 1 && (
          <ul className="fo-card-pics">
            {pictures.slice(1).map((u, n) => (
              <li key={u}>
                <a href={u} target="_blank" rel="noreferrer" title="Open the picture">
                  <img src={u} alt={`Picture ${n + 2}`} loading="lazy" />
                </a>
              </li>
            ))}
          </ul>
        )}
        <IdeaAnswers c={c} crate={crate} setup={setup} />
      </div>
    </article>
  );
}

/** Build, Not this one, Revise and (for a question) the answer box; the sign-in step when it's needed. */
function IdeaAnswers({ c, crate, setup }: { c: ReturnType<typeof useIdeaChoice>; crate: Crate; setup: Setup }) {
  if (crate.number < 0 && !crate.revising) return <p className="fo-note">Shaped. Saving it to GitHub…</p>;
  if (crate.revising) return <p className="fo-note">{`Waiting for Rivet: she picks up your notes ${soon()}.`}</p>;
  if (c.mode === "done") return <p className="fo-ok">{c.result}</p>;
  if (c.mode === "failed")
    return (
      <p className="fo-note">
        That didn't go through. Try again, or pick in the{" "}
        <a href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
          Foundry thread
        </a>
        .
      </p>
    );
  if (c.mode === "signin") return <DeskSignIn compact onDone={c.resume} onCancel={c.cancelSignIn} />;
  const busy = c.mode === "busy";
  return (
    <>
      <div className="fo-card-do" title={!c.ready ? (setup ? "Set the Key Vault secrets to pick from here" : "Checking…") : undefined}>
        <button className="fl-btn is-pri" type="button" disabled={!c.ready || busy} onClick={() => void c.go("build")}>
          {c.asking ? "Build as is" : "Build"}
        </button>
        {c.asking ? (
          <button className="fl-btn" type="button" disabled={!c.ready || busy} onClick={() => c.setMode(c.mode === "answer" ? "idle" : "answer")}>
            Answer Rivet
          </button>
        ) : (
          <button className="fl-btn" type="button" disabled={!c.ready || busy} onClick={() => c.setMode(c.mode === "revise" ? "idle" : "revise")}>
            Revise
          </button>
        )}
        <button className="fl-btn is-ghost" type="button" disabled={!c.ready || busy} onClick={() => void c.go("pass")}>
          Not this one
        </button>
      </div>
      {(c.mode === "answer" || c.mode === "revise") && (
        <form
          className="fo-reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (c.note.trim()) void c.go(c.mode === "answer" ? "answer" : "revise");
          }}
        >
          <input className="wv-input" type="text" value={c.note} onChange={(e) => c.setNote(e.target.value)} placeholder={c.dictation.listening ? "Listening…" : c.mode === "answer" ? "Your answer for Rivet" : "What should change?"} aria-label={c.mode === "answer" ? "Answer Rivet" : "Revise the idea"} autoFocus maxLength={2000} />
          {c.mode === "answer" && <Mic dictation={c.dictation} onToggle={c.toggleMic} label="Say your answer" />}
          <button type="submit" className="fl-btn is-pri" disabled={!c.note.trim()}>
            Send
          </button>
        </form>
      )}
      {c.held && (
        <p className="fo-note" role="alert">
          {c.held}
        </p>
      )}
    </>
  );
}

/* ── The crew ── */

/** The crew at their stations: who holds what, and what each shipped last. */
export function CrewStations({ data, now, children }: { data: FoundryData; now: number; children?: ReactNode }) {
  const runs = nextRuns(new Date(now));
  const awake = sparesAwake(data.crates);
  const held = (id: CrewId) => data.crates.filter((c) => isBuild(c) && c.state !== "shipped" && c.state !== "queued" && crewOf(c, data.crates) === id);
  return (
    <section className="fl-below fo-crew" aria-label="The crew">
      <p className="fl-eyb">
        <span>The crew</span>
        <i />
        at their stations
      </p>
      <ul className="fo-crew-l">
        {CREW_ORDER.map((id) => {
          const jobs = held(id);
          const last = recentWork(data.changelog, id, 1)[0];
          const line = jobs.length
            ? `${jobs[0]!.state === "working" ? "Building" : jobs[0]!.state === "ready" ? "A test needs you on" : "Stuck on"} “${ideaTitle(jobs[0]!.title)}”${jobs.length > 1 ? `, and ${words(jobs.length - 1).toLowerCase()} more` : ""}.`
            : last
              ? `Free. Last shipped “${last.name}”, ${ago(now - last.at)} ago.`
              : "Free, and nothing shipped yet.";
          return (
            <li key={id} data-live={jobs.some((c) => c.state === "working") || undefined}>
              <img src={pic(id)} alt="" />
              <div>
                <b>{CREW[id].name}</b>
                <em>
                  {CREW_RANK[id].models.replace("/", " or ")} · {CREW[id].job.toLowerCase()}
                </em>
                <p>
                  {line}
                  {id === "semicolon" ? ` Next upkeep at ${runTime(runs.upkeep)}.` : ""}
                </p>
              </div>
            </li>
          );
        })}
        <li className="fo-dock" data-live={awake > 0 || undefined}>
          <span className="fo-dock-m">
            {DOCK_CREW.map((d) => (
              // Rusty's salvage-compactor body in each one's own paint (scripts/portraits.mjs).
              <img key={d.name} src={pic(d.name.toLowerCase())} alt={d.name} title={d.name} style={{ borderColor: d.colour }} />
            ))}
          </span>
          <div>
            <b>Dusty, Gusty, Musty</b>
            <em>Rusty's dock crew · his extra hands</em>
            <p>{awake ? `${words(awake)} out on a job beside Rusty.` : "All three in their bays."} Next queue check {countdown(runs.queue, new Date(now))}.</p>
          </div>
        </li>
      </ul>
      {children}
    </section>
  );
}

/* ── On the clock ── */

export function RunsLine({ now }: { now: number }) {
  const at = new Date(now);
  const runs = nextRuns(at);
  const rows: { k: string; at: Date; every: number; what: string; who: string; about?: boolean; short?: boolean }[] = [
    { k: "queue", at: runs.queue, every: 15 * 60_000, what: "Queue check", who: "Dusty, every 15 min", short: true },
    { k: "upkeep", at: runs.upkeep, every: 5 * HOUR, what: "Upkeep", who: "Rivet, every 5 h", about: true },
    { k: "ideas", at: runs.ideas, every: 24 * HOUR, what: "Morning ideas", who: "Musty, daily at 9:00 MT" },
  ];
  return (
    <section className="fo-runs" aria-label="Next runs">
      <p className="fl-k">
        <span>Next runs</span> · on the clock
      </p>
      <ul>
        {rows.map((d) => {
          const left = d.at.getTime() - now;
          const f = Math.max(0.03, Math.min(1, 1 - left / d.every));
          return (
            <li key={d.k} title={`${d.what} ${countdown(d.at, at, d.about)}`}>
              <b className="fl-num">{d.short || left < HOUR ? countdown(d.at, at).replace(/^in /, "") : runTime(d.at)}</b>
              <span>{d.what}</span>
              <em>{d.who}</em>
              <i style={{ "--f": f.toFixed(3) } as React.CSSProperties} aria-hidden="true" />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── Usage ── */

export function UsageLine({ usage, world, now, children }: { usage: UsageFeed | null; world: WorldFeed | null; now: number; children?: ReactNode }) {
  const month = usage ? monthSpend(usage.trails, now) : null;
  const speech = (world?.story?.usd ?? 0) + (world?.story?.elevenUsd ?? 0);
  const speechCap = (world?.story?.budget ?? 0) + (world?.story?.elevenBudget ?? 0);
  const cap = SPEND_CAP_USD + speechCap;
  // Today in Ilyr's voice (#365): ElevenLabs first, Gemini's speech when it fails or passes its cap.
  const parts = [
    { k: "boiler", b: "The living Lattice", s: "Claude API, hourly", usd: world?.spend.usd ?? 0 },
    { k: "archive", b: "Today in Ilyr", s: "ElevenLabs, Gemini fallback", usd: speech },
    { k: "foundry", b: "Idea shaping", s: "Claude API, Rivet", usd: month?.usd ?? 0 },
    { k: "workshop", b: "Today's scripts", s: "Claude API, Skippy", usd: world?.story?.scriptUsd ?? 0 },
  ];
  const total = parts.reduce((a, p) => a + p.usd, 0);
  const known = Boolean(usage || world);
  const week = usage ? workByModel(foundryJobs(usage.issues, usage.trails), "week", now) : null;
  return (
    <section className="fo-usage" aria-label="Usage">
      <p className="fl-k">
        <span>Usage</span> · this month
      </p>
      <p className="fo-usage-h">
        {known ? (
          <>
            <b className="fl-num">
              <Private>{formatUsd(total)}</Private>
            </b>{" "}
            of {formatUsd(cap)} in caps
          </>
        ) : (
          <span className="fl-wait">Reading the ledgers…</span>
        )}
      </p>
      <ul className="fo-usage-l">
        {parts.map((p) => (
          <li key={p.k} data-room={p.k}>
            <i className="wv-dot" />
            <b>{p.b}</b>
            <span>{p.s}</span>
            <em className="fl-num">{known ? <Private>{formatUsd(p.usd)}</Private> : "…"}</em>
          </li>
        ))}
      </ul>
      <p className="fo-note">
        Foundry work runs on the Claude Code plan, so it costs no API money.{" "}
        {week ? `This week: ${week.Sonnet.jobs} on Sonnet, ${week.Opus.jobs} on Opus, ${week.Haiku.jobs} on Haiku.` : "Waiting for the issue trails from GitHub…"}
      </p>
      {children}
    </section>
  );
}

/* ── Visual QA ── */

export function VqaLine() {
  const { feed } = useVisualQa();
  const run = feed?.latest ?? null;
  const d = describeRun(run);
  const checked = run && run.run !== "fail" ? run.rooms : 0;
  return (
    <section className="fo-vqa" aria-label="Visual QA">
      <p className="fl-k">
        <span>Visual QA</span> · Gemini after each push
      </p>
      <p className="fo-note">
        {run ? `${d.line}. Last run ${new Date(run.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.` : "Gemini watches every room after each push to main. Waiting for the first run."}{" "}
        {run && (
          <a className="fo-link" href={run.url} target="_blank" rel="noreferrer">
            Open the run ↗
          </a>
        )}
      </p>
      <ul className="fo-vqa-l" aria-label={run ? `${checked} rooms checked` : "No run yet"}>
        {ROOM_ORDER.map((r, i) => (
          <li key={r} data-room={r} className={i < checked ? undefined : "is-off"}>
            <i />
            {ROOM_META[r].name}
          </li>
        ))}
      </ul>
    </section>
  );
}
