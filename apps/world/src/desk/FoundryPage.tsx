import { useEffect, useRef, useState } from "react";
import { MAX_IMAGES, isImage, uploadImage } from "./ideaImages.ts";
import { assignCrew, ideaCounts, openIdeas, CREW, CREW_ORDER, CREW_RANK, DOCK_CREW, crewFor, crewOf, crewWork, expectChange, MODEL, modelOf, nextUpkeep, pendingIdea, recentWork, REPO, rustyHands, sparesAwake, useFoundry, waitingTurn, type Change, type Crate, type CrateKind, type CrateState, type CrewId } from "../foundry.ts";
import { LINK_STATE_LABEL, useSystems, type LinkState } from "../systems.ts";
import { DESK_ROOMS, FOUNDRY_THREAD, formatWait } from "./deskData.ts";
import { useDictation } from "./dictate.ts";
import { CLAUDE_USAGE_URL, codeTokensByModel, formatSpan, formatTokens, formatUsd, foundryJobs, MODELS, monthSpend, PERIODS, SPEND_CAP_USD, useUsage, windowSpend, workByModel, type Period } from "../usage.ts";
import { Avatar, PageHead, Panel } from "./ui.tsx";
import { remarksByIssue, useWorldFeed, type ChronicleStatus, type Remark, type WorldFeed } from "../chronicle.ts";
import { link } from "./nav.ts";
import { PORTRAITS } from "./portraits.ts";

/**
 * The Foundry's own Desk page. Top to bottom: what needs you (the morning's ideas as cards you can build, pass on or
 * send back with notes, plus anything waiting for your OK), how things stand right now (a strip of icons: checks, work
 * running, upkeep, the next ideas), the crew with every job each holds and the queue after them, and whether every
 * connection is up. GitHub is read directly (see foundry.ts);
 * the idea buttons write through the Vercel function in api/foundry.ts.
 */

const KIND_LABEL: Record<CrateKind, string> = { fix: "Fix", build: "Build", upkeep: "Upkeep", idea: "Idea", chat: "From chat" };
const CRATE_STATE: Record<CrateState, string> = { queued: "Queued", working: "Working", ready: "Waiting for your OK", stuck: "Stuck", shipped: "Shipped" };
const CREW_STATE: Record<CrateState, LinkState> = { queued: "ok", working: "ok", ready: "slow", stuck: "down", shipped: "ok" };
/** Each crew member's models and how many jobs they run at once (Nikita, 2026-10-13; docs/FOUNDRY.md, "The crew"). */
const CREW_RUNG: Record<CrewId, string> = {
  semicolon: "Haiku · the emergency slot, never waits",
  caret: "Opus, up to high effort for big design · one job at a time",
  tessellate: "Sonnet, or Opus at medium · four jobs at once with the dock crew",
};
/** The colour each of Rusty's hands wears on the Desk: the dock crew in their paint. */
const DOCK_COLOUR = new Map<string, string>(DOCK_CREW.map((d) => [d.name, d.colour]));
const CHECKS_LABEL: Record<LinkState, string> = { off: "No run yet", ok: "Green", slow: "Running", down: "Red" };
const HOUR = 3_600_000;
/** Each model in the colour its bench light shows in the Foundry room. */
const MODEL_COLOUR = Object.fromEntries(Object.values(MODEL).map((m) => [m.name, m.colour])) as Record<"Haiku" | "Sonnet" | "Opus", string>;

/** The morning ideas come at 9:00 Mountain time. */
export function nextIdeas(now: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  let wait = (9 * 60 - (h * 60 + m)) * 60_000;
  if (wait <= 0) wait += 24 * HOUR;
  return now + wait - (now % 60_000);
}

/** "Idea: make it faster" → "Make it faster". */
export function ideaTitle(title: string): string {
  const t = title.replace(/^Idea:\s*/i, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const inTime = (ms: number) => (ms < HOUR ? `in ${Math.max(1, Math.round(ms / 60_000))} min` : `in ${Math.round(ms / HOUR)} h`);

/* ── The idea buttons ── */

type Setup = { buttons: boolean; direct: boolean; shape: boolean; images: boolean } | null;
type Choice = "build" | "pass" | "revise" | "propose" | "answer";
const KEY = "ceo.deskKey";

function storedKey(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}
function storeKey(key: string) {
  try {
    localStorage.setItem(KEY, key);
  } catch {
    // Private window: the key lasts for this visit only.
  }
}

export function useSetup(): Setup {
  const [setup, setSetup] = useState<Setup>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/foundry")
      .then((r) => (r.ok ? (r.json() as Promise<{ buttons: boolean; direct?: boolean; shape?: boolean; images?: boolean }>) : null))
      .then((s) => live && setSetup(s ? { buttons: s.buttons, direct: s.direct ?? false, shape: s.shape ?? false, images: s.images ?? false } : { buttons: false, direct: false, shape: false, images: false }))
      .catch(() => live && setSetup({ buttons: false, direct: false, shape: false, images: false }));
    return () => {
      live = false;
    };
  }, []);
  return setup;
}

/** The Foundry thread's watcher sees Desk clicks within a minute (scripts/foundry-watch.sh); the queue checks every
 *  15 minutes (:06, :21, :36, :51) back it up when the watcher isn't running. */
const CHECK_MINUTES = [6, 21, 36, 51];
export function nextCheck(now: number): number {
  const d = new Date(now);
  for (const m of CHECK_MINUTES) {
    d.setUTCMinutes(m, 0, 0);
    if (d.getTime() > now) return d.getTime();
  }
  d.setUTCMinutes(CHECK_MINUTES[0]!, 0, 0);
  return d.getTime() + HOUR;
}

/** "within a minute or two (by 9:06 pm at the latest)": when the crew will have picked a click up. */
function soon(): string {
  return `within a minute or two (by ${new Date(nextCheck(Date.now())).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} at the latest)`;
}

/** Rivet's background shaping takes a second or two; past this, an idea still marked for rewriting waits for the check. */
const SHAPING_MS = 45_000;

type Sent = "ok" | "shaping" | "wrong-key" | "failed";

