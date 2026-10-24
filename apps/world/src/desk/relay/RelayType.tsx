import { useEffect, useMemo, useRef, useState } from "react";
import { formatWait } from "../deskData.ts";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { ago, gmailHref } from "../email/EmailSection.tsx";
import { LATE_MS, linkOf, startEmail, takeGmailReturn, useEmail, type EmailItem, type EmailLoad, type EmailStatus } from "../email/email.ts";
import { FACE, TypeField, type Share } from "./typefield.ts";
import "@fontsource-variable/syne/wght.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./relay.css";

/**
 * Relay, set in particle type (#414, after the receiver of #386 and rounds 8 and 9). The page leads with one figure:
 * how many emails need Nikita, set huge in dots (typefield.ts). Each of those mails owns a band of the figure, oldest
 * at the top: white where Blasto has a draft ready, blue where not, frayed where it has waited long. Beside it, the
 * docket says the same thing plainly: who, how long, whether there is a draft. Pointing at a row lights its band;
 * pointing at a band lights its row; Done sends the band out of the figure into Handled, and the figure re-forms.
 * FYI and Handled today stand smaller under it.
 *
 * Real data only: the figures come from the email agent's public counts (api/_email/status.ts), so a signed-out
 * visitor sees counts and states and nothing else. Who, the subjects, Blasto's advice and drafts come only in the
 * passkey session, every word wrapped in <Private>. While there is no count (no Gmail, the Vercel copy, a failed
 * read), the dots drift loose and the words say why. Nothing is ever sent from here: Gmail access is read-only, and
 * a draft is copied for Nikita to send himself. Timing shows only when a check is late or failed (Nikita, 2026-10-24).
 */

export type Flow = "live" | "slow" | "down" | "off";

export const flowOf = (load: EmailLoad, status: EmailStatus | null): Flow => {
  if (load !== "live" || !status) return "off";
  const l = linkOf(status);
  return l === "ok" ? "live" : l === "slow" ? "slow" : l === "down" ? "down" : "off";
};

const agoText = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** What's wrong with syncing, in a few words, or null when nothing is (then no time is shown at all). */
export function syncTrouble(load: EmailLoad, status: EmailStatus | null, now: number): string | null {
  if (load !== "live" || !status || status.gmail !== "connected" || status.agent === "waiting") return null;
  const last = status.lastCheck;
  if (status.agent === "error") return last ? `Last check failed · last good ${agoText(now - last)}` : "The last check failed";
  if (status.agent === "listening" && last !== null && now - last > LATE_MS) return `Sync is late · last check ${agoText(now - last)}`;
  return null;
}

/** The open mail of one kind, from the private list (empty when signed out). */
export const itemsOf = (items: EmailItem[] | undefined, kind: "needs" | "fyi"): EmailItem[] => (items ?? []).filter((i) => !i.done && (kind === "needs" ? i.kind === "needs-you" || i.kind === "unsorted" : i.kind === "fyi"));

/** A mail waiting this long is overdue: the row says so and its band frays all the way. */
const LATE_WAIT = 24 * 3_600_000;
const FRAY_FULL = 36 * 3_600_000;

const RETURN_TEXT: Record<string, string> = {
  connected: "Gmail is connected. Dialtone catches up on unread mail from the last two days, then watches new mail.",
  cancelled: "Connect Gmail was cancelled at Google. Nothing was connected.",
  refused: "That Connect Gmail link didn't match this session. Try again from here.",
  failed: "Google didn't hand over access. Try Connect Gmail again.",
};

const CREW = [
  { id: "static", name: "Static", role: "Lead" },
  { id: "dialtone", name: "Dialtone", role: "Sorts" },
  { id: "postmaster", name: "Blasto", role: "Drafts" },
];

