import { useEffect, useRef, useState } from "react";
import { usePictureLinks } from "./ideaImages.ts";
import { DeskSignIn } from "./SignIn.tsx";
import { ensureSignedIn, useDeskAuth } from "./signin.ts";
import { expectChange, pendingIdea, useFoundry, type Crate } from "../foundry.ts";
import { FOUNDRY_THREAD } from "./deskData.ts";
import { useDictation } from "./dictate.ts";
import { Avatar } from "./ui.tsx";

/**
 * The idea card and the idea buttons' plumbing, kept apart from the Foundry page so Today (which stays in the Desk's
 * first load) can show a card without pulling the whole Foundry page in with it.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Ideas nobody picks go to the shelf after a week (docs/FOUNDRY.md). */
const SHELF_DAYS = 7;

/** "New today · shelved in 7 days", "Waiting 3 days · shelved in 4", "Waiting 8 days · due for the shelf"; "" without a date. */
export function ideaAge(createdAt: number | undefined, now: number): string {
  if (createdAt === undefined || !Number.isFinite(createdAt)) return "";
  const days = Math.max(0, Math.floor((now - createdAt) / DAY));
  const left = SHELF_DAYS - days;
  const wait = days === 0 ? "New today" : `Waiting ${days} ${days === 1 ? "day" : "days"}`;
  return `${wait} · ${left <= 0 ? "due for the shelf" : left === 1 ? "shelved tomorrow" : `shelved in ${left}${days === 0 ? " days" : ""}`}`;
}

