import { useRef, useState } from "react";
import { heldMessage, IdeaCard, nextCheck, propose, send, soon, useSetup, ideaTitle, type Setup } from "./IdeaCard.tsx";
export { heldMessage, IdeaCard, ideaTitle, nextCheck, useSetup };
import { MAX_IMAGES, isImage, uploadImage } from "./ideaImages.ts";
import { DeskSignIn } from "./SignIn.tsx";
import { ensureSignedIn, useDeskAuth } from "./signin.ts";
import { assignCrew, ideaCounts, openIdeas, CREW, CREW_ORDER, CREW_RANK, DOCK_CREW, crewFor, expectChange, MODEL, modelOf, pendingIdea, recentWork, REPO, rustyHands, sparesAwake, useFoundry, waitingTurn, withTrails, type Approval, type Change, type Crate, type CrateKind, type CrateState, type CrewId, type Origin } from "../foundry.ts";
import { useSystems, type LinkState } from "../systems.ts";
import { FOUNDRY_THREAD, formatWait } from "./deskData.ts";
import { useDictation } from "./dictate.ts";
import { CLAUDE_USAGE_URL, codeTokensByModel, formatSpan, formatTokens, formatUsd, foundryJobs, MODELS, monthSpend, PERIODS, SPEND_CAP_USD, useUsage, windowSpend, workByModel, type Period } from "../usage.ts";
import { useHide, useMasked } from "./hide.ts";
import { Private } from "./Private.tsx";
import { ChangePictures } from "./ChangePictures.tsx";
import { Avatar } from "./ui.tsx";
import { remarksByIssue, useWorldFeed, type ChronicleStatus, type Remark, type WorldFeed } from "../chronicle.ts";
import { link } from "./nav.ts";
import { PORTRAITS } from "./portraits.ts";
import { SetupAsks } from "./skippy/SetupAsks.tsx";
import { RC } from "./flow/index.ts";
import { ForgeStage } from "./foundry/ForgeStage.tsx";
import { BenchCard, CrewStations, RunsLine, UsageLine, VqaLine } from "./foundry/ForgeParts.tsx";
import { queueOf } from "./foundry/forge.ts";
import "./foundry/foundry.css";

