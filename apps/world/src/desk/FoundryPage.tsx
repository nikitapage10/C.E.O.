import { useEffect, useRef, useState } from "react";
import { MAX_IMAGES, isImage, uploadImage } from "./ideaImages.ts";
import { assignCrew, CREW, crewFor, crewLoad, crewOf, crewWork, expectChange, modelOf, nextUpkeep, pendingIdea, REPO, useFoundry, type Change, type Crate, type CrateKind, type CrateState, type CrewId } from "../foundry.ts";
import { LINK_STATE_LABEL, useSystems, type LinkState } from "../systems.ts";
import { DESK_ROOMS, FOUNDRY_THREAD, formatWait } from "./deskData.ts";
import { useDictation } from "./dictate.ts";
import { Avatar, PageHead, Panel } from "./ui.tsx";

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
const CREW_RUNG: Record<CrewId, string> = { semicolon: "Haiku", caret: "Opus", tessellate: "Sonnet or Opus" };
const CHECKS_LABEL: Record<LinkState, string> = { off: "No run yet", ok: "Green", slow: "Running", down: "Red" };
const HOUR = 3_600_000;

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
type Choice = "build" | "pass" | "revise" | "propose";
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

function useSetup(): Setup {
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

/** The Foundry thread checks the queue every 15 minutes (:06, :21, :36, :51); Desk clicks wait for the next check. */
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

/** "by 9:06 pm": when the crew will have picked a click up. */
function byCheck(): string {
  return `by ${new Date(nextCheck(Date.now())).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Rusty's background shaping takes a second or two; past this, an idea still marked for rewriting waits for the check. */
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

type Shaped = Pick<Crate, "title" | "pitch" | "size" | "builder">;

/**
 * A new idea: the function streams back Rusty's shaping (straight from Claude) and the GitHub issue as each is ready,
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
        const msg = JSON.parse(raw) as { shaping?: boolean; shape?: { title: string; pitch: string; size: Crate["size"]; builder: "Rusty" | "Rocky" }; issue?: number; error?: string };
        if (msg.shaping) result = "shaping";
        if (msg.shape) onShape({ title: msg.shape.title, pitch: msg.shape.pitch, size: msg.shape.size, builder: msg.shape.builder === "Rusty" ? "tessellate" : "caret" });
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
  const ideas = [...data.crates.filter((c) => c.kind === "idea" && c.state !== "shipped" && !pending.some((p) => p.number === c.number)), ...pending].sort((a, b) => (a.number < 0 ? Infinity : a.number) - (b.number < 0 ? Infinity : b.number));
  const decisions = data.crates.filter((c) => c.kind !== "idea" && (c.state === "ready" || c.state === "stuck"));
  const running = data.crates.filter((c) => c.kind !== "idea" && c.state === "working");
  const upkeep = data.crates.find((c) => c.kind === "upkeep");
  // Everything in flight: what the crew holds plus the queue nobody holds yet. Chat work is in here too.
  const inFlight = assignCrew(data.crates).size + upNext(data.crates).length;
  const toPick = ideas.filter((c) => !c.revising).length;
  const needs = decisions.length + (toPick ? 1 : 0);

  const parts: string[] = [];
  if (toPick) parts.push(`${toPick} ${toPick === 1 ? "idea is" : "ideas are"} waiting for your pick`);
  if (decisions.length) parts.push(`${decisions.length} ${decisions.length === 1 ? "thing needs" : "things need"} your OK`);
  const lead = !connected ? "Connecting to GitHub…" : parts.length ? `${parts.join(", and ")}.` : "Nothing needs you. The crew handles small fixes and upkeep on its own.";

  return (
    <div className="foundry-page" style={{ "--tone": DESK_ROOMS.foundry.accent } as React.CSSProperties}>
      <PageHead
        eyebrow="The coding crew"
        title="Foundry"
        room="foundry"
        lead={lead}
        aside={
          <div className="page-head__crew">
            {(Object.keys(CREW) as CrewId[]).map((id) => (
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

      <Panel eyebrow="Connections" className="fy-connections">
        <Connections setup={setup} />
      </Panel>

      <Panel eyebrow="Changelog" aside={<span className="badge">{data.changelog.length}</span>}>
        {data.changelog.length ? <Changelog changes={data.changelog} now={now} /> : <p className="quiet">{connected ? "Nothing shipped yet." : "Connecting to GitHub…"}</p>}
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

function IdeaCard({ crate, index, setup }: { crate: Crate; index: number; setup: Setup }) {
  const [mode, setMode] = useState<"idle" | "key" | "revise" | "busy" | "done" | "failed">("idle");
  const [pending, setPending] = useState<Choice | null>(null);
  const [key, setKey] = useState(storedKey);
  const [note, setNote] = useState("");
  const [result, setResult] = useState("");
  const ready = setup?.buttons ?? false;

  const go = async (choice: Choice, withKey = key) => {
    if (!withKey) {
      setPending(choice);
      setMode("key");
      return;
    }
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
      choice === "build" ? `Approved. The crew picks it up at the next check, ${byCheck()}.`
      : choice === "pass" ? "On the shelf. Rusty may bring it back another way."
      : r === "shaping" ? "Rusty is rewriting it with your notes now."
      : `Sent. Rusty rewrites it at the next check, ${byCheck()}.`,
    );
    // Rusty's rewrite lands a moment later; the quick polls pick it up.
    setMode("done");
    expectChange();
  };

  return (
    <article className={`fy-idea${crate.revising ? " fy-idea--revising" : ""}`}>
      <header className="fy-idea__head">
        <Avatar agent="Rusty" size="sm" room="foundry" />
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
          <p className="fy-idea__note">{setup?.shape && Date.now() - crate.updatedAt < SHAPING_MS ? "Rusty is shaping this now…" : `Waiting for Rusty: he picks up your notes at the next check, ${byCheck()}.`}</p>
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
              Build this
            </button>
            <button type="button" className="btn btn--sm" disabled>
              Revise
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
              What should change, or what should Rusty know?
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus maxLength={2000} />
            </label>
            <button type="submit" className="btn btn--go btn--sm" disabled={!note.trim()}>
              Send notes
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setMode("idle")}>
              Cancel
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

/** Nikita's own idea: say it or type it, and Rusty shapes it into a card like the morning ones. */
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
        {state === "shaping" && <em>On the board. Rusty is shaping it now.</em>}
        {state === "done" && <em>{ready ? `Sent. Rusty shapes it into a card at the next check, ${byCheck()}.` : "Copied. Paste it in the Foundry thread."}</em>}
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
        {dictation.listening ? "Listening… say the idea, then press the mic again." : "Your idea, said or typed. Rusty turns it into a card with a size and a builder."}
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
          {dictation.supported && (
            <button
              type="button"
              className={`fy-mic${dictation.listening ? " fy-mic--live" : ""}`}
              onClick={toggleMic}
              aria-pressed={dictation.listening}
              aria-label={dictation.listening ? "Stop listening" : "Say the idea"}
              title={dictation.listening ? "Stop listening" : "Say the idea"}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
                <path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              </svg>
            </button>
          )}
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
        {ready ? "Send to Rusty" : "Copy and open the thread"}
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
 * The crew and what is in flight, together: each member with every job they hold (past the first, clones of them on
 * the same model), then the queue nobody has picked up yet.
 */
function Crew({ now }: { now: number }) {
  const connected = useFoundry((s) => s.connected);
  const crates = useFoundry((s) => s.data.crates);
  const by = assignCrew(crates);
  const load = crewLoad(crates);
  const queue = upNext(crates);
  return (
    <>
      <ul className="fy-crew">
        {(Object.keys(CREW) as CrewId[]).map((id) => {
          const jobs = crates.filter((c) => by.get(c.number) === id).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.number - b.number);
          const tone: LinkState = jobs[0] ? CREW_STATE[jobs[0].state] : connected ? "ok" : "off";
          const clones = Math.max(0, load[id] - 1);
          return (
            <li key={id} className={`fy-crew__member fy-crew__member--${tone}`}>
              <div className="fy-crew__head">
                <span className="fy-crew__mark">
                  <Avatar agent={id} room="foundry" />
                  <i className={`fy-dot fy-dot--${tone}`} aria-hidden="true" />
                </span>
                <span className="fy-crew__name">
                  {CREW[id].name}
                  <small>
                    {CREW[id].job} · {CREW_RUNG[id]}
                  </small>
                </span>
                <span className="fy-crew__load">
                  {jobs.length ? `${jobs.length} ${jobs.length === 1 ? "job" : "jobs"}${clones ? ` · ${clones} ${clones === 1 ? "clone" : "clones"}` : ""}` : connected ? "Free" : "Not connected yet"}
                </span>
              </div>
              {jobs.length > 0 && (
                <ul className="fy-jobs">
                  {jobs.map((c, n) => (
                    <li key={c.number} className={`fy-job fy-job--${c.state}`}>
                      <a className="fy-job__n" href={c.url} target="_blank" rel="noreferrer">
                        #{c.number}
                      </a>
                      <a className="fy-job__title" href={c.url} target="_blank" rel="noreferrer">
                        {c.title}
                      </a>
                      <span className="fy-job__meta">
                        {n > 0 && <b className="fy-job__clone">Clone</b>}
                        {KIND_LABEL[c.kind]} · {modelOf(c, id)} · {formatWait(now - c.updatedAt)} ago
                      </span>
                      <span className={`pill pill--${CREW_STATE[c.state]}`}>
                        <i aria-hidden="true" />
                        {CRATE_STATE[c.state]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
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
      what: setup?.shape ? "Your idea goes up at once and Rusty shapes it in a second or two" : "Add CLAUDE_API_KEY in Vercel so Rusty shapes ideas on the spot",
      state: setup === null ? "off" : setup.shape ? "ok" : "slow",
      label: setup === null ? "Checking…" : setup.shape ? "Ready" : "Needs setup",
    },
    {
      name: "Queue check",
      what: "The Foundry thread picks up approved builds and red checks every 15 minutes",
      state: setup === null ? "off" : "ok",
      label: setup === null ? "Checking…" : "Every 15 min",
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
function Changelog({ changes, now }: { changes: Change[]; now: number }) {
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
    { name: "Queue check", what: "A red check opens a fix; the Foundry picks it up within 15 minutes", state: connected ? "ok" : "off", label: connected ? "Every 15 min" : "Not connected yet" },
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
        {(Object.keys(CREW) as CrewId[]).map((id) => {
          const crate = work[id];
          return (
            <li key={id}>
              <Avatar agent={id} room="foundry" />
              <span className="foundry-crew__job">{CREW[id].job}</span>
              <span className="foundry-crew__name">{CREW[id].name}</span>
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