/** "Idea: make it faster" → "Make it faster". */
export function ideaTitle(title: string): string {
  const t = title.replace(/^Idea:\s*/i, "").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ── The idea buttons ── */

export type Setup = { buttons: boolean; direct: boolean; shape: boolean; images: boolean } | null;
export type Choice = "build" | "pass" | "revise" | "propose" | "answer" | "stop" | "undo";

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
export function soon(): string {
  return `within a minute or two (by ${new Date(nextCheck(Date.now())).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} at the latest)`;
}

/** Rivet's background shaping takes a second or two; past this, an idea still marked for rewriting waits for the check. */
export const SHAPING_MS = 45_000;

export type Sent = "ok" | "shaping" | "signed-out" | "failed" | "held";

/**
 * What the privacy check held back (api/_privacy.ts, #127), as the Desk tells Nikita: the function names the kinds
 * ("an email address", "a phone number"), never the words it found.
 */
export function heldMessage(kinds: unknown): string {
  const list = Array.isArray(kinds) ? kinds.filter((k): k is string => typeof k === "string" && k.length < 60) : [];
  const what = list.length === 0 ? "something private" : list.length === 1 ? list[0]! : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  return `Held back, nothing was sent: this looks like it has ${what} in it, and it would go up on a public GitHub issue. Take it out or say it another way, then send again.`;
}

export const readHeld = async (res: Response) => heldMessage(((await res.json().catch(() => ({}))) as { held?: unknown }).held);

/** One click to the Foundry function: how it went, and the issue it made (for a proposed idea). */
export async function post(issue: number | null, choice: Choice, note = "", onHeld?: (message: string) => void): Promise<{ r: Sent; made: number | null }> {
  try {
    const res = await fetch("/api/foundry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issue, choice, note }), credentials: "same-origin" });
    if (res.status === 401) {
      useDeskAuth.getState().lost();
      return { r: "signed-out", made: null };
    }
    if (res.status === 422) {
      onHeld?.(await readHeld(res));
      return { r: "held", made: null };
    }
    if (!res.ok) return { r: "failed", made: null };
    const body = (await res.json().catch(() => ({}))) as { shaping?: boolean; issue?: number };
    return { r: body.shaping ? "shaping" : "ok", made: typeof body.issue === "number" ? body.issue : null };
  } catch {
    return { r: "failed", made: null };
  }
}


export async function send(issue: number | null, choice: Choice, note = "", onHeld?: (message: string) => void): Promise<Sent> {
  return (await post(issue, choice, note, onHeld)).r;
}


export type Shaped = Pick<Crate, "title" | "pitch" | "size" | "short" | "builder"> & { question?: string };

/**
 * A new idea: the function streams back Rivet's shaping (straight from Claude) and the GitHub issue as each is ready,
 * so the card rewrites itself in about a second, whatever GitHub's pace.
 */
export async function propose(note: string, images: string[], onShape: (shape: Shaped) => void, onIssue: (issue: number) => void, onHeld: (message: string) => void): Promise<Sent> {
  try {
    const res = await fetch("/api/foundry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: "propose", note, images }), credentials: "same-origin" });
    if (res.status === 401) {
      useDeskAuth.getState().lost();
      return "signed-out";
    }
    if (res.status === 422) {
      onHeld(await readHeld(res));
      return "held";
    }
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

/**
 * Files an idea the way the Suggest box does: the card goes on the board at once in Nikita's words, and the
 * function's stream (Rivet's shaping, then the issue number) fills it in. Skippy's "File it" button uses this too
 * (desk/skippy), so an idea from the chat takes exactly the Suggest box's path: same checks, same labels.
 */
export async function fileIdea(words: string, images: string[] = [], onHeld: (message: string) => void = () => {}): Promise<Sent> {
  const card = pendingIdea(words, Date.now(), images);
  const { addPending, settlePending, shapePending } = useFoundry.getState();
  addPending(card);
  let number = card.number;
  const r = await propose(
    words,
    images,
    (shape) => shapePending(number, shape),
    (issue) => {
      settlePending(number, issue);
      number = issue;
      expectChange();
    },
    onHeld,
  );
  if (r === "ok" || r === "shaping") expectChange();
  else settlePending(number, null);
  return r;
}

/**
 * An idea's buttons, as a hook so each layout (the Foundry's picture cards, Today's Weave cards and rows) shares one
 * path: sign in if needed, send, then say what happens next. `go` picks; `mode` says where the card is.
 */
export function useIdeaChoice(crate: Crate, setup: Setup) {
  const [mode, setMode] = useState<"idle" | "signin" | "revise" | "answer" | "busy" | "done" | "failed">("idle");
  const [pending, setPending] = useState<Choice | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState("");
  const [held, setHeld] = useState("");
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

  const go = async (choice: Choice) => {
    dictation.stop();
    const back = choice === "revise" ? "revise" : choice === "answer" ? "answer" : "idle";
    setMode("busy");
    setHeld("");
    // Signed in already, or one passkey tap now; otherwise the sign-in step takes the buttons' place.
    if ((await ensureSignedIn()) !== "ok") {
      setPending(choice);
      setMode("signin");
      return;
    }
    const r = await send(crate.number, choice, note, setHeld);
    if (r === "held") {
      // The privacy check kept it back: the words stay in the box to rephrase, and nothing went to GitHub.
      setMode(back);
      return;
    }
    if (r === "signed-out") {
      setPending(choice);
      setMode("signin");
      return;
    }
    if (r === "failed") {
      setMode("failed");
      return;
    }
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
  /** Back from the sign-in step: to the box that was open, or the buttons. */
  const cancelSignIn = () => setMode(pending === "revise" ? "revise" : pending === "answer" ? "answer" : "idle");
  const resume = () => pending && void go(pending);
  return { mode, setMode, note, setNote, result, held, ready, asking, dictation, toggleMic, go, cancelSignIn, resume };
}

/** An idea card with its buttons; the Foundry tab lists them all and Today shows the ones Rivet is asking about. */
export function IdeaCard({ crate, index, setup, focus = true }: { crate: Crate; index: number; setup: Setup; focus?: boolean }) {
  const { mode, setMode, note, setNote, result, held, ready, asking, dictation, toggleMic, go, cancelSignIn, resume } = useIdeaChoice(crate, setup);
  // Nikita's own pictures only, on short-lived links the picture function signs for a signed-in Desk (#127, #132).
  const pictures = usePictureLinks(crate.images);

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
      {!crate.revising && crate.number > 0 && ideaAge(crate.createdAt, Date.now()) && <p className="fy-idea__age">{ideaAge(crate.createdAt, Date.now())}</p>}
      {asking && (
        <div className="fy-idea__ask" role="note">
          <b>Rivet asks first</b>
          <p>{crate.question}</p>
        </div>
      )}
      {pictures.length > 0 && (
        <ul className="fy-idea__pics">
          {pictures.map((u, n) => (
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
          <div className="fy-idea__actions" title={setup ? "Set the Key Vault secrets to pick from here" : "Checking…"}>
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
        ) : mode === "signin" ? (
          <DeskSignIn compact onDone={resume} onCancel={cancelSignIn} />
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
            {held && (
              <p className="fy-idea__note" role="alert">
                {held}
              </p>
            )}
            <button type="submit" className="btn btn--go btn--sm" disabled={!note.trim()}>
              Send notes
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setMode("idle")}>
              Cancel
            </button>
          </form>
        ) : asking && (mode === "idle" || mode === "busy" || mode === "answer") ? (
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
            {held && (
              <p className="fy-idea__note" role="alert">
                {held}
              </p>
            )}
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


/** The mic in a text box: press to dictate, press again to stop. Nothing when the browser has no speech recognition. */
export function Mic({ dictation, onToggle, label }: { dictation: ReturnType<typeof useDictation>; onToggle: () => void; label: string }) {
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