/**
 * The Foundry's own Desk page (#432), on the Desk's flow kit in Today's language with the Builder's forge orange. The
 * stage leads: the pipeline as particle lines (ideas, the queue, the forge's four lanes, checks, shipped; see
 * foundry/ForgeStage.tsx) with what needs Nikita beside the headline. Below it, simple first and deeper on click: the
 * ideas on the bench as cards with their pictures beside the Suggest box, the crew at their stations (every job in hand
 * and the queue one click deeper), the Changelog, and the next runs, usage, Visual QA and connections. GitHub is read
 * through the Desk's feed (see foundry.ts); the idea buttons write through the function in api/foundry.ts (on Azure,
 * #313).
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

const inTime = (ms: number) => (ms < HOUR ? `in ${Math.max(1, Math.round(ms / 60_000))} min` : `in ${Math.round(ms / HOUR)} h`);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  // Everything in flight: what the crew holds plus the queue nobody holds yet. Chat work is in here too.
  const inFlight = assignCrew(data.crates).size + queueOf(data.crates).length;
  const { questions, toPick } = ideaCounts(ideas);

  const parts: string[] = [];
  if (questions.length) parts.push(questions.length === 1 ? "Rivet has a question" : `Rivet has ${questions.length} questions`);
  if (toPick) parts.push(`${toPick} ${toPick === 1 ? "idea is" : "ideas are"} waiting for your pick`);
  if (decisions.length) parts.push(`${decisions.length} ${decisions.length === 1 ? "thing needs" : "things need"} your OK`);
  const lead = !connected ? "Connecting to GitHub…" : parts.length ? `${parts.join(", and ")}.` : "Nothing needs you; the crew handles small fixes and upkeep on its own.";
  // The living Lattice: the builders' remarks for the Changelog, and the world's spend for the Usage panel.
  const world = useWorldFeed();
  // The issue trails: the Usage panel counts from them, and the Changelog reads each change's Origin and Decision.
  const usage = useUsage();
  const changelog = withTrails(data.changelog, usage.feed?.trails ?? []);
  const suggest = useRef<HTMLElement>(null);
  const log = useRef<HTMLElement>(null);
  const toSuggest = () => {
    suggest.current?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
    window.setTimeout(() => suggest.current?.querySelector("textarea")?.focus({ preventScroll: true }), 400);
  };
  const toIdea = (n: number) => {
    const el = document.getElementById(`fo-idea-${n}`);
    el?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
    el?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  };
  const toLog = () => log.current?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  const stop = (c: Crate) => (c.auto ? <StopAuto crate={c} setup={setup} /> : null);

  return (
    <div className="foundry-page wv-page fl-page fo" data-room="foundry" style={{ "--fl-accent": RC.foundry } as React.CSSProperties}>
      <ForgeStage data={data} ideas={ideas} now={now} connected={connected} lead={lead} stop={stop} onSuggest={toSuggest} onIdea={toIdea} onShips={toLog} />

      <section className="fl-below fo-bench" aria-label="Ideas waiting">
        <div className="fo-sec">
          <p className="fl-eyb">
            <span>On the bench</span>
            <i />
            {ideas.length ? (questions.length ? "Rivet asks about one first" : "shaped by Rivet and the Builder") : connected ? `the next ideas arrive ${inTime(nextIdeas(now) - now)}, at 9:00` : "connecting to GitHub"}
          </p>
          <h2 className="fl-h2">{ideas.length ? `${NUMBER_WORD[ideas.length] ?? ideas.length} ${ideas.length === 1 ? "idea waits" : "ideas wait"} for your pick` : "The bench is clear"}</h2>
        </div>
        <div className="fo-bench-g">
          {ideas.length > 0 ? (
            <div className="fo-cards">
              {ideas.map((c, i) => (
                <BenchCard key={c.number} crate={c} setup={setup} now={now} i={i} />
              ))}
            </div>
          ) : (
            <BenchClear now={now} connected={connected} onSuggest={toSuggest} />
          )}
          <div className="fo-side">
            <Propose setup={setup} box={suggest} />
            {setup !== null && !setup.buttons && <SetupNote />}
          </div>
        </div>
        {data.shelved > 0 && (
          <p className="fo-note fo-shelf">
            {data.shelved} {data.shelved === 1 ? "idea" : "ideas"} on the shelf: passed for now, and Rusty may bring one back in a new shape.
          </p>
        )}
      </section>

      <CrewStations data={data} now={now}>
        <details className="fo-more-d">
          <summary>
            Every job in hand, and the queue <span className="fl-num">{inFlight}</span>
          </summary>
          <Crew now={now} setup={setup} />
        </details>
      </CrewStations>

      <div className="fl-below fo-flow2">
        <section ref={log} className="fo-log fy-changelog" aria-label="Changelog">
          <p className="fl-eyb">
            <span>Changelog</span>
            <i />
            newest first
          </p>
          <h2 className="fl-h2">What reached the Lattice</h2>
          {changelog.length ? <Changelog changes={changelog} now={now} remarks={remarksByIssue(world.feed?.remarks ?? [])} setup={setup} /> : <p className="fl-wait">{connected ? "Nothing shipped yet." : "Connecting to GitHub…"}</p>}
          <p className="fo-note changelog__all">
            Every commit on main, one-offs included, is on{" "}
            <a className="fo-link" href={`https://github.com/${REPO}/commits/main`} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          </p>
        </section>
        <div className="fo-flow2-r">
          <RunsLine now={now} />
          <UsageLine usage={usage.feed} world={world.feed} now={now}>
            <details className="fo-more-d">
              <summary>
                By time span and model{" "}
                <a className="fo-link" href={CLAUDE_USAGE_URL} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  Claude plan limits ↗
                </a>
              </summary>
              <div className="fy-usage">
                <Usage now={now} setup={setup} world={world} usage={usage} />
              </div>
            </details>
          </UsageLine>
          <VqaLine />
          <details className="fo-more-d fo-conn">
            <summary>Connections</summary>
            <Connections setup={setup} />
          </details>
        </div>
      </div>

      <div className="fl-below">
        <SetupAsks room="foundry" />
      </div>
    </div>
  );
}

/**
 * The empty bench (#328): where the morning's three will land, as three outlined places with the time they arrive,
 * and a fourth that is Nikita's own, pointing at Suggest. The bench reads as waiting, not as missing.
 */
