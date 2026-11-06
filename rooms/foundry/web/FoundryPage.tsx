import { useMemo, useRef, useState } from "react";
import { mountainHour } from "@ceo/desk/ilyrTime.ts";
import { heldMessage, IdeaCard, nextCheck, propose, send, soon, useSetup, ideaTitle, type Setup } from "@ceo/desk/IdeaCard.tsx";
export { heldMessage, IdeaCard, ideaTitle, nextCheck, useSetup };
import { MAX_IMAGES, isImage, uploadImage } from "@ceo/desk/ideaImages.ts";
import { DeskSignIn } from "@ceo/engine/web/SignIn.tsx";
import { ensureSignedIn, useDeskAuth } from "@ceo/engine/web/signin.ts";
import { assignCrew, ideaCounts, openIdeas, CREW, CREW_ORDER, CREW_RANK, DOCK_CREW, crewFor, expectChange, MODEL, modelOf, pendingIdea, recentWork, REPO, rustyHands, sparesAwake, useFoundry, waitingTurn, withTrails, type Approval, type Change, type Crate, type CrateKind, type CrateState, type CrewId, type Origin } from "../../../apps/world/src/foundry.ts";
import type { LinkState } from "../../../apps/world/src/systems.ts";
import { FOUNDRY_THREAD, formatWait } from "@ceo/desk/deskData.ts";
import { useDictation } from "@ceo/desk/dictate.ts";
import { ago } from "@ceo/desk/foundryGraph.ts";
import { useUsage } from "../../../apps/world/src/usage.ts";
import { ChangePictures } from "@ceo/desk/ChangePictures.tsx";
import { Avatar } from "@ceo/desk/ui.tsx";
import { remarksByIssue, useWorldFeed, type Remark } from "../../../apps/world/src/chronicle.ts";
import { navigateTo } from "../../../apps/world/src/route.ts";
import { PORTRAITS } from "@ceo/desk/portraits.ts";
import { SetupAsks } from "@ceo/desk/skippy/SetupAsks.tsx";
import { RC } from "@ceo/desk/flow/index.ts";
import { countdown, nextRuns } from "@ceo/desk/crewRuns.ts";
import { FurnaceStage } from "./FurnaceStage.tsx";
import { ConsoleSigils } from "./ConsoleSigils.tsx";
import { BenchCard, CrewStations, RunsLine, VqaLine } from "./ForgeParts.tsx";
import { forgeLanes, queueOf } from "../data/forge.ts";
import { progressMap, progressWords, stepWords, type Progress } from "../data/progress.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import "./foundry.css";

/**
 * The Foundry's own Desk page (#432), on the Desk's flow kit with the Builder's forge orange. The stage leads: the
 * Deep Furnace (#813, FurnaceStage.tsx), the forge shaft in 3D where every job rises from the crucible through Work,
 * Pictures, the five checks and Ship, with the headline and what needs Nikita over it, filling the screen. Below it,
 * one console with four tabs (#922) instead of a long page: the ideas on the bench as cards with their pictures beside
 * the Suggest box, the crew at their stations (every job in hand and the queue one click deeper), the Changelog, and
 * the next runs, usage, Visual QA and connections. GitHub is read
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
const HOUR = 3_600_000;

/** The morning ideas come at 9:00 Mountain time. */
export function nextIdeas(now: number): number {
  const mt = mountainHour(now);
  let wait = Math.round((9 - mt) * 60) * 60_000;
  if (wait <= 0) wait += 24 * HOUR;
  return now + wait - (now % 60_000);
}

const inTime = (ms: number) => (ms < HOUR ? `in ${Math.max(1, Math.round(ms / 60_000))} min` : `in ${Math.round(ms / HOUR)} h`);
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ── The page ── */