const CHAIN = ["MacBook awake", "The hub", "Messages", "Sort and draft", "Your tap"];

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString()} ${many}`);

/** The headline, from the public state: always opens on the room's name. */
function headOf(load: EmailLoad, status: EmailStatus | null, need: number): { h: string; sub: string } {
  if (load === "off") return { h: "Relay's email lives on the Azure copy.", sub: "Dialtone and Blasto work the inbox there, where their keys are. Open the Desk on Azure to see who is waiting." };
  if (!status) return load === "failed" ? { h: "Relay isn't answering.", sub: "The email agent didn't answer this read. The page tries again every 30 seconds." } : { h: "Relay is listening…", sub: "Reading the email agent's counts." };
  if (status.gmail === "refused") return { h: "Relay's Gmail line needs reconnecting.", sub: "Google stopped accepting the connection. Reconnect and the line picks up where it left off." };
  if (status.gmail !== "connected" || status.agent === "waiting") return { h: "Relay is ready to connect.", sub: "Connect Gmail and Dialtone sorts from the next new mail; the figure sets itself once there is something to count." };
  if (!need) return { h: "Relay: nothing needs you.", sub: "Dialtone sorts each new mail within a minute. Anything that needs you stands up here, with Blasto's draft." };
  return { h: `Relay: ${plural(need, "email needs", "emails need")} you.`, sub: "" };
}

function CopyDraft({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="rp-btn is-pri"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? "Copied" : "Copy draft"}
    </button>
  );
}

function Row({ item, n, now, open, lit, onOpen, onLight, onDone }: { item: EmailItem; n: number; now: number; open: boolean; lit: boolean; onOpen: () => void; onLight: (on: boolean) => void; onDone: () => void }) {
  const wait = now - item.at;
  const late = wait > LATE_WAIT;
  const id = `rp-row-${item.id}`;
  return (
    <li className="rp-row" data-open={open || undefined} data-lit={lit || undefined} data-drafted={item.draft ? "" : undefined} onPointerEnter={() => onLight(true)} onPointerLeave={() => onLight(false)}>
      <button type="button" className="rp-row-h" aria-expanded={open} aria-controls={id} onClick={onOpen} onFocus={() => onLight(true)} onBlur={() => onLight(false)}>
        <span className="rp-row-n" aria-hidden="true">
          <i />
          {String(n + 1).padStart(2, "0")}
        </span>
        <span className="rp-row-who">
          <Private as="b">{item.from}</Private>
          <Private className="rp-row-s">{item.subject || item.summary}</Private>
        </span>
        <span className="rp-row-m">
          <time data-late={late || undefined}>{late ? `${formatWait(wait)} · overdue` : formatWait(wait)}</time>
          <small>{item.kind === "unsorted" ? "not read yet" : item.draft ? "draft ready" : "no draft"}</small>
        </span>
      </button>
      {open && (
        <div className="rp-row-x" id={id}>
          {item.summary && (
            <p className="rp-sum">
              <Private>{item.summary}</Private>
            </p>
          )}
          {item.action && (
            <p className="rp-act">
              <span>Dialtone suggests</span>
              <Private>{item.action}</Private>
            </p>
          )}
          {item.kind === "unsorted" && <p className="rp-note">Came in while the agent was paused: no model has read it.</p>}
          {item.advice && (
            <div className="rp-adv">
              <span className="rp-lbl">Blasto's advice</span>
              <Private as="p">{item.advice}</Private>
            </div>
          )}
          {item.draft && (
            <div className="rp-draft">
              <span className="rp-lbl">In your voice · only you send it</span>
              <Private block as="p">
                {item.draft}
              </Private>
            </div>
          )}
          <div className="rp-do">
            {item.draft && <CopyDraft text={item.draft} />}
            <a className="rp-btn" href={gmailHref(item.id)} target="_blank" rel="noopener noreferrer">
              Open in Gmail
            </a>
            <button type="button" className="rp-btn" onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function RelayType({ now }: { now: number }) {
  useEffect(() => startEmail(), []);
  const load = useEmail((s) => s.load);
  const status = useEmail((s) => s.status);
  const view = useEmail((s) => s.view);
  const busy = useEmail((s) => s.busy);
  const error = useEmail((s) => s.error);
  const privateFail = useEmail((s) => s.privateFail);
  const connect = useEmail((s) => s.connect);
  const disconnect = useEmail((s) => s.disconnect);
  const markDone = useEmail((s) => s.done);
  const auth = useDeskAuth((s) => s.auth.status);
  const signIn = useDeskAuth((s) => s.signIn);
  const [back] = useState(() => takeGmailReturn());
  useEffect(() => {
    if (back) void useEmail.getState().refresh();
  }, [back]);

  const flow = flowOf(load, status);
  const counted = load === "live" && !!status && status.gmail === "connected" && status.agent !== "waiting";
  const st = counted ? status : null;
  const needs = useMemo(() => [...itemsOf(view?.items, "needs")].sort((a, b) => a.at - b.at), [view]);
  const fyi = useMemo(() => itemsOf(view?.items, "fyi"), [view]);
  const needN = st ? (view ? needs.length : st.needsYou) : 0;
  const fyiN = st ? (view ? fyi.length : st.fyi) : 0;
  const drafted = needs.filter((i) => i.draft).length;
  const oldest = needs[0] ? now - needs[0].at : null;
  const head = headOf(load, status, needN);
  const trouble = syncTrouble(load, status, now);

  const [open, setOpen] = useState<string | null>(null);
  const [rowLit, setRowLit] = useState<number | null>(null);
  const [figLit, setFigLit] = useState<number | null>(null);
  const [fyiOpen, setFyiOpen] = useState(false);
  const lit = rowLit ?? figLit;
  const openIdx = open ? needs.findIndex((i) => i.id === open) : -1;

  const stage = useRef<HTMLElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const field = useRef<TypeField | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const fyiRef = useRef<HTMLDetailsElement>(null);
  const needsRef = useRef(needs);
  needsRef.current = needs;

  // One field per page: made once, laid out on resize and when the fonts arrive, torn down on unmount.
  useEffect(() => {
    const host = stage.current;
    const canvas = cv.current;
    if (!host || !canvas) return;
    const f = new TypeField(canvas, host, {
      hover: (s) => setFigLit(s),
      pick: (s) => {
        const it = needsRef.current[s];
        if (!it) return;
        setOpen(it.id);
        list.current?.querySelectorAll<HTMLElement>(".rp-row-h")[s]?.focus({ preventScroll: true });
      },
    });
    field.current = f;
    let raf = 0;
    const relay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => f.layout());
    };
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(relay) : null;
    ro?.observe(host);
    relay();
    void document.fonts?.load(`800 100px ${FACE}`).then(relay, () => undefined);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      f.destroy();
      field.current = null;
    };
  }, []);

  // Data into the field: the figures' text and the Need you bands. Only on data changes, never per frame.
  const shares: Share[] = useMemo(() => (view ? needs.map((i) => ({ drafted: !!i.draft, fray: (now - i.at) / FRAY_FULL })) : Array.from({ length: needN }, () => ({ drafted: false, fray: 0 }))), [view, needs, needN, now]);
  useEffect(() => {
    const f = field.current;
    if (!f) return;
    f.setShares(shares);
    f.setTexts({ need: st ? String(needN) : null, fyi: st ? String(fyiN) : null, done: st ? String(st.noise) : null });
  }, [shares, st, needN, fyiN]);
  useEffect(() => field.current?.light(lit), [lit]);
  useEffect(() => field.current?.select(openIdx >= 0 ? openIdx : null), [openIdx]);
  useEffect(() => {
    const r = requestAnimationFrame(() => field.current?.layout());
    return () => cancelAnimationFrame(r);
  }, [flow, counted]);

  const done = (i: number, id: string) => {
    field.current?.release(i);
    setOpen(null);
    setRowLit(null);
    void markDone(id);
  };

  const signedIn = auth === "in";
  const sub = st && needN ? (view ? [oldest !== null ? `The oldest has waited ${formatWait(oldest)}.` : "", drafted ? `Blasto has drafted ${drafted === needN ? (needN === 1 ? "it" : `all ${needN}`) : `${drafted} of ${needN}`}.` : "No drafts yet."].filter(Boolean).join(" ") : "Who they are, how long each has waited and Blasto's drafts show when you sign in.") : head.sub;

  return (
    <div className="rp" data-room="relay" data-flow={flow} data-counted={counted || undefined}>
      <header className="rp-bar">
        <p className="rp-lines">
          <span data-on={counted || undefined}>
            <i aria-hidden="true" />
            Line 1 · email · {counted ? (flow === "slow" ? "paused at the cap" : flow === "down" ? "one check missed" : "live") : load === "off" ? "on the Azure copy" : "waiting"}
          </span>
          <span>
            <i aria-hidden="true" />
            Line 2 · texts · waiting on the MacBook
          </span>
        </p>
        <ul className="rp-crew" aria-label="Relay's crew on shift">
          {CREW.map((c) => (
            <li key={c.id}>
              <img src={`/desk/agent-${c.id}.webp`} alt="" width={26} height={26} decoding="async" loading="lazy" />
              <b>{c.name}</b>
              <span>{c.role}</span>
            </li>
          ))}
        </ul>
      </header>

      <section className="rp-stage" ref={stage} aria-label="Relay at a glance">
        <canvas ref={cv} className="rp-cv" aria-hidden="true" />
        <div className="rp-fig">
          <span className="rp-glyph rp-glyph--need" data-glyph="need" aria-hidden="true" />
          <p className="rp-cap">
            <b>Need you</b>
            <span>{st ? `${needN.toLocaleString()} ${needN === 1 ? "is" : "are"} waiting on you` : "No count yet"}</span>
            {st && needN > 0 && view && <span className="rp-key"><i data-k="d" /> drafted <i data-k="n" /> no draft · frayed: a long wait</span>}
          </p>
          <div className="rp-minor">
            <button type="button" className="rp-mini" disabled={!st || !signedIn || !fyi.length} onClick={() => {
              setFyiOpen(true);
              requestAnimationFrame(() => fyiRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
            }} aria-label={st ? `For your information: ${fyiN}` : "For your information: no count yet"}>
              <span className="rp-glyph rp-glyph--mini" data-glyph="fyi" aria-hidden="true" />
              <b>FYI</b>
              <small>{st ? `${fyiN.toLocaleString()} noted, no reply` : "—"}</small>
            </button>
            <div className="rp-mini">
              <span className="rp-glyph rp-glyph--mini" data-glyph="done" aria-hidden="true" />
              <b>Handled</b>
              <small>{st ? `${st.noise.toLocaleString()} today, without you` : "—"}</small>
            </div>
          </div>
        </div>

        <div className="rp-docket">
          <h1 className="desk__title rp-h1">{head.h}</h1>
          {sub && <p className="rp-sub">{sub}</p>}
          {back && <p className={`rp-state${back === "connected" ? "" : " is-warn"}`}>{RETURN_TEXT[back]}</p>}
          {error && <p className="rp-state is-bad">{error}</p>}
          {trouble && (
            <p className="rp-state is-bad" role="status">
              {trouble}
            </p>
          )}
          {status?.agent === "paused" && counted && <p className="rp-state is-warn">The month's allowance is spent: new mail is still counted ({status.unsorted} so far) and waits for the month to turn.</p>}

          {load === "off" ? null : !signedIn ? (
            status && (
              <div className="rp-gate">
                <p>{counted ? `${plural(status.needsYou, "needs", "need")} you and ${status.fyi} ${status.fyi === 1 ? "is" : "are"} noted.` : "The mail itself waits behind your passkey."} Nothing personal shows until you sign in.</p>
                {auth === "out" && (
                  <button type="button" className="rp-btn is-pri" onClick={() => void signIn()}>
                    Sign in
                  </button>
                )}
              </div>
            )
          ) : !view ? (
            <p className={`rp-state${privateFail ? " is-warn" : ""}`}>{privateFail ? `Couldn't read your mail just now (${privateFail}). Trying again at the next check.` : "Reading…"}</p>
          ) : status?.gmail !== "connected" ? (
            <div className="rp-gate">
              <p>Connect Gmail and Dialtone sorts each new inbox mail, and Blasto drafts for the ones that need you. Read-only: nothing is sent, archived or deleted.</p>
              <button type="button" className="rp-btn is-pri" disabled={!view.canConnect || busy} onClick={() => void connect()} title={view.canConnect ? "Opens Google's consent page" : "Waiting for the Gmail keys on Azure (docs/GMAIL.md)"}>
                {busy ? "Opening Google…" : status?.gmail === "refused" ? "Reconnect Gmail" : "Connect Gmail"}
              </button>
              {!view.canConnect && <p className="rp-note">Waiting for the Gmail keys on the Azure copy.</p>}
            </div>
          ) : (
            <>
              {needs.length > 0 && (
                <ol className="rp-list" ref={list} aria-label="Mail that needs you, the longest waiting first">
                  {needs.map((i, n) => (
                    <Row
                      key={i.id}
                      item={i}
                      n={n}
                      now={now}
                      open={open === i.id}
                      lit={lit === n}
                      onOpen={() => setOpen(open === i.id ? null : i.id)}
                      onLight={(on) => setRowLit(on ? n : null)}
                      onDone={() => done(n, i.id)}
                    />
                  ))}
                </ol>
              )}
              {fyi.length > 0 && (
                <details className="rp-fyi" ref={fyiRef} open={fyiOpen} onToggle={(e) => setFyiOpen((e.currentTarget as HTMLDetailsElement).open)}>
                  <summary>
                    For your information <b>{fyi.length}</b>
                  </summary>
                  <ul>
                    {fyi.map((i) => (
                      <li key={i.id}>
                        <Private as="b">{i.from}</Private>
                        <Private>{i.summary || i.subject}</Private>
                        <time>{ago(i.at, now)}</time>
                        <a href={gmailHref(i.id)} target="_blank" rel="noopener noreferrer">
                          Open
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <footer className="rp-foot">
                <span>
                  {status ? `${status.newToday.toLocaleString()} in today · ${status.noise.toLocaleString()} handled without you` : ""}
                  {status && status.skipped > 0 ? ` · ${status.skipped} counted only` : ""}
                </span>
                <span className="rp-spend" title="This month's Claude spend for the email agent, against its own cap">
                  ${view.spend.usd.toFixed(2)} of ${view.spend.budget.toFixed(0)}
                </span>
                <button type="button" className="rp-btn is-sm" disabled={busy} onClick={() => void disconnect()}>
                  Disconnect Gmail
                </button>
              </footer>
            </>
          )}
        </div>
      </section>

      <section className="rp-texts" aria-label="Line 2, texts">
        <div>
          <p className="rp-eyb">Line 2 · iMessage and SMS</p>
          <h2>Waiting on the MacBook.</h2>
          <p>Once its hub is up, the people you owe a text join the figure above, with drafts in your voice that go only on your tap.</p>
        </div>
        <ol className="rp-chain">
          {CHAIN.map((c, i) => (
            <li key={c} data-at={i === 0 ? "" : undefined}>
              {c}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