function BenchClear({ now, connected, onSuggest }: { now: number; connected: boolean; onSuggest: () => void }) {
  const at = nextIdeas(now);
  const when = connected ? inTime(at - now) : "once GitHub answers";
  return (
    <div className="fo-clear" aria-label="The bench is clear">
      <p className="fl-wait">{connected ? "All clear. The morning's three land here, or yours does first." : "Waiting for GitHub."}</p>
      <ol className="fo-slots">
        {["One", "Two", "Three"].map((n, i) => (
          <li key={n} style={{ "--i": i } as React.CSSProperties}>
            <span className="fl-k">Idea {n.toLowerCase()} · 9:00</span>
            <b>Rivet is still sleeping on it</b>
            <small>Arrives {when}, sized and with a builder.</small>
          </li>
        ))}
        <li className="is-yours">
          <button type="button" onClick={onSuggest}>
            <span className="fl-k">
              <span>Yours</span>
            </span>
            <b>Suggest one now →</b>
            <small>Rivet reads it within a minute.</small>
          </button>
        </li>
      </ol>
    </div>
  );
}

const NUMBER_WORD = ["None", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** Shown until the Foundry function can reach GitHub: what unlocks the buttons, in one place. */
function SetupNote() {
  return (
    <aside className="fy-setup" aria-label="One-time setup">
      <strong>One-time setup, then everything happens here.</strong>
      <p>
        The buttons go through the Azure functions, which need two Key Vault secrets (Key vaults → the C.E.O. vault → Secrets, then restart the Function App; docs/AZURE.md): <code>foundry-desk-key</code>, a long passphrase you invent and type once per device to enrol its passkey, and{" "}
        <code>foundry-github-token</code>, a GitHub token for this repo with Issues read and write. The private store (Azure Blob) comes with the template. A click then changes GitHub at once.
      </p>
    </aside>
  );
}


/** Nikita's own idea: say it or type it, and Rivet shapes it into a card like the morning ones. */
type Pic = { id: string; file: File; preview: string; status: "wait" | "up" | "done" | "failed"; url?: string };

function Propose({ setup, box }: { setup: Setup; box?: React.Ref<HTMLElement> }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "shaping" | "failed" | "signed-out" | "held">("idle");
  // What was typed before the mic started; dictation appends to it.
  const typed = useRef("");
  const dictation = useDictation((finished, tail) => setNote(`${typed.current}${typed.current && (finished || tail) ? " " : ""}${finished}${finished && tail ? " " : ""}${tail}`));
  const ready = setup?.buttons ?? false;
  const canPic = ready && (setup?.images ?? false);
  const [pics, setPics] = useState<Pic[]>([]);
  const [picNote, setPicNote] = useState("");
  const [held, setHeld] = useState("");
  const [dragging, setDragging] = useState(false);
  const pickFiles = useRef<HTMLInputElement>(null);
  const uploading = pics.some((p) => p.status === "up");
  // Pictures go up as soon as they are added while signed in; otherwise when the idea is sent.
  const known = useDeskAuth((s) => s.auth.status === "in");
  const upload = async (pic: Pic) => {
    setPics((l) => l.map((p) => (p.id === pic.id ? { ...p, status: "up" } : p)));
    const url = await uploadImage(pic.file);
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
    if (known) for (const p of fresh) void upload(p).then((u) => !u && setPicNote("That picture didn't upload. Try again."));
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
    // Signed in already, or one passkey tap now; otherwise the sign-in step shows under the idea.
    if ((await ensureSignedIn()) !== "ok") {
      setState("signed-out");
      return;
    }
    // Pictures not uploaded yet (added while signed out) go up now.
    const urls: string[] = [];
    for (const p of pics) {
      const url = p.status === "done" ? p.url! : await upload(p);
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
    const words = note;
    const kept = pics;
    setNote("");
    setPics([]);
    let number = card.number;
    const r = await propose(
      words,
      urls,
      (shape) => shapePending(number, shape),
      (issue) => {
        settlePending(number, issue);
        number = issue;
        expectChange();
      },
      setHeld,
    );
    if (r === "ok" || r === "shaping") {
      setState(r === "shaping" ? "shaping" : "done");
      expectChange();
    } else {
      settlePending(number, null);
      setNote(words);
      setPics(kept.map((p, n) => ({ ...p, status: "done" as const, url: urls[n] })));
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
  // Until the Key Vault secrets are set, the Desk can't write to GitHub: the idea gets copied, and the Foundry
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
  const status =
    state === "busy" ? "On the board. Sending it to GitHub…" : state === "shaping" ? "On the board. Rivet is shaping it now." : state === "done" ? (ready ? `Sent. Rivet shapes it into a card ${soon()}.` : "Copied. Paste it in the Foundry thread.") : "";
  return (
    <section ref={box} className={`fl-panel wv-suggest fo-suggest${dragging ? " is-drop" : ""}`} aria-label="Suggest an idea">
      <p className="fl-k">
        <span>Suggest</span> · yours, in your words
      </p>
      <h2 className="fl-h2">What should the crew build next?</h2>
      <form
        className="wv-sug-form"
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
          if (!ready) void handOver();
          else void submit();
        }}
      >
        <div className="wv-sug-box">
          <textarea
            className="wv-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onPaste={(e) => {
              // Pictures on the clipboard become attachments; plain text pastes as usual.
              const files = Array.from(e.clipboardData.files).filter(isImage);
              if (!canPic || !files.length) return;
              if (!e.clipboardData.getData("text/plain")) e.preventDefault();
              addFiles(files);
            }}
            maxLength={2000}
            aria-label="Your idea"
            placeholder={dictation.listening ? "Listening… say the idea, then press the mic again." : canPic ? "Say it however it comes out, or paste and drop pictures. Rivet tidies it up." : "Say it however it comes out. Rivet tidies it up."}
          />
          {pics.length > 0 && (
            <ul className="fy-pics wv-sug-pics">
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
          <div className="wv-sug-row">
            {dictation.supported && (
              <button type="button" className={`wv-mic${dictation.listening ? " is-on" : ""}`} onClick={toggleMic} aria-pressed={dictation.listening} aria-label={dictation.listening ? "Stop listening" : "Say the idea"} title={dictation.listening ? "Stop listening" : "Say the idea"}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                  <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                </svg>
              </button>
            )}
            {canPic && (
              <>
                <input ref={pickFiles} type="file" accept="image/*" multiple hidden onChange={(e) => (addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
                <button type="button" className="wv-btn is-ic" onClick={() => pickFiles.current?.click()} disabled={pics.length >= MAX_IMAGES} aria-label="Add pictures" title="Add pictures">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                    <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
                    <circle cx="5.5" cy="6.5" r="1.3" />
                    <path d="m2 12 4-3.5 3 2.5 2-1.5 3 2.5" />
                  </svg>
                </button>
              </>
            )}
            <span className="wv-sug-sp" />
            <button type="submit" className="wv-btn is-pri" disabled={!note.trim() || state === "busy" || state === "signed-out" || uploading || setup === null}>
              {ready ? "Send to Rivet" : "Copy and open the thread"}
            </button>
          </div>
        </div>
      </form>
      {dictation.error && <p className="wv-act-note">{dictation.error}</p>}
      {picNote && <p className="wv-act-note">{picNote}</p>}
      {state === "failed" && <p className="wv-act-note">That didn't go through. Try again.</p>}
      {state === "held" && held && (
        <p className="wv-act-note" role="alert">
          {held}
        </p>
      )}
      {status && (
        <p className="wv-act-ok" role="status">
          {status}
        </p>
      )}
      {!ready && setup !== null && <p className="wv-act-note">Sending straight from here needs the Key Vault secrets. Until then this copies your idea and opens the Foundry thread to paste it.</p>}
      {/* Outside the form: the sign-in step has a form of its own. */}
      {ready && state === "signed-out" && <DeskSignIn compact onDone={() => void submit()} onCancel={() => setState("idle")} />}
      <p className="wv-sug-rivet">
        <img src="/desk/agent-semicolon.webp" alt="" />
        Rivet reads it within a minute, asks if anything's unclear, and it lands on the bench with a size and a builder.
      </p>
    </section>
  );
}

const STATE_ORDER: Record<CrateState, number> = { stuck: 0, working: 1, ready: 2, queued: 3, shipped: 9 };

/**
 * The crew and what is in flight, together: each member with every job they hold, then the queue nobody has picked up
 * yet. Rusty's jobs past his own are tagged with whichever of his dock crew has them (Dusty, Gusty, Musty); past four
 * jobs across the crew (one for Rocky), the rest are tagged as waiting their turn; Rivet's extra fixes run as clones.
 */
function Crew({ now, setup }: { now: number; setup: Setup }) {
  const connected = useFoundry((s) => s.connected);
  const crates = useFoundry((s) => s.data.crates);
  const changelog = useFoundry((s) => s.data.changelog);
  const by = assignCrew(crates);
  const queue = queueOf(crates);
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
                          {c.auto && <ApprovalMark approval="auto" />}
                          {KIND_LABEL[c.kind]} · {modelOf(c, id)} · {formatWait(now - c.updatedAt)} ago
                          {c.auto && <StopAuto crate={c} setup={setup} />}
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
                    {c.auto && <ApprovalMark approval="auto" />}
                    {KIND_LABEL[c.kind]} · for {CREW[who].name} on {modelOf(c, who)} · {formatWait(now - c.updatedAt)} ago
                    {c.auto && <StopAuto crate={c} setup={setup} />}
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

/**
 * Stop a build the Builder auto-approved (docs/FOUNDRY.md, "Auto-approval"): two taps, so a stray one never stops
 * anything. It goes back to an idea card waiting for Nikita's pick.
 */
function StopAuto({ crate, setup }: { crate: Crate; setup: Setup }) {
  const [mode, setMode] = useState<"idle" | "confirm" | "busy" | "done" | "failed" | "signin">("idle");
  if (!setup?.buttons) return null;
  const stop = async () => {
    setMode("busy");
    if ((await ensureSignedIn()) !== "ok") return setMode("signin");
    const r = await send(crate.number, "stop");
    if (r === "signed-out") return setMode("signin");
    if (r === "failed" || r === "held") return setMode("failed");
    setMode("done");
    expectChange();
  };
  if (mode === "done") return <span className="fy-stop__note">Stopped. It's back with the ideas for your pick.</span>;
  if (mode === "failed") return <span className="fy-stop__note">That didn't go through. Try again in a moment.</span>;
  if (mode === "signin") return <span className="fy-stop__note">Sign in above to stop it.</span>;
  return mode === "confirm" || mode === "busy" ? (
    <span className="fy-stop">
      <button type="button" className="wv-btn is-sm" disabled={mode === "busy"} onClick={() => void stop()}>
        {mode === "busy" ? "Stopping…" : "Yes, stop it"}
      </button>
      <button type="button" className="wv-btn is-sm is-ghost" disabled={mode === "busy"} onClick={() => setMode("idle")}>
        Keep going
      </button>
    </span>
  ) : (
    <button type="button" className="wv-btn is-sm fy-stop__btn" onClick={() => setMode("confirm")} title="Auto-approved by the Builder. Stop it and send it back to you as an idea.">
      Stop
    </button>
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
function Usage({ now, setup, world, usage }: { now: number; setup: Setup; world: { status: ChronicleStatus; feed: WorldFeed | null }; usage: ReturnType<typeof useUsage> }) {
  const { feed, failed } = usage;
  const mask = useMasked();
  const hidden = useHide((h) => h.on);
  // The cap is shared with the living Lattice's hourly steps (docs/WORLD.md), so the meter counts both.
  // The day's story scripts (Claude Haiku) count against the same cap, with the world's hours.
  const worldUsd = (world.feed?.spend.usd ?? 0) + (world.feed?.story?.scriptUsd ?? 0);
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
                <b>
                  <Private>{formatUsd(spend.usd)}</Private>
                </b>
                <span>{label.toLowerCase()}</span>
              </p>
              <p className="fy-spend__calls">
                {spend.calls
                  ? `${spend.calls} ${spend.calls === 1 ? "call" : "calls"} on Claude Haiku · ${spend.tokensIn.toLocaleString()} tokens in · ${spend.tokensOut.toLocaleString()} out`
                  : setup?.shape === false
                    ? "Quick shaping isn't connected yet (claude-api-key in the Key Vault), so nothing is spent."
                    : "No shaping calls in this span."}
              </p>
              <div
                className={`fy-meter fy-meter--${tone}`}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={SPEND_CAP_USD}
                aria-valuenow={hidden ? undefined : Number(capUsed.toFixed(4))}
                aria-label={`${mask(formatUsd(capUsed))} of the $${SPEND_CAP_USD} monthly cap`}
                title={`${(share * 100).toFixed(share < 0.01 ? 2 : 0)}% of the $${SPEND_CAP_USD} cap`}
              >
                <i style={{ width: `${capUsed > 0 ? Math.max(0.6, share * 100) : 0}%` }} />
              </div>
              <p className="fy-spend__calls">
                <Private>{formatUsd(capUsed)}</Private> of ${SPEND_CAP_USD} cap · {month.month}
                {worldUsd > 0 && (
                  <>
                    {" · shaping "}
                    <Private>{formatUsd(month.usd)}</Private>, the living Lattice <Private>{formatUsd(worldUsd)}</Private>
                  </>
                )}
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
        <StorySpend world={world} />
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
              <b>
                <Private>{formatUsd(f.spend.usd)}</Private>
              </b>
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
            <a href="/archive" onClick={link("archive")}>
              Read it in the Archive →
            </a>
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Today in Ilyr (issue #95, #365, docs/WORLD.md): Skippy writes it (Claude Haiku, on the shared Claude cap) and
 * presents it, ElevenLabs reading first under its own cap (ELEVENLABS_BUDGET_USD) and Gemini's speech taking over on a
 * failure or past the cap (GEMINI_BUDGET_USD). This month's voice spend against both caps; without a key, it says so.
 */
function StorySpend({ world }: { world: { status: ChronicleStatus; feed: WorldFeed | null } }) {
  const s = world.feed?.story;
  const mask = useMasked();
  const hidden = useHide((h) => h.on);
  const month = s ? new Date(`${s.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const usd = s ? s.usd + (s.elevenUsd ?? 0) : 0;
  const budget = s ? s.budget + (s.elevenBudget ?? 0) : 0;
  const share = budget > 0 ? Math.min(1, usd / budget) : 0;
  const tone: LinkState = share >= 0.9 ? "down" : share >= 0.6 ? "slow" : "ok";
  const voices = s ? [s.eleven ? "ElevenLabs" : null, s.gemini ? "Gemini" : null].filter(Boolean).join(", then ") : "";
  return (
    <section className="fy-world" aria-label="Voice spend on Today in Ilyr, this month">
      <h3 className="fy-usage__head">Today in Ilyr · Skippy's voice · this month</h3>
      {!s ? (
        <p className="quiet">{world.status === "off" ? "The world isn't saving yet, so there are no stories." : world.status === "failed" ? "Can't reach the world right now." : "Reading the ledger…"}</p>
      ) : (
        <>
          <div className="fy-world__row">
            <p className="fy-spend__figure">
              <b>
                <Private>{formatUsd(usd)}</Private>
              </b>
              <span>{month}</span>
            </p>
            <p className="fy-spend__calls">
              {s.stories} {s.stories === 1 ? "edition" : "editions"} read aloud · ElevenLabs <Private>{formatUsd(s.elevenUsd ?? 0)}</Private> · Gemini <Private>{formatUsd(s.usd)}</Private> · scripts on Claude Haiku <Private>{formatUsd(s.scriptUsd)}</Private>
            </p>
          </div>
          <div
            className={`fy-meter fy-meter--${tone}`}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={hidden ? undefined : Number(usd.toFixed(4))}
            aria-label={`${mask(formatUsd(usd))} of the voices' $${budget} monthly caps`}
          >
            <i style={{ width: `${usd > 0 ? Math.max(0.6, share * 100) : 0}%` }} />
          </div>
          <p className="fy-world__line">
            {!s.eleven && !s.gemini
              ? "No voice key is set (elevenlabs or gemini-api-key in the Key Vault), so Skippy writes Today but doesn't read it aloud."
              : !s.eleven
                ? "No ElevenLabs key (elevenlabs in the Key Vault), so Gemini reads Today in Skippy's place."
                : `Skippy reads with ${voices}. Guard: each voice stops once one more edition could pass its cap; the Archive says so until the month turns.`}{" "}
            <a href="/archive" onClick={link("archive")}>
              Hear it in the Archive →
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
      what: setup?.images ? "Paste, attach or drop pictures on an idea" : "Needs the private Azure Blob store (ceo-state), which the Azure template creates (docs/AZURE.md)",
      state: setup === null ? "off" : setup.images ? "ok" : "slow",
      label: setup === null ? "Checking…" : setup.images ? "Ready" : "Needs setup",
    },
    {
      name: "Quick shaping",
      what: setup?.shape ? "Your idea goes up at once and Rivet shapes it in a second or two" : "Add claude-api-key to the Key Vault so Rivet shapes ideas on the spot",
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

/**
 * The Changelog's two markers (docs/FOUNDRY.md, "Auto-approval"). Each pairs its colour with a word and a shape, so
 * none is told apart by colour alone: approval by its icon and outline (filled for auto, ruled for Nikita's OK,
 * dashed for none), source by its label beside a coloured dot.
 */
const APPROVAL_MARK: Record<Approval, { label: string; long: string }> = {
  auto: { label: "Auto", long: "Auto-approved by the Builder" },
  manual: { label: "Your OK", long: "Approved by you" },
  none: { label: "Routine", long: "Needed no approval" },
};
const ORIGIN_MARK: Record<Origin, { label: string; long: string }> = {
  nikita: { label: "Your idea", long: "Your idea, from the Desk or chat" },
  builder: { label: "Builder idea", long: "A morning idea or one the Builder filed" },
  upkeep: { label: "Upkeep", long: "Upkeep and maintenance" },
  fix: { label: "Fix", long: "A fix: red checks, a bug or an alert" },
  chat: { label: "Chat", long: "Work you asked for in chat" },
};
const APPROVALS: Approval[] = ["auto", "manual", "none"];
const ORIGINS: Origin[] = ["nikita", "builder", "upkeep", "fix", "chat"];

function ApprovalIcon({ approval }: { approval: Approval }) {
  return (
    <svg className="cl-mark__icon" viewBox="0 0 12 12" aria-hidden="true">
      {approval === "auto" ? <path d="M7 1 2.5 7H6l-1 4 4.5-6H6z" /> : approval === "manual" ? <path d="m2.5 6.2 2.3 2.3L9.5 3.6" /> : <path d="M3 6h6" />}
    </svg>
  );
}

function ApprovalMark({ approval }: { approval: Approval }) {
  return (
    <span className={`cl-mark cl-mark--approval cl-mark--${approval}`} title={APPROVAL_MARK[approval].long}>
      <ApprovalIcon approval={approval} />
      {APPROVAL_MARK[approval].label}
    </span>
  );
}

function OriginMark({ origin }: { origin: Origin }) {
  return (
    <span className={`cl-mark cl-mark--origin cl-origin--${origin}`} title={ORIGIN_MARK[origin].long}>
      <i aria-hidden="true" />
      {ORIGIN_MARK[origin].label}
    </span>
  );
}

/** The key to the markers, with how many of each the list holds. */
function ChangelogLegend({ changes }: { changes: Change[] }) {
  const count = <K extends string>(key: "approval" | "origin", v: K) => changes.filter((c) => c[key] === v).length;
  return (
    <div className="cl-legend" aria-label="What the markers mean">
      <p className="cl-legend__row">
        <span className="cl-legend__name">Approval</span>
        {APPROVALS.map((a) => (
          <span key={a} className="cl-legend__item" title={APPROVAL_MARK[a].long}>
            <ApprovalMark approval={a} />
            <span className="cl-legend__n">{count("approval", a)}</span>
          </span>
        ))}
      </p>
      <p className="cl-legend__row">
        <span className="cl-legend__name">Source</span>
        {ORIGINS.map((o) => (
          <span key={o} className="cl-legend__item" title={ORIGIN_MARK[o].long}>
            <OriginMark origin={o} />
            <span className="cl-legend__n">{count("origin", o)}</span>
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * Every shipped change, newest first, grouped by day. Each entry: who built it, what it was, when, where it came from
 * and whether it waited for Nikita (the two markers, keyed in the legend up top), links to its issue and code, and its
 * pictures when its issue has a Pictures step.
 */
function Changelog({ changes, now, remarks, setup }: { changes: Change[]; now: number; remarks: Map<number, Remark>; setup: Setup }) {
  const [all, setAll] = useState(false);
  const days: { label: string; items: Change[] }[] = [];
  for (const c of changes) {
    const label = dayLabel(c.at, now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(c);
    else days.push({ label, items: [c] });
  }
  const shown = all ? days : days.slice(0, 3);
  return (
    <>
      <div className="wv-log-in changelog">
        {shown.map((d) => (
          <div key={d.label} className="changelog__day">
            <p className="wv-log-day">
              <b>{d.label}</b>
              <span>{d.items.length} shipped</span>
            </p>
            {d.items.map((c) => {
              const who = c.by ?? crewFor({ kind: c.kind, rung: null });
              // The builder's own word on it, from the living Lattice's hourly step (docs/WORLD.md).
              const said = c.issue ? remarks.get(c.issue.number) : undefined;
              return (
                <div key={c.key} className={`wv-log-i cl-entry cl-origin--${c.origin}${c.pictures?.length ? " cl-entry--pics" : ""}${c.undo ? ` cl-entry--undo-${c.undo}` : ""}`} data-c={d.label === "Today" ? "ok" : undefined}>
                  {c.pictures?.length ? <ChangePictures pictures={c.pictures} title={ideaTitle(c.title)} /> : null}
                  <b>
                    <a className="cl-entry__title" href={c.issue?.url ?? c.landed?.url} target="_blank" rel="noreferrer">
                      {ideaTitle(c.title)}
                    </a>
                  </b>
                  <span className="wv-log-when">
                    {new Date(c.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}, {CREW[who].name}
                                      </span>
                  <div className="wv-log-meta cl-entry__meta">
                    <OriginMark origin={c.origin} />
                    <ApprovalMark approval={c.approval} />
                    {c.issue && (
                      <a className="cl-entry__link" href={c.issue.url} target="_blank" rel="noreferrer">
                        #{c.issue.number}
                      </a>
                    )}
                    {c.landed && (
                      <a className="cl-entry__link" href={c.landed.url} target="_blank" rel="noreferrer">
                        {c.landed.label}
                      </a>
                    )}
                    {c.undo ? <UndoMark change={c} /> : c.issue && <UndoChange issue={c.issue.number} setup={setup} />}
                  </div>
                  {said && (
                    <p className="wv-log-said">
                      <img src={`/desk/agent-${said.who}.webp`} alt="" />
                      <b>{PORTRAITS[said.who]?.name ?? said.who}</b> “{said.text}”
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {days.length > 3 && (
        <button type="button" className="wv-link wv-log-all" onClick={() => setAll((v) => !v)}>
          {all ? "Just the last three days" : `Every day GitHub lists (${changes.length} changes)`}
        </button>
      )}
      <details className="wv-log-key">
        <summary>What the markers mean</summary>
        <ChangelogLegend changes={changes} />
      </details>
    </>
  );
}

/** Where an Undo stands, from the issue's labels: the Builder is reverting it, or the revert has shipped. */
function UndoMark({ change }: { change: Change }) {
  const done = change.undo === "done";
  return (
    <span className={`cl-undo cl-undo--${change.undo}`} title={done ? "Taken back: the revert shipped through the fix lane." : "The Builder reverts it through the fix lane and ships the revert once its checks are green."}>
      {done ? "Undone" : "Undo requested"}
      {done && change.reverted && (
        <a className="cl-entry__link" href={change.reverted.url} target="_blank" rel="noreferrer">
          {change.reverted.label}
        </a>
      )}
    </span>
  );
}

/**
 * Take back a change that shipped (docs/FOUNDRY.md, "Undo"): two taps, like Stop, so a stray one undoes nothing. The
 * issue opens again in the fix lane and the Builder ships a revert once its checks are green. Signed-in Desk only.
 */
function UndoChange({ issue, setup }: { issue: number; setup: Setup }) {
  const [mode, setMode] = useState<"idle" | "confirm" | "busy" | "done" | "failed" | "signin">("idle");
  if (!setup?.buttons) return null;
  const undo = async () => {
    setMode("busy");
    if ((await ensureSignedIn()) !== "ok") return setMode("signin");
    const r = await send(issue, "undo");
    if (r === "signed-out") return setMode("signin");
    if (r === "failed" || r === "held") return setMode("failed");
    setMode("done");
    expectChange();
  };
  if (mode === "done") return <span className="cl-undo cl-undo--requested">Undo requested</span>;
  if (mode === "failed") return <span className="fy-stop__note cl-undo__note">That didn't go through. Try again in a moment.</span>;
  if (mode === "signin") return <span className="fy-stop__note cl-undo__note">Sign in above to undo it.</span>;
  return mode === "confirm" || mode === "busy" ? (
    <span className="fy-stop cl-undo__ask">
      <button type="button" className="wv-btn is-sm" disabled={mode === "busy"} onClick={() => void undo()}>
        {mode === "busy" ? "Asking…" : "Yes, undo it"}
      </button>
      <button type="button" className="wv-btn is-sm is-ghost" disabled={mode === "busy"} onClick={() => setMode("idle")}>
        Keep it
      </button>
    </span>
  ) : (
    <button type="button" className="wv-btn is-sm is-ghost fy-stop__btn cl-undo__btn" onClick={() => setMode("confirm")} title={`Take back #${issue}: the Builder reverts it through the fix lane and ships the revert once its checks are green.`}>
      Undo
    </button>
  );
}
