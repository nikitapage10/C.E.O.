import { useEffect, useRef, useState } from "react";
import { usePictureLinks } from "./ideaImages.ts";
import { DeskSignIn } from "./SignIn.tsx";
import { ensureSignedIn, useDeskAuth } from "./signin.ts";
import { expectChange, type Crate } from "../foundry.ts";
import { FOUNDRY_THREAD } from "./deskData.ts";
import { useDictation } from "./dictate.ts";
import { Avatar } from "./ui.tsx";

/**
 * The idea card and the idea buttons' plumbing, kept apart from the Foundry page so Today (which stays in the Desk's
 * first load) can show a card without pulling the whole Foundry page in with it.
 */

const HOUR = 3_600_000;

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


/** An idea card with its buttons; the Foundry tab lists them all and Today shows the ones Rivet is asking about. */
export function IdeaCard({ crate, index, setup, focus = true }: { crate: Crate; index: number; setup: Setup; focus?: boolean }) {
  const [mode, setMode] = useState<"idle" | "signin" | "revise" | "busy" | "done" | "failed">("idle");
  const [pending, setPending] = useState<Choice | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState("");
  const [held, setHeld] = useState("");
  const ready = setup?.buttons ?? false;
  const asking = Boolean(crate.asking && crate.question);
  // Nikita's own pictures only, on short-lived links the picture function signs for a signed-in Desk (#127, #132).
  const pictures = usePictureLinks(crate.images);
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
      setMode(choice === "revise" ? "revise" : "idle");
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
        ) : mode === "signin" ? (
          <DeskSignIn compact onDone={() => pending && void go(pending)} onCancel={() => setMode(pending === "revise" ? "revise" : "idle")} />
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
