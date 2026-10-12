import { useEffect, useRef, useState } from "react";
import { CREW, crewFor, crewWork, refreshFoundry, useFoundry, type Crate, type CrateKind, type CrateState, type CrewId } from "../foundry.ts";
import { LINK_STATE_LABEL, useSystems, type LinkState } from "../systems.ts";
import { DESK_ROOMS, FOUNDRY_THREAD, formatWait } from "./deskData.ts";
import { useDictation } from "./dictate.ts";
import { PageHead, Panel } from "./ui.tsx";

/**
 * The Foundry's own Desk page. Top to bottom: what needs you (the morning's ideas as cards you can build, pass on or
 * send back with notes, plus anything waiting for your OK), how things stand right now (checks, work running,
 * upkeep, the next ideas), the crew, and whether every connection is up. GitHub is read directly (see foundry.ts);
 * the idea buttons write through the Vercel function in api/foundry.ts.
 */

const KIND_LABEL: Record<CrateKind, string> = { fix: "Fix", build: "Build", upkeep: "Upkeep", idea: "Idea" };
const CRATE_STATE: Record<CrateState, string> = { queued: "Queued", working: "Working", ready: "Waiting for your OK", stuck: "Stuck", shipped: "Shipped" };
const CREW_STATE: Record<CrateState, LinkState> = { queued: "ok", working: "ok", ready: "slow", stuck: "down", shipped: "ok" };
const CREW_RUNG: Record<CrewId, string> = { semicolon: "Haiku", caret: "Sonnet · Opus", tessellate: "Cheapest that fits" };
const CHECKS_LABEL: Record<LinkState, string> = { off: "No run yet", ok: "Green", slow: "Running", down: "Red" };
const LATELY = 6;
const HOUR = 3_600_000;

/** Upkeep runs at :57 past every sixth hour (UTC), per the "Foundry: upkeep" routine. */
export function nextUpkeep(now: number): number {
  const d = new Date(now);
  d.setUTCMinutes(57, 0, 0);
  while (d.getTime() <= now || d.getUTCHours() % 6 !== 0) d.setTime(d.getTime() + HOUR);
  return d.getTime();
}

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

type Setup = { buttons: boolean; wake: boolean; direct: boolean } | null;
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
      .then((r) => (r.ok ? (r.json() as Promise<{ buttons: boolean; wake: boolean; direct?: boolean }>) : null))
      .then((s) => live && setSetup(s ? { buttons: s.buttons, wake: s.wake, direct: s.direct ?? false } : { buttons: false, wake: false, direct: false }))
      .catch(() => live && setSetup({ buttons: false, wake: false, direct: false }));
    return () => {
      live = false;
    };
  }, []);
  return setup;
}