/** One click to the Foundry function: how it went, and the issue it made (for a proposed idea). */
async function post(issue: number | null, choice: Choice, key: string, note = ""): Promise<{ r: Sent; made: number | null }> {
  try {
    const res = await fetch("/api/foundry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issue, choice, key, note }) });
    if (res.status === 401) return { r: "wrong-key", made: null };
    if (!res.ok) return { r: "failed", made: null };
    const body = (await res.json().catch(() => ({}))) as { shaping?: boolean; issue?: number };
    return { r: body.shaping ? "shaping" : "ok", made: typeof body.issue === "number" ? body.issue : null };
  } catch {
    return { r: "failed", made: null };
  }
}

type Shaped = Pick<Crate, "title" | "pitch" | "size" | "short" | "builder"> & { question?: string };

/**
 * A new idea: the function streams back Rivet's shaping (straight from Claude) and the GitHub issue as each is ready,
 * so the card rewrites itself in about a second, whatever GitHub's pace.
 */
async function propose(key: string, note: string, images: string[], onShape: (shape: Shaped) => void, onIssue: (issue: number) => void): Promise<Sent> {
  try {
    const res = await fetch("/api/foundry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: "propose", key, note, images }) });
    if (res.status === 401) return "wrong-key";
    if (!res.ok || !res.body) return "failed";
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let result: Sent = "ok";
    let filed = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += value;
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop()!;
      for (const raw of lines) {
        if (!raw.trim()) continue;
        const msg = JSON.parse(raw) as { shaping?: boolean; shape?: { title: string; pitch: string; size: Crate["size"]; short?: string; builder: "Rusty" | "Rocky"; question?: string }; issue?: number; error?: string };
        if (msg.shaping) result = "shaping";
        if (msg.shape) onShape({ title: msg.shape.title, pitch: msg.shape.pitch, size: msg.shape.size, short: msg.shape.short ?? "", builder: msg.shape.builder === "Rusty" ? "tessellate" : "caret", ...(msg.shape.question && { question: msg.shape.question }) });
        if (typeof msg.issue === "number") {
          filed = true;
          onIssue(msg.issue);
        }
        if (msg.error) return "failed";
      }
      if (done) break;
    }
    return filed ? result : "failed";
  } catch {
    return "failed";
  }
}

async function send(issue: number | null, choice: Choice, key: string, note = ""): Promise<Sent> {
  return (await post(issue, choice, key, note)).r;
}

/* ── The page ── */

export function FoundryPage({ now }: { now: number }) {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const pending = useFoundry((s) => s.pending);
  const setup = useSetup();
  // The cards keep the thread's numbering (Build 1, 2, 3), so they go by issue number, not by last change; a card
  // just sent from the Desk goes last until GitHub numbers it.
  const ideas = openIdeas(data.crates, pending);
  const decisions = data.crates.filter((c) => c.kind !== "idea" && (c.state === "ready" || c.state === "stuck"));
  const running = data.crates.filter((c) => c.kind !== "idea" && c.state === "working");
  const upkeep = data.crates.find((c) => c.kind === "upkeep");
  // Everything in flight: what the crew holds plus the queue nobody holds yet. Chat work is in here too.
  const inFlight = assignCrew(data.crates).size + upNext(data.crates).length;
  const { questions, toPick } = ideaCounts(ideas);
  const needs = decisions.length + (toPick ? 1 : 0) + (questions.length ? 1 : 0);

  const parts: string[] = [];
  if (questions.length) parts.push(questions.length === 1 ? "Rivet has a question" : `Rivet has ${questions.length} questions`);
  if (toPick) parts.push(`${toPick} ${toPick === 1 ? "idea is" : "ideas are"} waiting for your pick`);
  if (decisions.length) parts.push(`${decisions.length} ${decisions.length === 1 ? "thing needs" : "things need"} your OK`);
  const lead = !connected ? "Connecting to GitHub…" : parts.length ? `${parts.join(", and ")}.` : "Nothing needs you. The crew handles small fixes and upkeep on its own.";
  // The living Lattice: the builders' remarks for the Changelog, and the world's spend for the Usage panel.
  const world = useWorldFeed();

  return (
    <div className="foundry-page" style={{ "--tone": DESK_ROOMS.foundry.accent } as React.CSSProperties}>
      <PageHead
        eyebrow="The coding crew"
        title="Foundry"
        room="foundry"
        lead={lead}
        aside={
          <div className="page-head__crew">
            {CREW_ORDER.map((id) => (
              <Avatar key={id} agent={id} room="foundry" />
            ))}
            <a className="btn btn--go" href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
              Open the Foundry thread →
            </a>
          </div>
        }
      />

      <section className="fy-needs" aria-label="Needs you">
        <header className="section-head">
          <h2>Needs you</h2>
          <span className="badge">{needs}</span>
        </header>
        {setup !== null && !setup.buttons && <SetupNote />}
        {decisions.length > 0 && (
          <ul className="fy-decisions">
            {decisions.map((c) => (
              <li key={c.number} className={`fy-decision fy-decision--${c.state}`}>
                <Avatar agent={crewOf(c, data.crates)} room="foundry" />
                <span className="fy-decision__kind">{KIND_LABEL[c.kind]}</span>
                <a href={c.url} target="_blank" rel="noreferrer" className="fy-decision__title">
                  {c.title}
                </a>
                <span className="fy-decision__what">{c.state === "stuck" ? "Stuck after every rung. Have a look." : "Done and checked. Ship it?"}</span>
                <a className="btn btn--go btn--sm" href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
                  {c.state === "stuck" ? "See why" : "Decide"}
                </a>
              </li>
            ))}
          </ul>
        )}
        {ideas.length > 0 ? (
          <div className="fy-ideas">
            {ideas.map((c, i) => (
              <IdeaCard key={c.number} crate={c} index={i + 1} setup={setup} />
            ))}
          </div>
        ) : (
          !decisions.length && connected && <p className="quiet fy-calm">All clear. The next three ideas arrive {inTime(nextIdeas(now) - now)}, at 9:00.</p>
        )}
        <Propose setup={setup} />
        {data.shelved > 0 && (
          <p className="quiet fy-shelf">
            {data.shelved} {data.shelved === 1 ? "idea" : "ideas"} on the shelf: passed for now, and Rusty may bring one back in a new shape.
          </p>
        )}
      </section>

      <StatusStrip now={now} running={running} upkeep={upkeep} />

      <Panel eyebrow="The crew" className="fy-crewpanel" aside={<span className="badge">{inFlight}</span>} label="The crew and what is in flight">
        <Crew now={now} />
      </Panel>

      <Panel eyebrow="Usage" className="fy-usage" aside={<a className="panel__hint" href={CLAUDE_USAGE_URL} target="_blank" rel="noreferrer">Claude plan limits →</a>} label="Usage: API spend and work by model">
        <Usage now={now} setup={setup} world={world} />
      </Panel>

      <Panel eyebrow="Connections" className="fy-connections">
        <Connections setup={setup} />
      </Panel>

      <Panel eyebrow="Changelog" aside={<span className="badge">{data.changelog.length}</span>}>
        {data.changelog.length ? <Changelog changes={data.changelog} now={now} remarks={remarksByIssue(world.feed?.remarks ?? [])} /> :<p className="quiet">{connected ? "Nothing shipped yet." : "Connecting to GitHub…"}</p>}
        <p className="quiet changelog__all">
          Every commit on main, one-offs included, is on{" "}
          <a href={`https://github.com/${REPO}/commits/main`} target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>
      </Panel>
    </div>
  );
}

/** An idea card with its buttons; the Foundry tab lists them all and Today shows the ones Rivet is asking about. */
export function IdeaCard({ crate, index, setup, focus = true }: { crate: Crate; index: number; setup: Setup; focus?: boolean }) {
  const [mode, setMode] = useState<"idle" | "key" | "revise" | "busy" | "done" | "failed">("idle");
  const [pending, setPending] = useState<Choice | null>(null);
  const [key, setKey] = useState(storedKey);
  const [note, setNote] = useState("");
  const [result, setResult] = useState("");
  const ready = setup?.buttons ?? false;
  const asking = Boolean(crate.asking && crate.question);
  // What was typed before the mic started; dictation appends to it, as in the Suggest box.
  const typed = useRef("");
  const dictation = useDictation((finished, tail) => setNote(`${typed.current}${typed.current && (finished || tail) ? " " : ""}${finished}${finished && tail ? " " : ""}${tail}`));
  const toggleMic = () => {
    if (dictation.listening) dictation.stop();
    else {
      typed.current = note.trim();
      dictation.start();
    }
  };
  // Once Rivet's rewrite (after an answer or notes) lands, the card is new: back to its buttons, or to the next question.
  const shown = `${crate.title}|${crate.pitch}|${crate.question ?? ""}`;
  const was = useRef(shown);
  useEffect(() => {
    if (was.current === shown) return;
    was.current = shown;
    if (mode === "done") {
      setMode("idle");
      setNote("");
      setResult("");
    }
  }, [shown, mode]);

  const go = async (choice: Choice, withKey = key) => {
    if (!withKey) {
      setPending(choice);
      setMode("key");
      return;
    }
    dictation.stop();
    setMode("busy");
    const r = await send(crate.number, choice, withKey, note);
    if (r === "wrong-key") {
      setPending(choice);
      setMode("key");
      setResult("That key didn't match. Try again.");
      return;
    }
    if (r === "failed") {
      setMode("failed");
      return;
    }
    storeKey(withKey);
    setResult(
      choice === "build" ? `Approved${asking ? " as is" : ""}. The crew picks it up ${soon()}.`
      : choice === "pass" ? "On the shelf. Rusty may bring it back another way."
      : choice === "answer" ? (r === "shaping" ? "Sent. Rivet is reading your answer now." : `Sent. Rivet reads your answer ${soon()}.`)
      : r === "shaping" ? "Rivet is rewriting it with your notes now."
      : `Sent. Rivet rewrites it ${soon()}.`,
    );
    // Rivet's rewrite lands a moment later; the quick polls pick it up.
    setMode("done");
    expectChange();
  };

  return (
    <article className={`fy-idea${crate.revising ? " fy-idea--revising" : ""}`}>
      <header className="fy-idea__head">
        <Avatar agent="Rivet" size="sm" room="foundry" />
        <span className="fy-idea__n">Idea {index}</span>
        {crate.size && <span className="fy-idea__size">{crate.size}</span>}
        {crate.number > 0 && (
          <a className="fy-idea__link" href={crate.url} target="_blank" rel="noreferrer">
            #{crate.number}
          </a>
        )}
      </header>
      <h3 className="fy-idea__title">{ideaTitle(crate.title)}</h3>
      {crate.pitch && <p className="fy-idea__pitch">{crate.pitch}</p>}
      {asking && (
        <div className="fy-idea__ask" role="note">
          <b>Rivet asks first</b>
          <p>{crate.question}</p>
        </div>
      )}
      {crate.images && crate.images.length > 0 && (
        <ul className="fy-idea__pics">
          {crate.images.map((u, n) => (
            <li key={u}>
              <a href={u} target="_blank" rel="noreferrer" title="Open the picture">
                <img src={u} alt={`Picture ${n + 1}`} loading="lazy" />
              </a>
            </li>
          ))}
        </ul>
      )}
      <footer className="fy-idea__foot">
        {crate.number < 0 && !crate.revising ? (
          <p className="fy-idea__note">Shaped. Saving it to GitHub…</p>
        ) : crate.revising ? (
          <p className="fy-idea__note">{setup?.shape && Date.now() - crate.updatedAt < SHAPING_MS ? "Rivet is shaping this now…" : `Waiting for Rivet: she picks up your notes ${soon()}.`}</p>
        ) : mode === "done" ? (
          <p className="fy-idea__note">{result}</p>
        ) : mode === "failed" ? (
          <p className="fy-idea__note">
            That didn't go through. Try again, or pick in the{" "}
            <a href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
              Foundry thread
            </a>
            .
          </p>
        ) : !ready ? (
          <div className="fy-idea__actions" title={setup ? "Set the Vercel variables to pick from here" : "Checking…"}>
            <button type="button" className="btn btn--go btn--sm" disabled>
              {asking ? "Build as is" : "Build this"}
            </button>
            <button type="button" className="btn btn--sm" disabled>
              {asking ? "Answer" : "Revise"}
            </button>
            <button type="button" className="btn btn--quiet btn--sm" disabled>
              Not this one
            </button>
          </div>
        ) : mode === "key" ? (
          <form
            className="fy-idea__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (pending) void go(pending, key.trim());
            }}
          >
            <label>
              {result || "Your Desk key (asked once on this device)"}
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoFocus autoComplete="current-password" />
            </label>
            <button type="submit" className="btn btn--go btn--sm" disabled={!key.trim()}>
              Go
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </form>
        ) : mode === "revise" ? (
          <form
            className="fy-idea__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) void go("revise");
            }}
          >
            <label>
              What should change, or what should Rivet know?
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus maxLength={2000} />
            </label>
            <button type="submit" className="btn btn--go btn--sm" disabled={!note.trim()}>
              Send notes
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </form>
        ) : asking && (mode === "idle" || mode === "busy") ? (
          <form
            className="fy-idea__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) void go("answer");
            }}
          >
            <label>
              {dictation.listening ? "Listening… say your answer, then press the mic again." : "Your answer, said or typed. Rivet shapes the card again with it."}
              <span className="fy-propose__box">
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus={focus} maxLength={2000} placeholder="Answer Rivet's question" />
                <Mic dictation={dictation} onToggle={toggleMic} label="Say your answer" />
              </span>
            </label>
            {dictation.error && <p className="fy-idea__note">{dictation.error}</p>}
            <button type="submit" className="btn btn--go btn--sm" disabled={!note.trim() || mode === "busy"}>
              Send answer
            </button>
            <button type="button" className="btn btn--sm" disabled={mode === "busy"} onClick={() => void go("build")} title="Skip the question and send the idea to the build queue as it is">
              Build as is
            </button>
            <button type="button" className="btn btn--quiet btn--sm" disabled={mode === "busy"} onClick={() => void go("pass")}>
              Not this one
            </button>
          </form>
        ) : (
          <div className="fy-idea__actions">
            <button type="button" className="btn btn--go btn--sm" disabled={mode === "busy"} onClick={() => void go("build")}>
              Build this
            </button>
            <button type="button" className="btn btn--sm" disabled={mode === "busy"} onClick={() => setMode("revise")}>
              Revise
            </button>
            <button type="button" className="btn btn--quiet btn--sm" disabled={mode === "busy"} onClick={() => void go("pass")}>
              Not this one
            </button>
          </div>
        )}
      </footer>
    </article>
  );
}