export function FoundryPage({ now }: { now: number }) {
  const connected = useFoundry((s) => s.connected);
  useRoomReady(connected);
  const data = useFoundry((s) => s.data);
  const pending = useFoundry((s) => s.pending);
  const keptAt = useFoundry((s) => s.keptAt);
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
  // How far along each job in flight is, and roughly how long it has left (#488), recounted on the minute's tick.
  const progress = useMemo(() => {
    const { lanes, more } = forgeLanes(data.crates, data.prs ?? []);
    return progressMap([...lanes, ...more], usage.feed?.trails ?? null, data.timings ?? [], data.branches ?? [], now);
  }, [data.crates, data.prs, data.timings, data.branches, usage.feed, now]);
  const suggest = useRef<HTMLElement>(null);
  const deck = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<DeckTab>("ideas");
  // Each jump opens its tab first, then goes to it once it has drawn.
  const later = (f: () => void) => window.setTimeout(f, 30);
  const toSuggest = () => {
    setTab("ideas");
    later(() => {
      suggest.current?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
      window.setTimeout(() => suggest.current?.querySelector("textarea")?.focus({ preventScroll: true }), 400);
    });
  };
  const toIdea = (n: number) => {
    setTab("ideas");
    later(() => {
      const el = document.getElementById(`fo-idea-${n}`);
      el?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "center" });
      el?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
  };
  const toLog = () => {
    setTab("shipped");
    later(() => deck.current?.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" }));
  };
  const today = changelog.filter((c) => c.at >= new Date(now).setHours(0, 0, 0, 0)).length;
  const counts: Record<DeckTab, string> = {
    ideas: connected ? String(ideas.length) : "—",
    crew: connected ? String(inFlight) : "—",
    shipped: connected ? `${today} today` : "—",
    runs: countdown(nextRuns(new Date(now)).queue, new Date(now)).replace(/^in /, ""),
  };
  /** The tabs take the arrow keys, Home and End, as a tab list should. */
  const tabKeys = (e: React.KeyboardEvent) => {
    const i = DECK.findIndex((d) => d.id === tab);
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? DECK.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = DECK[(to + DECK.length) % DECK.length]!.id;
    setTab(next);
    document.getElementById(`fo-tab-${next}`)?.focus();
  };
  const stop = (c: Crate) => (c.auto ? <StopAuto crate={c} setup={setup} /> : null);

  return (
    <div className="foundry-page wv-page fl-page fo" data-room="foundry" style={{ "--fl-accent": RC.foundry } as React.CSSProperties}>
      {keptAt !== null && (
        <p className="fo-note fo-asof" role="status">
          As of {ago(keptAt, now)}, from this device; refreshing.
        </p>
      )}
      <FurnaceStage data={data} ideas={ideas} progress={progress} now={now} connected={connected} lead={lead} stop={stop} onSuggest={toSuggest} onIdea={toIdea} onShips={toLog} />

      {/* Under the furnace, one console instead of a long page (#922): the bench, the crew, what shipped and the
          clock, one at a time behind a row of tabs, so the page ends a screen below the furnace. */}
      <section ref={deck} className="fl-below fo-deck" aria-label="The forge's console">
        <ConsoleSigils />
        <div className="fo-deck-tabs" role="tablist" aria-label="Under the furnace" onKeyDown={tabKeys}>
          {DECK.map((d) => (
            <button key={d.id} id={`fo-tab-${d.id}`} type="button" role="tab" aria-selected={tab === d.id} aria-controls={`fo-panel-${d.id}`} tabIndex={tab === d.id ? 0 : -1} className={`fo-deck-tab${tab === d.id ? " is-on" : ""}`} onClick={() => setTab(d.id)}>
              <i className="fo-deck-chain" aria-hidden="true" />
              <span>{d.label}</span>
              <b className="fl-num">{counts[d.id]}</b>
            </button>
          ))}
        </div>
        <div id={`fo-panel-${tab}`} role="tabpanel" aria-labelledby={`fo-tab-${tab}`} className="fo-deck-p">
          {tab === "ideas" && (
            <div className="fo-bench">
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
            </div>
          )}
          {tab === "crew" && (
            <CrewStations data={data} progress={progress} now={now}>
              <details className="fo-more-d">
                <summary>
                  Every job in hand, and the queue <span className="fl-num">{inFlight}</span>
                </summary>
                <Crew now={now} setup={setup} progress={progress} />
              </details>
            </CrewStations>
          )}
          {tab === "shipped" && (
            <section className="fo-log fy-changelog" aria-label="Changelog">
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
          )}
          {tab === "runs" && (
            <div className="fo-flow2-r fo-runs-p">
              <RunsLine now={now} />
              {/* Usage, budgets and the connections live in the Boiler Room now (#647): one link, no copy. */}
              <a className="fo-usage-go" href="/boiler/controls" onClick={toControls}>
                <span className="fl-k">
                  <span>Usage</span>
                </span>
                <b>Usage → Boiler Room</b>
                <small>Meters, caps, switches, connections and keys</small>
              </a>
              <VqaLine />
              <SetupAsks room="foundry" />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** The Foundry's one usage link (#647): usage, budgets and connections are on Boiler Room > Controls. */
function toControls(e: React.MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigateTo("/boiler/controls" + window.location.search);
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

type DeckTab = "ideas" | "crew" | "shipped" | "runs";
/** The console's tabs under the furnace, left to right. */
const DECK: { id: DeckTab; label: string }[] = [
  { id: "ideas", label: "Ideas" },
  { id: "crew", label: "Crew and queue" },
  { id: "shipped", label: "Shipped" },
  { id: "runs", label: "On the clock" },
];

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
function Crew({ now, setup, progress }: { now: number; setup: Setup; progress: Map<number, Progress> }) {
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
                    const p = progress.get(c.number);
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
                          {p && (
                            <span className="fy-job__prog" title={stepWords(p)}>
                              {progressWords(p)}
                            </span>
                          )}
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
            {d.items.map((c, k) => {
              const who = c.by ?? crewFor({ kind: c.kind, rung: null });
              // The builder's own word on it, from the living Lattice's hourly step (docs/WORLD.md).
              const said = c.issue ? remarks.get(c.issue.number) : undefined;
              return (
                <div key={c.key} className={`wv-log-i cl-entry cl-origin--${c.origin}${c.pictures?.length ? " cl-entry--pics" : ""}${c.undo ? ` cl-entry--undo-${c.undo}` : ""}`} data-c={d.label === "Today" ? "ok" : undefined} data-who={who} style={{ "--i": Math.min(k, 12) } as React.CSSProperties}>
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