async function send(issue: number | null, choice: Choice, key: string, note = ""): Promise<"ok" | "wrong-key" | "failed"> {
  try {
    const res = await fetch("/api/foundry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ issue, choice, key, note }) });
    if (res.status === 401) return "wrong-key";
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}

/* ── The page ── */

export function FoundryPage({ now }: { now: number }) {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const setup = useSetup();
  // The cards keep the thread's numbering (Build 1, 2, 3), so they go by issue number, not by last change.
  const ideas = data.crates.filter((c) => c.kind === "idea" && c.state !== "shipped").sort((a, b) => a.number - b.number);
  const decisions = data.crates.filter((c) => c.kind !== "idea" && (c.state === "ready" || c.state === "stuck"));
  const running = data.crates.filter((c) => c.kind !== "idea" && c.state === "working");
  const upkeep = data.crates.find((c) => c.kind === "upkeep");
  const lately = data.crates.filter((c) => c.kind !== "idea" && c.state !== "ready" && c.state !== "stuck").slice(0, LATELY);
  const toPick = ideas.filter((c) => !c.revising).length;
  const needs = decisions.length + (toPick ? 1 : 0);

  const parts: string[] = [];
  if (toPick) parts.push(`${toPick} ${toPick === 1 ? "idea is" : "ideas are"} waiting for your pick`);
  if (decisions.length) parts.push(`${decisions.length} ${decisions.length === 1 ? "thing needs" : "things need"} your OK`);
  const lead = !connected ? "Connecting to GitHub…" : parts.length ? `${parts.join(", and ")}.` : "Nothing needs you. The crew handles small fixes and upkeep on its own.";

  return (
    <div className="foundry-page" style={{ "--tone": DESK_ROOMS.foundry.accent } as React.CSSProperties}>
      <PageHead
        eyebrow="Desk · Foundry"
        title="Foundry"
        lead={lead}
        aside={
          <a className="foundry-page__open" href={FOUNDRY_THREAD} target="_blank" rel="noreferrer">
            Open the Foundry thread →
          </a>
        }
      />

      <section className="fy-needs" aria-label="Needs you">
        <header className="section-head">
          <h2>Needs you</h2>
          <span className="panel__rule" aria-hidden="true" />
          <span className="badge">{needs}</span>
        </header>
        {setup !== null && !setup.buttons && <SetupNote />}
        {decisions.length > 0 && (
          <ul className="fy-decisions">
            {decisions.map((c) => (
              <li key={c.number} className={`fy-decision fy-decision--${c.state}`}>
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
      </section>

      <section className="fy-status" aria-label="Right now">
        <Tile label="Checks" tone={data.checks.state === "pass" ? "ok" : data.checks.state === "fail" ? "down" : data.checks.state === "running" ? "slow" : "off"} href={data.checks.url ?? undefined}>
          {data.checks.state === "pass" ? "All green" : data.checks.state === "fail" ? "Red, Skippy is on it" : data.checks.state === "running" ? "Running" : "No run yet"}
        </Tile>
        <Tile label="Work running" tone={running.length ? "ok" : "off"} href={running[0]?.url}>
          {running.length ? `${running.length} · ${running[0]!.title}` : "Nothing right now"}
        </Tile>
        <Tile label="Upkeep" tone={upkeep?.state === "working" ? "ok" : "off"} href={upkeep?.url}>
          {upkeep?.state === "working" ? `Working: ${upkeep.title}` : upkeep ? `Last: ${upkeep.title}` : "None yet"}
          <small>Next run {inTime(nextUpkeep(now) - now)}</small>
        </Tile>
        <Tile label="Next ideas" tone="off">
          9:00 Mountain
          <small>{inTime(nextIdeas(now) - now)}</small>
        </Tile>
      </section>

      <div className="fy-row">
        <Panel eyebrow="The crew">
          <Crew />
        </Panel>
        <Panel eyebrow="Connections">
          <Connections setup={setup} />
        </Panel>
      </div>

      <Panel eyebrow="Lately" aside={<span className="badge">{lately.length}</span>}>
        {lately.length ? <CrateList crates={lately} now={now} /> : <p className="quiet">Nothing yet. Fixes, builds and upkeep show here as the crew works.</p>}
      </Panel>
    </div>
  );
}

function Tile({ label, tone, href, children }: { label: string; tone: LinkState; href?: string; children: React.ReactNode }) {
  const body = (
    <>
      <span className="fy-tile__label">
        <i className={`fy-dot fy-dot--${tone}`} aria-hidden="true" />
        {label}
      </span>
      <span className="fy-tile__value">{children}</span>
    </>
  );
  return href ? (
    <a className="fy-tile" href={href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <div className="fy-tile">{body}</div>
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
    setResult(choice === "build" ? "Approved. Rocky is starting on it." : choice === "pass" ? "Passed. It won't come back." : "Sent. Rusty is rewriting it.");
    // Through the thread, the labels change a moment later; the next poll picks them up.
    setMode("done");
    void refreshFoundry();
  };

  return (
    <article className={`fy-idea${crate.revising ? " fy-idea--revising" : ""}`}>
      <header className="fy-idea__head">
        <span className="fy-idea__n">{index}</span>
        {crate.size && <span className="fy-idea__size">{crate.size}</span>}
        <a className="fy-idea__link" href={crate.url} target="_blank" rel="noreferrer">
          #{crate.number}
        </a>
      </header>
      <h3 className="fy-idea__title">{ideaTitle(crate.title)}</h3>
      {crate.pitch && <p className="fy-idea__pitch">{crate.pitch}</p>}
      <footer className="fy-idea__foot">
        {crate.revising ? (
          <p className="fy-idea__note">Rusty is rewriting this with your notes.</p>
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
        <code>FOUNDRY_ROUTINE_TOKEN</code>, the Foundry routine's token (the same one as the GitHub secret). A click then wakes the Foundry, which makes the change on GitHub itself.
      </p>
    </aside>
  );
}

/** Nikita's own idea: say it or type it, and Rusty shapes it into a card like the morning ones. */
function Propose({ setup }: { setup: Setup }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [key, setKey] = useState(storedKey);
  const [state, setState] = useState<"idle" | "busy" | "done" | "failed" | "wrong-key">("idle");
  // What was typed before the mic started; dictation appends to it.
  const typed = useRef("");
  const dictation = useDictation((finished, tail) => setNote(`${typed.current}${typed.current && (finished || tail) ? " " : ""}${finished}${finished && tail ? " " : ""}${tail}`));
  const ready = setup?.buttons ?? false;
  const submit = async () => {
    dictation.stop();
    setState("busy");
    const r = await send(null, "propose", key.trim(), note);
    if (r === "ok") {
      storeKey(key.trim());
      setNote("");
      setState("done");
      void refreshFoundry();
    } else setState(r);
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
        {state === "done" && <em>{ready ? "Sent. Rusty is shaping it into a card." : "Copied. Paste it in the Foundry thread."}</em>}
      </button>
    );
  return (
    <form
      className="fy-propose fy-idea__form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!note.trim()) return;
        if (!ready) void handOver().then(() => setOpen(false));
        else if (key.trim()) void submit().then(() => setOpen(false));
      }}
    >
      <label>
        {dictation.listening ? "Listening… say the idea, then press the mic again." : "Your idea, said or typed. Rusty turns it into a card with a size and a builder."}
        <span className="fy-propose__box">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus maxLength={2000} placeholder="What should the Foundry build?" />
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
      {ready && (!storedKey() || state === "wrong-key") && (
        <label>
          {state === "wrong-key" ? "That key didn't match. Try again." : "Your Desk key (asked once on this device)"}
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password" />
        </label>
      )}
      {state === "failed" && <p className="fy-idea__note">That didn't go through. Try again.</p>}
      {!ready && setup !== null && <p className="fy-idea__note fy-idea__note--quiet">Sending straight from here needs the Vercel variables above. Until then this copies your idea and opens the Foundry thread to paste it.</p>}
      <button type="submit" className="btn btn--go btn--sm" disabled={!note.trim() || (ready && !key.trim()) || state === "busy" || setup === null}>
        {ready ? "Send to Rusty" : "Copy and open the thread"}
      </button>
      <button type="button" className="btn btn--quiet btn--sm" onClick={() => (dictation.stop(), setOpen(false))}>
        Cancel
      </button>
    </form>
  );
}

function Crew() {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const work = crewWork(data.crates);
  return (
    <ul className="fy-crew">
      {(Object.keys(CREW) as CrewId[]).map((id) => {
        const crate = work[id];
        const tone: LinkState = crate ? CREW_STATE[crate.state] : connected ? "ok" : "off";
        return (
          <li key={id} className="fy-crew__member">
            <span className={`fy-crew__mark fy-crew__mark--${tone}`} aria-hidden="true">
              {CREW[id].name[0]}
            </span>
            <span className="fy-crew__name">
              {CREW[id].name}
              <small>
                {CREW[id].job} · {CREW_RUNG[id]}
              </small>
            </span>
            <span className="fy-crew__on">
              {crate ? (
                <a href={crate.url} target="_blank" rel="noreferrer">
                  {CRATE_STATE[crate.state]}: {crate.title}
                </a>
              ) : connected ? (
                "Free"
              ) : (
                "Not connected yet"
              )}
            </span>
          </li>
        );
      })}
    </ul>
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
      what: setup?.direct ? "Build, Revise and Not this one change GitHub at once" : "Build, Revise and Not this one go to the Foundry, which changes GitHub",
      state: setup === null ? "off" : setup.buttons ? "ok" : "slow",
      label: setup === null ? "Checking…" : setup.buttons ? "Ready" : "Needs setup",
    },
    {
      name: "Wake routine",
      what: "Your clicks on the Desk wake the Foundry thread",
      state: setup === null ? "off" : setup.wake ? "ok" : "slow",
      label: setup === null ? "Checking…" : setup.wake ? "Ready" : "Needs setup",
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

function CrateList({ crates, now }: { crates: Crate[]; now: number }) {
  return (
    <ul className="crates">
      {crates.map((c) => (
        <li key={c.number} className={`crates__item crates__item--${c.state}`}>
          <span className="crates__kind">{KIND_LABEL[c.kind]}</span>
          <a className="crates__title" href={c.url} target="_blank" rel="noreferrer">
            {c.title}
          </a>
          <span className="crates__who">
            {CREW[crewFor(c)].name} · {formatWait(now - c.updatedAt)} ago
          </span>
          <span className={`pill pill--${CREW_STATE[c.state]}`}>
            <i aria-hidden="true" />
            {CRATE_STATE[c.state]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The Foundry's system: the checks on GitHub wake the Foundry thread in Claude Code, which ships to main. */
export function FoundrySystem() {
  const connected = useFoundry((s) => s.connected);
  const data = useFoundry((s) => s.data);
  const checks = useSystems((s) => s.links.find((l) => l.id === "checks")?.state ?? "off");
  const work = crewWork(data.crates);
  const steps: { name: string; what: string; state: LinkState; label: string }[] = [
    { name: "Checks", what: "Types, lint, tests and build on every push to main, on GitHub", state: checks, label: checks === "off" ? "No run yet" : LINK_STATE_LABEL[checks] },
    { name: "Wake routine", what: "A red check opens a fix and wakes the Foundry", state: connected ? "ok" : "off", label: connected ? "Watching" : "Not connected yet" },
    { name: "Foundry thread", what: "Fixes, upkeep and builds, coded in Claude Code on your plan, each on its own branch and pull request", state: connected ? "ok" : "off", label: connected ? "Ready" : "Not connected yet" },
    { name: "main → the site", what: "Small fixes and upkeep merge once green; bigger work gets a preview and waits for you", state: connected ? "ok" : "off", label: connected ? "Shipping" : "Not connected yet" },
  ];
  return (
    <section className="foundry-system" aria-label="The Foundry's system" style={{ "--tone": DESK_ROOMS.foundry.accent } as React.CSSProperties}>
      <header className="section-head">
        <h2>Foundry · coding in Claude Code</h2>
        <span className="panel__rule" aria-hidden="true" />
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
