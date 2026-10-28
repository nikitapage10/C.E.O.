import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatWait } from "../deskData.ts";
import { Private } from "../Private.tsx";
import { useHide } from "../hide.ts";
import { useDeskAuth } from "../signin.ts";
import { ago, gmailHref } from "../email/EmailSection.tsx";
import { LATE_MS, linkOf, startEmail, takeGmailReturn, useEmail, type EmailItem, type EmailLoad, type EmailStatus } from "../email/email.ts";
import { RC, safeTitle, useFlow, type FlowLayoutFn, type FlowLine, type Pt } from "../flow/index.ts";
import { clamp, mixRgb, WHITE } from "../wvCanvas.ts";
import { arrivals, densityOf, filterPaths, homeward, keepOf, lenOf, rateOf, threadsOf, volumeOf, type Counts, type Sampled } from "./filter.ts";
import { startTexts, textsLine, useTexts } from "../texts/texts.ts";
import { TextsSection } from "../texts/TextsSection.tsx";
import "./relay.css";

/**
 * Relay, the filter (#429; Nikita, 2026-10-24: "the whole idea of Relay is it's supposed to be kind of like a filtering
 * animation… but without being corny"). Built on the Desk's flow kit (desk/flow), in Today's language: the day's mail
 * comes in from the left as a line of light (Gmail, and texts beside it once the MacBook's hub reports, #535; a
 * dashed bed until then), runs into Dialtone's sort, and splits. Most of it goes down to Handled and thins away there; FYI goes on, a
 * little thinner; and the few that need Nikita each run on as their own line to their own row in the docket on the
 * right. The counts drive it: the feed's density and pace follow the mail in today, each branch's share follows its
 * count, a new arrival runs a pulse down the branch it was sorted into, and Done sends that mail back down its line
 * and into Handled.
 *
 * Real data only: the counts come from the email agent's public status (api/_email/status.ts), so a signed-out visitor
 * sees counts and states and nothing else (the docket's rows are sealed, and no words rise). Who, the subjects,
 * Dialtone's summary, Blasto's advice and drafts come only in the passkey session, every word wrapped in <Private>;
 * the words that rise off the sort name a sender only then, and never while Hide is on. Nothing is sent from here:
 * Gmail access is read-only, and a draft is copied for Nikita to send. Timing shows only when a check is late or
 * failed (Nikita, 2026-10-24).
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

/** A mail waiting this long is overdue: its row says so, and its line frays all the way by FRAY_FULL. */
const LATE_WAIT = 24 * 3_600_000;
const FRAY_FULL = 36 * 3_600_000;
/** The most rows that get their own line (the rest are counted in the docket; a laptop stays smooth). */
const MAX_LINES = 12;
/** Signed out, the docket shows this many sealed rows at most. */
const MAX_SLOTS = 8;

const ACCENT = RC.relay!;
const HANDLED_RGB = mixRgb(ACCENT, "128,134,150", 0.55);
const FYI_RGB = mixRgb(ACCENT, WHITE, 0.3);
const DRAFTED_RGB = mixRgb(ACCENT, WHITE, 0.72);

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