/** Shown until the Vercel function can reach the Foundry: what unlocks the buttons, in one place. */
function SetupNote() {
  return (
    <aside className="fy-setup" aria-label="One-time setup">
      <strong>One-time setup, then everything happens here.</strong>
      <p>
        The buttons go through Vercel, which needs two values (Project → Settings → Environment Variables, then redeploy): <code>FOUNDRY_DESK_KEY</code>, a passphrase you invent and type once per device, and{" "}
        <code>FOUNDRY_GITHUB_TOKEN</code>, a GitHub token for this repo with Issues read and write. A click then changes GitHub at once.
      </p>
    </aside>
  );
}

/** The mic in a text box: press to dictate, press again to stop. Nothing when the browser has no speech recognition. */
function Mic({ dictation, onToggle, label }: { dictation: ReturnType<typeof useDictation>; onToggle: () => void; label: string }) {
  if (!dictation.supported) return null;
  return (
    <button type="button" className={`fy-mic${dictation.listening ? " fy-mic--live" : ""}`} onClick={onToggle} aria-pressed={dictation.listening} aria-label={dictation.listening ? "Stop listening" : label} title={dictation.listening ? "Stop listening" : label}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
        <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** Nikita's own idea: say it or type it, and Rivet shapes it into a card like the morning ones. */
type Pic = { id: string; file: File; preview: string; status: "wait" | "up" | "done" | "failed"; url?: string };

function Propose({ setup }: { setup: Setup }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [key, setKey] = useState(storedKey);
  const [state, setState] = useState<"idle" | "busy" | "done" | "shaping" | "failed" | "wrong-key">("idle");
  // What was typed before the mic started; dictation appends to it.
  const typed = useRef("");
  const dictation = useDictation((finished, tail) => setNote(`${typed.current}${typed.current && (finished || tail) ? " " : ""}${finished}${finished && tail ? " " : ""}${tail}`));
  const ready = setup?.buttons ?? false;
  const canPic = ready && (setup?.images ?? false);
  const [pics, setPics] = useState<Pic[]>([]);
  const [picNote, setPicNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const pickFiles = useRef<HTMLInputElement>(null);
  const uploading = pics.some((p) => p.status === "up");
  const known = key.trim() || storedKey();
  const upload = async (pic: Pic, withKey: string) => {
    setPics((l) => l.map((p) => (p.id === pic.id ? { ...p, status: "up" } : p)));
    const url = await uploadImage(pic.file, withKey);
    setPics((l) => l.map((p) => (p.id === pic.id ? { ...p, status: url ? "done" : "failed", url: url ?? undefined } : p)));
    return url;
  };
  const addFiles = (files: File[]) => {
    const found = files.filter(isImage);
    if (!canPic || !found.length) return;
    const room = Math.max(0, MAX_IMAGES - pics.length);
    setPicNote(found.length > room ? `Up to ${MAX_IMAGES} pictures on an idea.` : "");
    const fresh: Pic[] = found.slice(0, room).map((file) => ({ id: Math.random().toString(36).slice(2), file, preview: URL.createObjectURL(file), status: known ? "up" : "wait" }));
    if (!fresh.length) return;
    setPics((l) => [...l, ...fresh]);
    if (known) for (const p of fresh) void upload(p, known).then((u) => !u && setPicNote("That picture didn't upload. Try again."));
  };
  const dropPic = (id: string) => {
    setPicNote("");
    setPics((l) => {
      const gone = l.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return l.filter((p) => p.id !== id);
    });
  };
  const submit = async () => {
    dictation.stop();
    setState("busy");
    // Pictures not uploaded yet (no key was known when they were added) go up now.
    const urls: string[] = [];
    for (const p of pics) {
      const url = p.status === "done" ? p.url! : await upload(p, key.trim());
      if (!url) {
        setPicNote("That picture didn't upload. Try again.");
        setState("idle");
        return;
      }
      urls.push(url);
    }
    // The card goes on the board at once, in Nikita's words; GitHub's copy replaces it when the feed brings it.
    const card = pendingIdea(note, Date.now(), urls);
    const { addPending, settlePending, shapePending } = useFoundry.getState();
    addPending(card);
    setOpen(false);
    const words = note;
    const kept = pics;
    setNote("");
    setPics([]);
    let number = card.number;
    const r = await propose(
      key.trim(),
      words,
      urls,
      (shape) => shapePending(number, shape),
      (issue) => {
        settlePending(number, issue);
        number = issue;
        expectChange();
      },
    );
    if (r === "ok" || r === "shaping") {
      storeKey(key.trim());
      setState(r === "shaping" ? "shaping" : "done");
      expectChange();
    } else {
      settlePending(number, null);
      setNote(words);
      setPics(kept.map((p, n) => ({ ...p, status: "done" as const, url: urls[n] })));
      setOpen(true);
      setState(r);
    }
  };
  const toggleMic = () => {
    if (dictation.listening) dictation.stop();
    else {
      typed.current = note.trim();
      dictation.start();
    }
  };
  // Until the Vercel variables are set, the Desk can't write to GitHub: the idea gets copied, and the Foundry
  // thread opens to paste it in.
  const handOver = async () => {
    dictation.stop();
    try {
      await navigator.clipboard.writeText(note.trim());
    } catch {
      // No clipboard (an http page, or denied): the text stays in the box to copy by hand.
    }
    window.open(FOUNDRY_THREAD, "_blank", "noopener");
    setState("done");
  };
  if (!open)
    return (
      <button type="button" className="fy-propose__open" onClick={() => (setOpen(true), setState("idle"))}>
        <span aria-hidden="true">+</span> Suggest an idea
        {state === "busy" && <em>On the board. Sending it to GitHub…</em>}
        {state === "shaping" && <em>On the board. Rivet is shaping it now.</em>}
        {state === "done" && <em>{ready ? `Sent. Rivet shapes it into a card ${soon()}.` : "Copied. Paste it in the Foundry thread."}</em>}
      </button>
    );
  return (
    <form
      className={`fy-propose fy-idea__form${dragging ? " fy-propose--drop" : ""}`}
      onDragOver={(e) => {
        if (!canPic || !Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDragging(false)}
      onDrop={(e) => {
        setDragging(false);
        if (!canPic) return;
        e.preventDefault();
        addFiles(Array.from(e.dataTransfer.files));
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!note.trim()) return;
        if (!ready) void handOver().then(() => setOpen(false));
        else if (key.trim()) void submit();
      }}
    >
      <label>
        {dictation.listening ? "Listening… say the idea, then press the mic again." : "Your idea, said or typed. Rivet turns it into a card with a size and a builder, and asks first if something is unclear."}
        <span className="fy-propose__box">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onPaste={(e) => {
              // Pictures on the clipboard become attachments; plain text pastes as usual.
              const files = Array.from(e.clipboardData.files).filter(isImage);
              if (!canPic || !files.length) return;
              if (!e.clipboardData.getData("text/plain")) e.preventDefault();
              addFiles(files);
            }}
            rows={3}
            autoFocus
            maxLength={2000}
            placeholder={canPic ? "What should the Foundry build? Paste or drop pictures too." : "What should the Foundry build?"}
          />
          {canPic && (
            <>
              <input ref={pickFiles} type="file" accept="image/*" multiple hidden onChange={(e) => (addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
              <button type="button" className="fy-mic fy-mic--attach" onClick={() => pickFiles.current?.click()} disabled={pics.length >= MAX_IMAGES} aria-label="Attach pictures" title="Attach pictures">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M20 11.5l-7.6 7.6a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7l-7.6 7.6a1.7 1.7 0 0 1-2.4-2.4l7-7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
          <Mic dictation={dictation} onToggle={toggleMic} label="Say the idea" />
        </span>
      </label>
      {dictation.error && <p className="fy-idea__note">{dictation.error}</p>}
      {pics.length > 0 && (
        <ul className="fy-pics">
          {pics.map((p) => (
            <li key={p.id} className={`fy-pics__item${p.status === "up" ? " fy-pics__item--up" : ""}${p.status === "failed" ? " fy-pics__item--failed" : ""}`}>
              <img src={p.preview} alt="" />
              {p.status === "up" && <span className="fy-pics__state">Uploading…</span>}
              {p.status === "failed" && <span className="fy-pics__state">Not sent</span>}
              <button type="button" className="fy-pics__x" onClick={() => dropPic(p.id)} aria-label="Remove picture">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {picNote && <p className="fy-idea__note">{picNote}</p>}
      {ready && (!storedKey() || state === "wrong-key") && (
        <label>
          {state === "wrong-key" ? "That key didn't match. Try again." : "Your Desk key (asked once on this device)"}
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password" />
        </label>
      )}
      {state === "failed" && <p className="fy-idea__note">That didn't go through. Try again.</p>}
      {!ready && setup !== null && <p className="fy-idea__note fy-idea__note--quiet">Sending straight from here needs the Vercel variables above. Until then this copies your idea and opens the Foundry thread to paste it.</p>}
      <button type="submit" className="btn btn--go btn--sm" disabled={!note.trim() || (ready && !key.trim()) || state === "busy" || uploading || setup === null}>
        {ready ? "Send to Rivet" : "Copy and open the thread"}
      </button>
      <button type="button" className="btn btn--quiet btn--sm" onClick={() => (dictation.stop(), setOpen(false))}>
        Cancel
      </button>
    </form>
  );
}

/** Queued work nobody holds yet (ideas waiting for a pick are the cards above, not this). */
function upNext(crates: Crate[]): Crate[] {
  return crates.filter((c) => c.kind !== "idea" && c.state === "queued").sort((a, b) => a.number - b.number);
}

const ICONS = {
  checks: "M5 12.5l4.2 4.2L19 7",
  running: "M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  upkeep: "M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8V20h3.2l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.4-.6-.6-2.4z",
  ideas: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
} as const;

function Chip({ icon, tone, label, title, href }: { icon: keyof typeof ICONS; tone: LinkState; label: string; title: string; href?: string }) {
  const body = (
    <>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d={ICONS[icon]} stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <i className={`fy-dot fy-dot--${tone}`} aria-hidden="true" />
      <span>{label}</span>
    </>
  );
  return (
    <li>
      {href ? (
        <a className="fy-chip" href={href} target="_blank" rel="noreferrer" title={title} aria-label={title}>
          {body}
        </a>
      ) : (
        <span className="fy-chip" title={title} aria-label={title}>
          {body}
        </span>
      )}
    </li>
  );
}

/** How things stand, at icon level: checks, work running, upkeep, the next ideas. The details sit in each tooltip. */
function StatusStrip({ now, running, upkeep }: { now: number; running: Crate[]; upkeep: Crate | undefined }) {
  const checks = useFoundry((s) => s.data.checks);
  const tone: LinkState = checks.state === "pass" ? "ok" : checks.state === "fail" ? "down" : checks.state === "running" ? "slow" : "off";
  const checksLong = checks.state === "pass" ? "All green" : checks.state === "fail" ? "Red, Rivet is on it" : checks.state === "running" ? "Running" : "No run yet";
  const upkeepNow = upkeep?.state === "working";
  const upkeepLine = upkeepNow ? `Working: ${upkeep.title}` : upkeep ? `Last: ${upkeep.title}` : "None yet";
  return (
    <ul className="fy-strip" aria-label="Right now">
      <Chip icon="checks" tone={tone} label={CHECKS_LABEL[tone]} title={`Checks on main: ${checksLong}`} href={checks.url ?? undefined} />
      <Chip
        icon="running"
        tone={running.length ? "ok" : "off"}
        label={running.length ? `${running.length} running` : "Idle"}
        title={running.length ? `Work running: ${running.map((c) => `#${c.number} ${c.title}`).join("; ")}` : "Work running: nothing right now"}
        href={running.length === 1 ? running[0]!.url : undefined}
      />
      <Chip
        icon="upkeep"
        tone={upkeepNow ? "ok" : "off"}
        label={upkeepNow ? "Upkeep now" : `Upkeep ${inTime(nextUpkeep(now) - now)}`}
        title={`Upkeep. ${upkeepLine}. Next run ${inTime(nextUpkeep(now) - now)}.`}
        href={upkeep?.url}
      />
      <Chip icon="ideas" tone="off" label="Ideas 9:00" title={`Next ideas at 9:00 Mountain, ${inTime(nextIdeas(now) - now)}`} />
    </ul>
  );
}

const STATE_ORDER: Record<CrateState, number> = { stuck: 0, working: 1, ready: 2, queued: 3, shipped: 9 };

/**
 * The crew and what is in flight, together: each member with every job they hold, then the queue nobody has picked up
 * yet. Rusty's jobs past his own are tagged with whichever of his dock crew has them (Dusty, Gusty, Musty); past four
 * jobs across the crew (one for Rocky), the rest are tagged as waiting their turn; Rivet's extra fixes run as clones.
 */
function Crew({ now }: { now: number }) {
  const connected = useFoundry((s) => s.connected);
  const crates = useFoundry((s) => s.data.crates);
  const changelog = useFoundry((s) => s.data.changelog);
  const by = assignCrew(crates);
  const queue = upNext(crates);
  const hands = rustyHands(crates);
  const waiting = waitingTurn(crates);
  const awake = sparesAwake(crates);
  return (
    <>
      <ul className="fy-crew">
        {CREW_ORDER.map((id) => {
          const jobs = crates.filter((c) => by.get(c.number) === id).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.number - b.number);
          const tone: LinkState = jobs[0] ? CREW_STATE[jobs[0].state] : connected ? "ok" : "off";
          const held = jobs.filter((c) => c.state === "working" && !c.paused && !waiting.has(c.number)).length;
          const extra = id === "tessellate" ? (awake ? ` · ${awake} of the dock crew out` : "") : id === "semicolon" && held > 1 ? ` · ${held - 1} ${held === 2 ? "clone" : "clones"}` : "";
          const queued = jobs.filter((c) => waiting.has(c.number)).length;
          return (
            <li key={id} className={`fy-crew__member fy-crew__member--${tone}`}>
              <div className="fy-crew__head">
                <span className="fy-crew__mark">
                  <Avatar agent={id} room="foundry" />
                  <i className={`fy-dot fy-dot--${tone}`} aria-hidden="true" />
                </span>
                <span className="fy-crew__name">
                  {CREW[id].name}
                  <Rank id={id} />
                  <small>
                    {CREW[id].job} · {CREW_RUNG[id]}
                  </small>
                </span>
                <span className="fy-crew__load">
                  {jobs.length ? `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}${extra}${queued ? ` · ${queued} waiting` : ""}` : connected ? "Free" : "Not connected yet"}
                </span>
              </div>
              {jobs.length > 0 && (
                <ul className="fy-jobs">
                  {jobs.map((c, n) => {
                    const hand = id === "tessellate" ? hands.get(c.number) : undefined;
                    const colour = hand ? DOCK_COLOUR.get(hand) : undefined;
                    const held = waiting.has(c.number) ? { tone: "off" as LinkState, label: "Waiting its turn" } : c.paused ? { tone: "slow" as LinkState, label: "Paused for a fix" } : null;
                    return (
                      <li key={c.number} className={`fy-job fy-job--${c.state}`}>
                        <a className="fy-job__n" href={c.url} target="_blank" rel="noreferrer">
                          #{c.number}
                        </a>
                        <a className="fy-job__title" href={c.url} target="_blank" rel="noreferrer">
                          {c.title}
                        </a>
                        <span className="fy-job__meta">
                          {hand && colour && (
                            <b className="fy-job__tag" style={{ "--tone": colour } as React.CSSProperties} title={`${hand}, of Rusty's dock crew, has this one`}>
                              {hand}
                            </b>
                          )}
                          {id === "semicolon" && n > 0 && !held && <b className="fy-job__tag">Clone</b>}
                          {KIND_LABEL[c.kind]} · {modelOf(c, id)} · {formatWait(now - c.updatedAt)} ago
                        </span>
                        <span className={`pill pill--${held ? held.tone : CREW_STATE[c.state]}`}>
                          <i aria-hidden="true" />
                          {held ? held.label : CRATE_STATE[c.state]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <RecentLine items={recentWork(changelog, id)} now={now} />
            </li>
          );
        })}
      </ul>
      <section className="fy-next" aria-label="Up next">
        <h3 className="fy-next__head">
          Up next <span className="badge">{queue.length}</span>
        </h3>
        {queue.length ? (
          <ul className="fy-jobs">
            {queue.map((c) => {
              const who = crewFor(c);
              return (
                <li key={c.number} className="fy-job fy-job--queued">
                  <a className="fy-job__n" href={c.url} target="_blank" rel="noreferrer">
                    #{c.number}
                  </a>
                  <a className="fy-job__title" href={c.url} target="_blank" rel="noreferrer">
                    {c.title}
                  </a>
                  <span className="fy-job__meta">
                    {KIND_LABEL[c.kind]} · for {CREW[who].name} on {modelOf(c, who)} · {formatWait(now - c.updatedAt)} ago
                  </span>
                  <span className="pill pill--off">
                    <i aria-hidden="true" />
                    {CRATE_STATE[c.state]}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="quiet">{connected ? "Nothing queued. Fixes, builds, upkeep and work asked for in chat show here." : "Not connected yet."}</p>
        )}
      </section>
    </>
  );
}

/** A crew member's rank: three pips lit up to their tier, and the models they run on, in their model's colour. */
function Rank({ id }: { id: CrewId }) {
  const { tier, models } = CREW_RANK[id];
  return (
    <span className="fy-rank" style={{ "--c": MODEL[id].colour } as React.CSSProperties} title={`Tier ${tier} of 3 on the crew, on ${models.replace("/", " or ")}`}>
      <span className="fy-rank__pips" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i key={n} className={n <= tier ? "on" : undefined} />
        ))}
      </span>
      Tier {tier} · {models}
    </span>
  );
}

/** One muted row under a crew member: the last few things they shipped. */
function RecentLine({ items, now }: { items: ReturnType<typeof recentWork>; now: number }) {
  return (
    <p className="fy-recent">
      <span className="fy-recent__label">Recently</span>
      {items.length ? (
        items.map((r) => (
          <a key={r.number} className="fy-recent__item" href={r.url} target="_blank" rel="noreferrer" title={r.name}>
            #{r.number} {r.name} <span>{formatWait(now - r.at)} ago</span>
          </a>
        ))
      ) : (
        <span className="fy-recent__none">Nothing shipped yet</span>
      )}
    </p>
  );
}

const PERIOD_KEY = "ceo.usagePeriod";

/** The tab last chosen on the Usage panel; the last 5 hours when nothing is remembered or storage is blocked. */
function savedPeriod(): Period {
  try {
    const v = localStorage.getItem(PERIOD_KEY);
    return PERIODS.some((p) => p.id === v) ? (v as Period) : "5h";
  } catch {
    return "5h";
  }
}

/**
 * What the Foundry uses, over a tab's window (last 5 hours, today, this week, all time): the Claude API spend on quick
 * shaping (with this month's total against the cap), and the crew's work by model with the Claude Code tokens each
 * model used, all counted from the issue trails (usage.ts). The plan's own session and weekly limits are on Claude's
 * usage page, which the Desk can't read, so it links there.
 */
function Usage({ now, setup, world }: { now: number; setup: Setup; world: { status: ChronicleStatus; feed: WorldFeed | null } }) {
  const { feed, failed } = useUsage();
  // The cap is shared with the living Lattice's hourly steps (docs/WORLD.md), so the meter counts both.
  const worldUsd = world.feed?.spend.usd ?? 0;
  const [period, setPeriodState] = useState<Period>(savedPeriod);
  const setPeriod = (p: Period) => {
    setPeriodState(p);
    try {
      localStorage.setItem(PERIOD_KEY, p);
    } catch {
      /* storage blocked: the tab just isn't remembered */
    }
  };
  const label = PERIODS.find((p) => p.id === period)!.label;
  const waiting = failed ? "Can't reach GitHub right now; trying again every minute." : "Waiting for the issue trails from GitHub…";
  const month = feed ? monthSpend(feed.trails, now) : null;
  const spend = feed ? windowSpend(feed.trails, period, now) : null;
  const work = feed ? workByModel(foundryJobs(feed.issues, feed.trails), period, now) : null;
  const code = feed ? codeTokensByModel(feed.trails, period, now) : null;
  const capUsed = month ? month.usd + worldUsd : 0;
  const share = month ? Math.min(1, capUsed / SPEND_CAP_USD) : 0;
  const tone: LinkState = share >= 0.9 ? "down" : share >= 0.6 ? "slow" : "ok";
  const most = work ? Math.max(1, ...MODELS.map((m) => work[m].ms)) : 1;
  const hasWork = work ? MODELS.some((m) => work[m].jobs > 0 || code?.[m] != null) : false;
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = PERIODS[(PERIODS.findIndex((p) => p.id === period) + step + PERIODS.length) % PERIODS.length]!.id;
    setPeriod(next);
    requestAnimationFrame(() => document.getElementById(`fy-tab-${next}`)?.focus());
  };
  return (
    <>
      <div className="fy-tabs" role="tablist" aria-label="Usage time span" onKeyDown={onKey}>
        {PERIODS.map((p) => (
          <button key={p.id} id={`fy-tab-${p.id}`} type="button" role="tab" aria-selected={period === p.id} tabIndex={period === p.id ? 0 : -1} className="fy-tabs__tab" onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
        {period === "5h" && <span className="fy-tabs__note">Foundry work only — your plan's own meter is on Claude's usage page</span>}
      </div>
      <div className="fy-usage__grid" role="tabpanel" aria-label={`Usage: ${label}`}>
        <section className="fy-spend" aria-label={`Claude API spend on idea shaping, ${label.toLowerCase()}`}>
          <h3 className="fy-usage__head">Idea shaping · Claude API</h3>
          {!spend || !month ? (
            <p className="quiet">{waiting}</p>
          ) : (
            <>
              <p className="fy-spend__figure">
                <b>{formatUsd(spend.usd)}</b>
                <span>{label.toLowerCase()}</span>
              </p>
              <p className="fy-spend__calls">
                {spend.calls
                  ? `${spend.calls} ${spend.calls === 1 ? "call" : "calls"} on Claude Haiku · ${spend.tokensIn.toLocaleString()} tokens in · ${spend.tokensOut.toLocaleString()} out`
                  : setup?.shape === false
                    ? "Quick shaping isn't connected yet (CLAUDE_API_KEY in Vercel), so nothing is spent."
                    : "No shaping calls in this span."}
              </p>
              <div
                className={`fy-meter fy-meter--${tone}`}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={SPEND_CAP_USD}
                aria-valuenow={Number(capUsed.toFixed(4))}
                aria-label={`${formatUsd(capUsed)} of the $${SPEND_CAP_USD} monthly cap`}
                title={`${(share * 100).toFixed(share < 0.01 ? 2 : 0)}% of the $${SPEND_CAP_USD} cap`}
              >
                <i style={{ width: `${capUsed > 0 ? Math.max(0.6, share * 100) : 0}%` }} />
              </div>
              <p className="fy-spend__calls">
                {formatUsd(capUsed)} of ${SPEND_CAP_USD} cap · {month.month}
                {worldUsd > 0 && ` · shaping ${formatUsd(month.usd)}, the living Lattice ${formatUsd(worldUsd)}`}
              </p>
              <p className="quiet fy-usage__note">Counted from each call's own token use, written on its idea's trail.</p>
            </>
          )}
        </section>

        <section className="fy-work" aria-label="Foundry work by model">
          <h3 className="fy-usage__head">Foundry work by model · Claude Code</h3>
          {!work || !code ? (
            <p className="quiet">{waiting}</p>
          ) : !hasWork ? (
            <p className="quiet">No jobs in this span. They count from the Builder's Assigned and Shipped steps.</p>
          ) : (
            <table className="fy-work__table">
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col">{label}</th>
                  <th scope="col">Claude Code</th>
                </tr>
              </thead>
              <tbody>
                {MODELS.map((m) => {
                  const row = work[m];
                  const live = row.running ? ` · ${row.running} running` : "";
                  return (
                    <tr key={m} style={{ "--c": MODEL_COLOUR[m] } as React.CSSProperties}>
                      <th scope="row">
                        <i className="fy-work__swatch" aria-hidden="true" />
                        {m}
                      </th>
                      <td title={`${m}, ${label.toLowerCase()}: ${row.jobs} ${row.jobs === 1 ? "job" : "jobs"}, ${formatSpan(row.ms)} of work${live}`}>
                        <b>{row.jobs}</b> {row.jobs === 1 ? "job" : "jobs"} <span>{formatSpan(row.ms)}{live}</span>
                        <span className="fy-work__bar" aria-hidden="true">
                          <i style={{ width: `${row.ms > 0 ? Math.max(2, (row.ms / most) * 100) : 0}%` }} />
                        </span>
                      </td>
                      <td className="fy-work__tokens" title={code[m] === null ? `No Claude Code tokens recorded on ${m} in this span` : `${m}: ${code[m]!.toLocaleString()} tokens`}>
                        <b>{formatTokens(code[m])}</b>
                        {code[m] !== null && <span> tokens</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="quiet fy-usage__note">Foundry crew only: the Builder thread's own use and your other Claude sessions aren't counted.</p>
          <p className="quiet fy-usage__note">
            Time runs from when the Builder assigns a job to when it ships; tokens come from its Shipped step. Your plan's session and weekly limits are on{" "}
            <a href={CLAUDE_USAGE_URL} target="_blank" rel="noreferrer">
              Claude's usage page
            </a>
            , which the Desk can't read.
          </p>
        </section>

        <WorldSpend now={now} world={world} />
      </div>
    </>
  );
}

/**
 * The living Lattice's hourly steps (docs/WORLD.md): this month's Claude API spend on writing the world, how many hours
 * Claude wrote and how many came from the scripted lines, and the guard that keeps it inside the shared cap.
 */
function WorldSpend({ now, world }: { now: number; world: { status: ChronicleStatus; feed: WorldFeed | null } }) {
  const f = world.feed;
  const month = f ? new Date(`${f.spend.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  return (
    <section className="fy-world" aria-label="Claude API spend on the living Lattice, this month">
      <h3 className="fy-usage__head">The living Lattice · Claude API · this month</h3>
      {!f ? (
        <p className="quiet">
          {world.status === "off" ? "The hourly world step isn't saving yet." : world.status === "failed" ? "Can't reach the world right now." : "Reading the world…"}
        </p>
      ) : (
        <>
          <div className="fy-world__row">
            <p className="fy-spend__figure">
              <b>{formatUsd(f.spend.usd)}</b>
              <span>{month}</span>
            </p>
            <p className="fy-spend__calls">
              {f.spend.calls} {f.spend.calls === 1 ? "hour" : "hours"} written by Claude Haiku · {f.spend.scripted} scripted · {f.spend.tokensIn.toLocaleString()} tokens in · {f.spend.tokensOut.toLocaleString()} out
            </p>
          </div>
          <p className="fy-world__line">
            {!f.claude
              ? "No Claude key is set, so every hour comes from the agents' scripted lines, for free."
              : `Guard: the world stops calling Claude at ${formatUsd(f.spend.budget)} a month and writes from scripted lines until the month turns.`}{" "}
            {f.at ? `Last step ${formatSpan(now - Date.parse(f.at))} ago.` : "No step yet."}{" "}
            <a href="/chronicle" onClick={link("chronicle")}>
              Read the Chronicle →
            </a>
          </p>
        </>
      )}
    </section>
  );
}

function Connections({ setup }: { setup: Setup }) {
  const connected = useFoundry((s) => s.connected);
  const checks = useSystems((s) => s.links.find((l) => l.id === "checks")?.state ?? "off");
  const rows: { name: string; what: string; state: LinkState; label: string }[] = [
    { name: "GitHub", what: "The Desk reads the crew's work from the repo", state: connected ? "ok" : "off", label: connected ? "Reading" : "Not reached" },
    { name: "Checks", what: "Types, lint, tests and build on every push", state: checks, label: CHECKS_LABEL[checks] },
    {
      name: "Idea buttons",
      what: "Build, Revise and Not this one change GitHub at once",
      state: setup === null ? "off" : setup.buttons ? "ok" : "slow",
      label: setup === null ? "Checking…" : setup.buttons ? "Ready" : "Needs setup",
    },
    {
      name: "Pictures on ideas",
      what: setup?.images ? "Paste, attach or drop pictures on an idea" : "Needs a Vercel Blob store connected to the project (Vercel → Storage → Create → Blob → connect to this project, then redeploy)",
      state: setup === null ? "off" : setup.images ? "ok" : "slow",
      label: setup === null ? "Checking…" : setup.images ? "Ready" : "Needs setup",
    },
    {
      name: "Quick shaping",
      what: setup?.shape ? "Your idea goes up at once and Rivet shapes it in a second or two" : "Add CLAUDE_API_KEY in Vercel so Rivet shapes ideas on the spot",
      state: setup === null ? "off" : setup.shape ? "ok" : "slow",
      label: setup === null ? "Checking…" : setup.shape ? "Ready" : "Needs setup",
    },
    {
      name: "Queue check",
      what: "The Foundry thread picks up approved builds and red checks within a minute or two; a check every 15 minutes backs it up",
      state: setup === null ? "off" : "ok",
      label: setup === null ? "Checking…" : "About a minute",
    },
  ];
  return (
    <ul className="fy-links">
      {rows.map((r) => (
        <li key={r.name}>
          <span className="fy-links__name">{r.name}</span>
          <span className="fy-links__what">{r.what}</span>
          <span className={`pill pill--${r.state}`}>
            <i aria-hidden="true" />
            {r.label}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Today", "Yesterday", or "Mon 12 Oct". */
function dayLabel(at: number, now: number): string {
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const d = (day(now) - day(at)) / 86_400_000;
  if (d < 1) return "Today";
  if (d < 2) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Every shipped change, newest first, grouped by day: what it was, who did it, and links to its issue and code. */
function Changelog({ changes, now, remarks }: { changes: Change[]; now: number; remarks: Map<number, Remark> }) {
  const days: { label: string; items: Change[] }[] = [];
  for (const c of changes) {
    const label = dayLabel(c.at, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(c);
    else days.push({ label, items: [c] });
  }
  return (
    <div className="changelog">
      {days.map((d) => (
        <section key={d.label} className="changelog__day">
          <h3 className="changelog__date">
            {d.label} <span className="badge">{d.items.length}</span>
          </h3>
          <ul className="crates">
            {d.items.map((c) => {
              const who = crewFor({ kind: c.kind, rung: null });
              // The builder's own word on it, from the living Lattice's hourly step (docs/WORLD.md).
              const said = c.issue ? remarks.get(c.issue.number) : undefined;
              return (
                <li key={c.key} className="crates__item crates__item--shipped">
                  <Avatar agent={who} size="sm" room="foundry" />
                  <span className="crates__kind">{KIND_LABEL[c.kind]}</span>
                  <a className="crates__title" href={c.issue?.url ?? c.landed?.url} target="_blank" rel="noreferrer">
                    {c.title}
                  </a>
                  <span className="crates__who">
                    {CREW[who].name} · {new Date(c.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </span>
                  <span className="changelog__links">
                    {c.issue && (
                      <a href={c.issue.url} target="_blank" rel="noreferrer">
                        #{c.issue.number}
                      </a>
                    )}
                    {c.landed && (
                      <a href={c.landed.url} target="_blank" rel="noreferrer">
                        {c.landed.label}
                      </a>
                    )}
                  </span>
                  {said && (
                    <p className="changelog__remark">
                      <b>{PORTRAITS[said.who]?.name ?? said.who}</b>“{said.text}”
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The Foundry's system: a red check on GitHub opens a fix, the Foundry thread in Claude Code picks it up, and ships to main. */
export function FoundrySystem() {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const checks = useSystems((s) => s.links.find((l) => l.id === "checks")?.state ?? "off");
  const work = crewWork(data.crates);
  const steps: { name: string; what: string; state: LinkState; label: string }[] = [
    { name: "Checks", what: "Types, lint, tests and build on every push to main, on GitHub", state: checks, label: checks === "off" ? "No run yet" : LINK_STATE_LABEL[checks] },
    { name: "Queue check", what: "A red check opens a fix; the Foundry picks it up within a minute or two", state: connected ? "ok" : "off", label: connected ? "About a minute" : "Not connected yet" },
    { name: "Foundry thread", what: "Fixes, upkeep and builds, coded in Claude Code on your plan, each on its own branch and pull request", state: connected ? "ok" : "off", label: connected ? "Ready" : "Not connected yet" },
    { name: "main → the site", what: "Small fixes and upkeep merge once green; bigger work gets a preview and waits for you", state: connected ? "ok" : "off", label: connected ? "Shipping" : "Not connected yet" },
  ];
  return (
    <section className="foundry-system" aria-label="The Foundry's system" style={{ "--tone": DESK_ROOMS.foundry.accent } as React.CSSProperties}>
      <header className="section-head">
        <h2>Foundry: coding in Claude Code</h2>
        <a className="panel__hint" href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
          Open the Foundry thread →
        </a>
      </header>
      <ol className="foundry-flow">
        {steps.map((st) => (
          <li key={st.name}>
            <span className="foundry-flow__name">{st.name}</span>
            <span className="foundry-flow__what">{st.what}</span>
            <span className={`pill pill--${st.state}`}>
              <i aria-hidden="true" />
              {st.label}
            </span>
          </li>
        ))}
      </ol>
      <ul className="foundry-crew">
        {CREW_ORDER.map((id) => {
          const crate = work[id];
          return (
            <li key={id}>
              <Avatar agent={id} room="foundry" />
              <span className="foundry-crew__job">{CREW[id].job}</span>
              <span className="foundry-crew__name">
                {CREW[id].name} <Rank id={id} />
              </span>
              {crate ? (
                <a className="foundry-crew__on" href={crate.url} target="_blank" rel="noreferrer">
                  #{crate.number} {crate.title}
                </a>
              ) : (
                <span className="foundry-crew__on foundry-crew__on--idle">Nothing in hand</span>
              )}
              <span className={`pill pill--${crate ? CREW_STATE[crate.state] : connected ? "ok" : "off"}`}>
                <i aria-hidden="true" />
                {crate ? CRATE_STATE[crate.state] : connected ? "Free" : "Not connected yet"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