const WORDS = ["Nothing", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString()} ${many}`);

/** The headline, from the public state. */
function headOf(load: EmailLoad, status: EmailStatus | null, need: number): { h: ReactNode; sub: string } {
  if (load === "off")
    return {
      h: (
        <>
          Relay's mail lives <em>on Azure.</em>
        </>
      ),
      sub: "Dialtone and Blasto work the inbox on the Azure copy, where their keys are. Open the Desk there to see who is waiting.",
    };
  if (!status)
    return load === "failed"
      ? { h: <>Relay <em>isn't answering.</em></>, sub: "The email agent didn't answer this read. The page tries again every 30 seconds." }
      : { h: <>Relay is <em>listening…</em></>, sub: "Reading the email agent's counts." };
  if (status.gmail === "refused") return { h: <>Gmail needs <em>reconnecting.</em></>, sub: "Google stopped accepting the connection. Reconnect and the line picks up where it left off." };
  if (status.gmail !== "connected" || status.agent === "waiting") return { h: <>Ready to <em>connect Gmail.</em></>, sub: "Connect Gmail and the line opens: Dialtone sorts each new mail, and only what needs you comes through." };
  if (!need) return { h: <>Nothing <em>needs you.</em></>, sub: "Dialtone sorts each new mail within a minute. Anything that needs you comes through to the right, with Blasto's draft." };
  return {
    h: (
      <>
        {need < WORDS.length ? WORDS[need] : need.toLocaleString()} <em>{need === 1 ? "needs you." : "need you."}</em>
      </>
    ),
    sub: "",
  };
}

function CopyDraft({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="fl-btn is-pri"
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

const lineOf = (id: string) => `n:${id}`;

function Row({ item, n, now, open, lit, wired, onOpen, onHot, onDone }: { item: EmailItem; n: number; now: number; open: boolean; lit: boolean; wired: boolean; onOpen: () => void; onHot: (on: boolean) => void; onDone: () => void }) {
  const wait = now - item.at;
  const late = wait > LATE_WAIT;
  const id = `rl-row-${item.id}`;
  return (
    <li className="rl-row" data-open={open || undefined} data-lit={lit || undefined} data-drafted={item.draft ? "" : undefined} data-wired={wired || undefined} onPointerEnter={() => onHot(true)} onPointerLeave={() => onHot(false)}>
      <i className="rl-end" data-rl-end={item.id} aria-hidden="true" />
      <button type="button" className="rl-row-h" aria-expanded={open} aria-controls={id} onClick={onOpen} onFocus={() => onHot(true)} onBlur={() => onHot(false)}>
        <span className="rl-row-n fl-num" aria-hidden="true">
          {String(n + 1).padStart(2, "0")}
        </span>
        <span className="rl-row-who">
          <Private as="b">{item.from}</Private>
          <Private className="rl-row-s">{item.subject || item.summary}</Private>
        </span>
        <span className="rl-row-m">
          <time className="fl-num" data-late={late || undefined}>
            {late ? `${formatWait(wait)} · overdue` : formatWait(wait)}
          </time>
          <small>{item.kind === "unsorted" ? "not read yet" : item.draft ? "draft ready" : "no draft"}</small>
        </span>
      </button>
      {open && (
        <div className="rl-row-x" id={id}>
          {item.summary && (
            <p className="rl-sum">
              <Private>{item.summary}</Private>
            </p>
          )}
          {item.action && (
            <p className="rl-act">
              <span className="fl-k">Dialtone suggests</span>
              <Private>{item.action}</Private>
            </p>
          )}
          {item.kind === "unsorted" && <p className="rl-note">Came in while the agent was paused: no model has read it.</p>}
          {item.advice && (
            <div className="rl-adv">
              <span className="fl-k">Blasto's advice</span>
              <Private as="p">{item.advice}</Private>
            </div>
          )}
          {item.draft && (
            <div className="rl-draft">
              <span className="fl-k">In your voice · only you send it</span>
              <Private block as="p">
                {item.draft}
              </Private>
            </div>
          )}
          <div className="rl-do">
            {item.draft && <CopyDraft text={item.draft} />}
            <a className="fl-btn" href={gmailHref(item.id)} target="_blank" rel="noopener noreferrer">
              Open in Gmail
            </a>
            <button type="button" className="fl-btn" onClick={onDone}>
              Done
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** One line the field draws, before the DOM gives it its points. */
interface Want {
  id: string;
  /** Where it ends: a CSS selector inside the stage. */
  end: string;
  kind: "handled" | "fyi" | "needs";
  rgb: string;
  spread?: number;
  /** Offset of its end, px (Handled comes in as a few threads that land side by side). */
  dy?: number;
}

export function RelayFilter({ now }: { now: number }) {
  useEffect(() => startEmail(), []);
  useEffect(() => startTexts(), []);
  const textsLoad = useTexts((s) => s.load);
  const textsStatus = useTexts((s) => s.status);
  const textsOn = !!textsStatus && textsStatus.hub === "listening" && now - textsStatus.at < 15 * 60_000;
  const textsOwed = textsOn ? textsStatus.owed : 0;
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
  const hidden = useHide((s) => s.on);
  const [back] = useState(() => takeGmailReturn());
  useEffect(() => {
    if (back) void useEmail.getState().refresh();
  }, [back]);

  const flow = flowOf(load, status);
  const counted = load === "live" && !!status && status.gmail === "connected" && status.agent !== "waiting";
  const st = counted ? status : null;
  const signedIn = auth === "in";
  const needs = useMemo(() => [...itemsOf(view?.items, "needs")].sort((a, b) => a.at - b.at), [view]);
  const fyi = useMemo(() => itemsOf(view?.items, "fyi"), [view]);
  const needN = st ? (view ? needs.length : st.needsYou) : 0;
  const fyiN = st ? (view ? fyi.length : st.fyi) : 0;
  const drafted = needs.filter((i) => i.draft).length;
  const oldest = needs[0] ? now - needs[0].at : null;
  const head = headOf(load, status, needN);
  const trouble = syncTrouble(load, status, now);
  const held = !!st && st.agent === "paused";
  const counts: Counts | null = useMemo(() => (st ? { total: Math.max(st.newToday, st.noise + fyiN + needN), handled: st.noise, fyi: fyiN, needs: needN } : null), [st, fyiN, needN]);

  const [open, setOpen] = useState<string | null>(null);
  const [rowHot, setRowHot] = useState<string | null>(null);
  const [lineHot, setLineHot] = useState<string | null>(null);
  const [fyiOpen, setFyiOpen] = useState(false);
  const [ghosts, setGhosts] = useState<{ id: string; path: Sampled }[]>([]);

  const stage = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const fyiRef = useRef<HTMLDetailsElement>(null);
  /** Each branch's path as last laid out, and the feed's length: Done's way home and the pulses' timing come from them. */
  const laid = useRef<{ paths: Map<string, Sampled>; feedLen: number }>({ paths: new Map(), feedLen: 0 });

  // The rows that get a line: the docket's own (signed in) or sealed slots (signed out, counts only).
  const slots = st && !view ? Math.min(MAX_SLOTS, needN) : 0;
  const fray = Math.floor(now / 600_000);
  const wants: Want[] = useMemo(() => {
    // Handled is the bulk of the day: a few threads side by side, as many as the feed has (at most three).
    const ht = st ? Math.min(3, threadsOf(Math.max(st.newToday, st.noise))) : 1;
    const w: Want[] = Array.from({ length: ht }, (_, k) => ({ id: k ? `handled:${k}` : "handled", end: "[data-rl=handled] i", kind: "handled" as const, rgb: HANDLED_RGB, dy: ht > 1 ? (k / (ht - 1) - 0.5) * 22 : 0 }));
    w.push({ id: "fyi", end: "[data-rl=fyi] i", kind: "fyi", rgb: FYI_RGB });
    if (!st) w.push({ id: "needs", end: "[data-rl=docket] .rl-dk", kind: "needs", rgb: ACCENT });
    else if (view)
      needs.slice(0, MAX_LINES).forEach((i) =>
        w.push({ id: lineOf(i.id), end: `[data-rl-end="${i.id}"]`, kind: "needs", rgb: i.draft ? DRAFTED_RGB : ACCENT, spread: 1.6 + 3.4 * clamp((fray * 600_000 - i.at) / FRAY_FULL, 0, 1) }),
      );
    else for (let k = 0; k < slots; k++) w.push({ id: `slot:${k}`, end: `[data-rl-end="slot-${k}"]`, kind: "needs", rgb: ACCENT });
    return w;
  }, [st, view, needs, slots, fray]);

  const layout = useCallback<FlowLayoutFn>(
    ({ rel, phone }) => {
      const root = stage.current;
      if (!root) return { lines: [] };
      const pt = (sel: string, at: "c" | "l" | "below" = "c"): Pt | null => {
        const el = root.querySelector(sel);
        if (!el) return null;
        const r = rel(el);
        if (!r.w && !r.h) return null;
        return at === "l" ? [r.x, r.y + r.h / 2] : at === "below" ? [r.x, r.y + r.h + 10] : [r.x + r.w / 2, r.y + r.h / 2];
      };
      const gate = pt("[data-rl=gate] i");
      const mail = pt("[data-rl=mail]", "below");
      const texts = pt("[data-rl=texts]", "below");
      if (!gate || !mail) return { lines: [] };
      const total = counts?.total ?? 0;
      const rate = rateOf(total);
      const live = wants
        .map((w) => {
          const e = pt(w.end, w.kind === "needs" && w.id === "needs" ? "l" : "c");
          return { w, end: e && w.dy ? ([e[0], e[1] + w.dy] as const) : e };
        })
        .filter((x): x is { w: Want; end: Pt } => !!x.end);
      const threads = counts ? threadsOf(total) : 1;
      const { feed, branches } = filterPaths([-12, mail[1] + (threads > 1 ? (phone ? 25 : 48) : 0)], gate, live.map((x) => x.end), { threads, spread: phone ? 50 : 96 });

      const needLines = live.filter((x) => x.w.kind === "needs").length;
      laid.current = { paths: new Map(), feedLen: lenOf(feed[0]!) };
      // The feed: the whole day's mail, one dense line into the sort. Held at the cap, it still runs (mail is counted)
      // but nothing goes on past the sort.
      const lines: FlowLine[] = feed.map((path, i) =>
        counts
          ? { id: i ? `mail:${i}` : "mail", path, density: volumeOf(total) * 0.8, rate: rate * (0.9 + 0.2 * ((i * 0.618) % 1)), spread: 3, bright: 0.9, knots: held && !i ? [1] : undefined }
          : { id: i ? `mail:${i}` : "mail", path, waiting: true },
      );
      live.forEach(({ w }, i) => {
        const path = branches[i]!;
        laid.current.paths.set(w.id, path);
        if (!counts || held) return void lines.push({ id: w.id, path, rgb: w.rgb, waiting: true });
        const keep = keepOf(w.kind, counts);
        lines.push({
          id: w.id,
          path,
          rgb: w.rgb,
          density: densityOf(w.kind, counts, needLines),
          rate: w.kind === "needs" ? rate * 0.8 : w.kind === "handled" ? rate * 0.7 : rate * 0.9,
          bright: w.kind === "handled" ? 0.75 : w.kind === "fyi" ? 0.8 : 1,
          spread: w.spread ?? (w.kind === "handled" ? 3.5 : 2.2),
          widen: w.kind === "handled" ? 2.4 : 0,
          // The filter: Handled thins away soon after the sort, FYI a little later; a needing mail goes all the way.
          thin: keep < 1 ? { at: w.kind === "handled" ? 0.42 : 0.6, keep } : undefined,
          knots: w.kind === "needs" ? [0.995] : undefined,
          bed: w.kind === "handled" ? 0.045 : undefined,
        });
      });
      // Texts: a dashed bed into the same sort until the MacBook's hub reports; then a live line, as busy as the replies
      // owed (#535). Never fake flow.
      if (texts)
        lines.push(
          textsOn
            ? { id: "texts", path: { from: [-12, texts[1]], to: gate, bend: -0.06 }, rgb: ACCENT, density: volumeOf(Math.max(4, textsOwed * 6)) * 0.6, rate: rateOf(Math.max(4, textsOwed * 6)) * 0.8, spread: 2.2, bright: 0.85 }
            : { id: "texts", path: { from: [-12, texts[1]], to: gate, bend: -0.06 }, waiting: true, rgb: ACCENT },
        );
      // Done: the mail's way home, drawn faint for the moment its pulse takes.
      for (const g of ghosts) lines.push({ id: g.id, path: g.path, rgb: HANDLED_RGB, density: 0, bright: 0, bed: 0.02 });
      return { lines, anchors: { sort: [gate[0], gate[1] - 34] } };
    },
    [wants, counts, held, ghosts, textsOn, textsOwed],
  );

  const { cv, field, bind } = useFlow(layout, {
    accent: ACCENT,
    ground: true,
    backing: 650_000,
    onHover: (id) => setLineHot(id),
    onPick: (id) => {
      if (id === "fyi") return openFyi();
      if (!id.startsWith("n:")) return;
      const mid = id.slice(2);
      setOpen(mid);
      list.current?.querySelector<HTMLElement>(`[data-rl-end="${mid}"] + .rl-row-h`)?.focus({ preventScroll: true });
    },
  });

  // The docket grows and shrinks (a row opens, the fonts arrive): the lines follow their rows.
  useEffect(() => {
    const el = stage.current?.querySelector("[data-rl=docket]");
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => field.relayout());
    ro.observe(el);
    void document.fonts?.ready.then(() => field.relayout(), () => undefined);
    return () => ro.disconnect();
  }, [field]);

  // The row pointed at or open is the line in focus; the others dim.
  useEffect(() => field.setFocus(rowHot ? lineOf(rowHot) : open ? lineOf(open) : null), [field, rowHot, open]);

  // New mail since the last read runs a pulse down the branch it was sorted into. Words rise only when signed in,
  // naming the sender only with Hide off.
  const prev = useRef<{ c: Counts; ids: Set<string> | null } | null>(null);
  const idKey = needs.map((i) => i.id).join(",");
  useEffect(() => {
    if (!counts) {
      prev.current = null;
      return;
    }
    const was = prev.current;
    const ids = view ? new Set(idKey ? idKey.split(",") : []) : null;
    prev.current = { c: counts, ids };
    if (!was) return;
    const a = arrivals(was.c, counts);
    const fresh = ids && was.ids ? needs.filter((i) => !was.ids!.has(i.id)) : [];
    // One arrival: a packet runs the feed into the sort, then on down the branch it was sorted into. The new lines
    // exist after the next layout, so the branch's packet waits for the feed's to arrive anyway.
    const FEED_V = 320;
    const via = (id: string, size = 10) => {
      field.pulse("mail", { speed: FEED_V, size });
      timers.push(window.setTimeout(() => field.pulse(id, { size }), (laid.current.feedLen / FEED_V) * 1000));
    };
    const timers: number[] = [];
    const t = window.setTimeout(() => {
      if (fresh.length) {
        for (const i of fresh.slice(0, 4)) {
          via(lineOf(i.id), 11);
          field.rise(hidden ? "needs you" : `${safeTitle(i.from) ?? "new mail"} · needs you`, { at: "sort" });
        }
      } else if (a.needs && !view) for (let k = 0; k < Math.min(a.needs, slots); k++) via(`slot:${slots - 1 - k}`, 11);
      if (a.fyi) {
        via("fyi");
        if (signedIn) field.rise(a.fyi === 1 ? "one for your information" : `${a.fyi} for your information`, { at: "sort" });
      }
      for (let k = 0; k < Math.min(3, a.handled); k++) timers.push(window.setTimeout(() => via("handled", 6), k * 300));
    }, 60);
    return () => {
      window.clearTimeout(t);
      timers.forEach((x) => window.clearTimeout(x));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, idKey]);

  const done = (item: EmailItem) => {
    const lid = lineOf(item.id);
    const need = laid.current.paths.get(lid);
    const handled = laid.current.paths.get("handled");
    field.burst(lid, { u: 1, n: 36, rgb: DRAFTED_RGB });
    const home = need && handled ? homeward(need, handled) : null;
    if (home) {
      const gid = `home:${item.id}`;
      setGhosts((g) => [...g, { id: gid, path: home }]);
      window.setTimeout(() => field.pulse(gid, { speed: 520, size: 10, rgb: DRAFTED_RGB }), 60);
      window.setTimeout(() => setGhosts((g) => g.filter((x) => x.id !== gid)), 3200);
    }
    field.rise(hidden ? "handled" : `${safeTitle(item.from) ?? "one"} · handled`, { at: "sort" });
    setOpen(null);
    setRowHot(null);
    void markDone(item.id);
  };

  const openFyi = () => {
    if (!signedIn || !fyi.length) return;
    setFyiOpen(true);
    requestAnimationFrame(() => fyiRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  const sub = st && needN ? (view ? [oldest !== null ? `The oldest has waited ${formatWait(oldest)}.` : "", drafted ? `Blasto has drafted ${drafted === needN ? (needN === 1 ? "it" : `all ${needN}`) : `${drafted} of ${needN}`}.` : "No drafts yet."].filter(Boolean).join(" ") : "Who they are, how long each has waited and Blasto's drafts show when you sign in.") : head.sub;
  const day = new Date(now).toLocaleDateString(undefined, { weekday: "long" });
  const mailState = counted ? (flow === "slow" ? "paused at the cap" : flow === "down" ? "one check missed" : "live") : load === "off" ? "on the Azure copy" : "waiting";
  const litId = lineHot?.startsWith("n:") ? lineHot.slice(2) : null;
  const n = (v: number | undefined) => (st && v !== undefined ? v.toLocaleString() : "—");

  return (
    <div className="wv-page fl-page rl" data-room="relay" data-flow={flow} data-counted={counted || undefined} style={{ "--fl-accent": ACCENT } as React.CSSProperties}>
      <section className="fl-stage rl-stage" ref={stage} aria-label="Relay at a glance" {...bind} data-hot={lineHot ?? undefined}>
        <canvas ref={cv} className="fl-cv" aria-hidden="true" />

        <header className="rl-head">
          <p className="fl-eyb">
            <span>Relay</span>
            <i />
            {day}
            <small className="rl-eyb-x"> · Dialtone sorts, Blasto drafts</small>
          </p>
          <h1 className="fl-h1 rl-h1">{head.h}</h1>
          {sub && <p className="fl-say">{sub}</p>}
          <dl className="fl-ledger rl-ledger">
            <div>
              <dt>In today</dt>
              <dd>{n(st?.newToday)}</dd>
            </div>
            <div>
              <dt>Handled</dt>
              <dd>{n(st?.noise)}</dd>
            </div>
            <div>
              <dt>Can wait</dt>
              <dd>{n(st ? fyiN : undefined)}</dd>
            </div>
            <div className={needN ? "is-hot" : undefined}>
              <dt>Need you</dt>
              <dd>{n(st ? needN : undefined)}</dd>
            </div>
          </dl>
        </header>

        <div className="rl-flow" aria-hidden="true">
          <p className="rl-src" data-rl="mail" data-on={counted || undefined}>
            <b>Gmail</b> {mailState}
          </p>
          <p className={`rl-src${textsOn ? "" : " is-wait"}`} data-rl="texts" data-on={textsOn || undefined}>
            <b>Texts</b> {textsOn ? textsLine(textsLoad, textsStatus, now).toLowerCase() : "waiting on the MacBook"}
          </p>
          <p className="rl-gate" data-rl="gate">
            <span>Dialtone sorts</span>
            <i />
          </p>
          <button type="button" tabIndex={-1} className="rl-sink" data-rl="fyi" disabled={!signedIn || !fyi.length} onClick={openFyi}>
            <i />
            <b className="fl-num">{n(st ? fyiN : undefined)}</b>
            <span>Can wait · kept, no ping</span>
          </button>
          <p className="rl-sink is-quiet" data-rl="handled">
            <i />
            <b className="fl-num">{n(st?.noise)}</b>
            <span>Handled today, without you</span>
          </p>
        </div>

        <div className="rl-docket" data-rl="docket">
          <p className="fl-k rl-dk">
            <span>Needs you</span> · {view && needs.length > 1 ? "the longest waiting first" : "each on its own line"}
          </p>
          {back && <p className={`rl-state${back === "connected" ? "" : " is-warn"}`}>{RETURN_TEXT[back]}</p>}
          {error && <p className="rl-state is-bad">{error}</p>}
          {trouble && (
            <p className="rl-state is-bad" role="status">
              {trouble}
            </p>
          )}
          {held && <p className="rl-state is-warn">The month's allowance is spent: new mail is still counted ({status?.unsorted ?? 0} so far) and waits at the sort for the month to turn.</p>}

          {load === "off" ? (
            <p className="rl-state">Nothing to read on this copy.</p>
          ) : !signedIn ? (
            status && (
              <>
                {slots > 0 && (
                  <ol className="rl-list is-sealed" aria-label="Mail that needs you, sealed until you sign in">
                    {Array.from({ length: slots }, (_, k) => (
                      <li key={k} className="rl-row is-slot" data-wired="" data-lit={lineHot === `slot:${k}` || undefined}>
                        <i className="rl-end" data-rl-end={`slot-${k}`} aria-hidden="true" />
                        <span className="rl-row-n fl-num">{String(k + 1).padStart(2, "0")}</span>
                        <span className="rl-row-who">
                          <b>Waiting on you</b>
                        </span>
                        <span className="rl-row-m">
                          <small>sealed</small>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {needN > slots && slots > 0 && <p className="rl-note">and {needN - slots} more</p>}
                <div className="rl-gate-in">
                  <p>{counted ? `${plural(status.needsYou, "needs", "need")} you and ${status.fyi} ${status.fyi === 1 ? "is" : "are"} noted.` : "The mail itself waits behind your passkey."} Who, what and Blasto's drafts show only when you sign in.</p>
                  {auth === "out" && (
                    <button type="button" className="fl-btn is-pri" onClick={() => void signIn()}>
                      Sign in
                    </button>
                  )}
                </div>
              </>
            )
          ) : !view ? (
            <p className={`rl-state${privateFail ? " is-warn" : ""}`}>{privateFail ? `Couldn't read your mail just now (${privateFail}). Trying again at the next check.` : "Reading…"}</p>
          ) : status?.gmail !== "connected" ? (
            <div className="rl-gate-in">
              <p>Connect Gmail and Dialtone sorts each new inbox mail, and Blasto drafts for the ones that need you. Read-only: nothing is sent, archived or deleted.</p>
              <button type="button" className="fl-btn is-pri" disabled={!view.canConnect || busy} onClick={() => void connect()} title={view.canConnect ? "Opens Google's consent page" : "Waiting for the Gmail keys on Azure (docs/GMAIL.md)"}>
                {busy ? "Opening Google…" : status?.gmail === "refused" ? "Reconnect Gmail" : "Connect Gmail"}
              </button>
              {!view.canConnect && <p className="rl-note">Waiting for the Gmail keys on the Azure copy.</p>}
            </div>
          ) : (
            <>
              {needs.length > 0 ? (
                <ol className="rl-list" ref={list} aria-label="Mail that needs you, the longest waiting first">
                  {needs.map((i, k) => (
                    <Row
                      key={i.id}
                      item={i}
                      n={k}
                      now={now}
                      open={open === i.id}
                      lit={litId === i.id}
                      wired={k < MAX_LINES}
                      onOpen={() => setOpen(open === i.id ? null : i.id)}
                      onHot={(on) => setRowHot(on ? i.id : null)}
                      onDone={() => done(i)}
                    />
                  ))}
                </ol>
              ) : (
                <p className="rl-clear fl-wait">The sort let nothing through. Quiet is the point.</p>
              )}
              {fyi.length > 0 && (
                <details className="rl-fyi" ref={fyiRef} open={fyiOpen} onToggle={(e) => setFyiOpen((e.currentTarget as HTMLDetailsElement).open)}>
                  <summary>
                    For your information <b className="fl-num">{fyi.length}</b>
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
              {view.urgentSkipped > 0 && (
                <p className="rl-state is-warn">
                  {view.urgentSkipped} urgent money or legal {view.urgentSkipped === 1 ? "alert" : "alerts"} skipped; check those accounts directly.
                </p>
              )}
              <footer className="rl-foot">
                <span>
                  {status ? `${status.newToday.toLocaleString()} in today · ${status.noise.toLocaleString()} handled without you` : ""}
                  {status && status.skipped > 0 ? ` · ${status.skipped} counted only` : ""}
                </span>
                <span className="rl-spend" title="This month's Claude spend for the email agent, against its own cap">
                  ${view.spend.usd.toFixed(2)} of ${view.spend.budget.toFixed(0)}
                </span>
                <button type="button" className="fl-btn is-sm" disabled={busy} onClick={() => void disconnect()}>
                  Disconnect Gmail
                </button>
              </footer>
            </>
          )}
        </div>
      </section>

      <TextsSection now={now} />
      <section className="fl-below rl-texts rl-crewband" aria-label="Relay's crew">
        <ul className="rl-crew" aria-label="Relay's crew on shift">
          {CREW.map((c) => (
            <li key={c.id}>
              <img src={`/desk/agent-${c.id}.webp`} alt="" width={30} height={30} decoding="async" loading="lazy" />
              <b>{c.name}</b>
              <span>{c.role}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
