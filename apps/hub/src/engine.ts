import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readRelayStatus, RELAY_STATUS_VERSION, type RelayStatus } from "@ceo/core";
import { CAPS, readDraft, readSort, within, type Line, type StyleProfile } from "../../../api/_relay/models.ts";
import { CARD_KEEP_MS, readTapback, readTextRequest, REASONS, RID, type Reason, type TapbackState, type RequestResult, type TextCard, type TextItem, type TextsView } from "../../../api/_relay/texts.ts";
import { maskHandle, matchContacts } from "../../../api/_relay/compose.ts";
import { requestSigned } from "../../../api/_relay/tokens.ts";
import { bigGroup, BlueBubblesError, channelOf, isGroupChat, mediaOnly, sendReason, type BlueBubbles, type Contact, type Inbound, type Message } from "./bluebubbles.ts";
import type { HubConfig } from "./config.ts";
import type { Logger } from "./log.ts";
import { Placeholders } from "./placeholders.ts";
import { photoIdOf } from "../../../api/_relay/photos.ts";
import { closingReply, onlyAcks } from "../../../api/_email/intentWords.ts";
import { statusOf, syncPhotos, type Resize } from "./photos.ts";
import { settleByRule } from "./rules.ts";
import { isEnder, UNREAD_ENDER_MS } from "./enders.ts";
import type { Site } from "./site.ts";
import { MAX_OLDER_ROWS, newThreadId, type Held, type Card, type CardTarget, type Day, type RelayState, type StateStore, type Thread } from "./store.ts";
import { MAX_ASIDE, MAX_ITEMS, MEDIA_TEXT, MAX_OLDER, OLDER_WINDOW_MS, OWED_WINDOW_MS, owedWindow, SHOWN_KEEP_MS, type AsideItem, type AsideWhy, type GistWait, type OlderItem } from "../../../api/_relay/texts.ts";
import { readLearn, type DraftVoice, type Relation, type Voice } from "../../../api/_relay/voice.ts";
import { allChats, emptySort, finish, judgeChat, place, scanWants } from "./backlog.ts";
import { chatPerson, handleKey, LEARN_MIN, LEARN_WINDOW_MS, sampleSent, voiceStats, type Said } from "./learn.ts";

/**
 * Relay's texts line on the Mac (#535, docs/RELAY-PRIVACY.md): the engine the launchd job runs.
 *
 *   in     `poll` reads new messages from BlueBubbles every 5 seconds (#749) and hands each to `onMessage`. Paused, it is ignored.
 *          Nikita's own message settles the thread as replied. Anything else is settled by rule on the Mac (skip
 *          list, money and legal, short codes, one-time codes, promos: ./rules.ts) or marked owed and queued.
 *   sort   `work` reads the thread's last messages from BlueBubbles into memory, swaps names and numbers for
 *          placeholders, trims, and sends the snippet to the site for Dialtone (Haiku): a reply owed or not, sooner or
 *          normal, a one-line gist. A group gets a two-sentence summary and never a draft.
 *   draft  for an owed one-to-one thread, only when Nikita asks (#923: "Write for me", a `draft` request, or his own
 *          dictated words, a `restyle`), the same for Blasto (Sonnet), with up to 8 of Nikita's own past replies to
 *          that contact as style examples. Names go back in only on the Mac, into the draft.
 *   out    the counts (RelayStatus) and the who's-waiting list (names, gists, drafts) go to the site; no message body.
 *   act    the Desk's requests, polled from the site. A send goes out through BlueBubbles only when its signature,
 *          its 10 minutes, its single use and its thread and draft all check out here (`act`). Nothing else in the hub
 *          calls `bb.send`. A tapback (#888) is the same: signed, 10 minutes, once, on a line the Desk was shown, whose
 *          message guid only this Mac knows (`lines`); only `act` calls `bb.react`, and it settles nothing.
 *   card   a new text Skippy asked for (#536, a "compose" request): the contact found here, on the Mac, by name (the
 *          choices when it fits several, never a guess), the rules run over the ask and every past text used as a
 *          style example, Blasto writes it from the placeholdered ask, and the card (name, last 4 digits or a masked
 *          address, the text) goes to the site with the list. Its send is an ordinary send request, through `act`.
 *   backlog  on start and on the Desk's Rescan (#758): every chat's last message from BlueBubbles' chat query, sorted
 *          on the Mac (./backlog.ts): owed within 30 days (oldest first, queued like a new text), older folded into
 *          a count, rules and acknowledgements settled, groups left alone. Read state marks a row unread, never hides it.
 *   unread a one-to-one chat Nikita keeps unread in Messages (#924) is owed for 60 days: Dialtone's "no reply needed"
 *          and closing intent are held off (`held`) until their latest text is read; the rules still settle it, Done
 *          still holds until they write again, and a group stays summary-only.
 *   learn  "Learn from my texts" (#758): the last 12 months of messages read once into memory; numeric style stats
 *          over all of Nikita's sent texts, and a stratified, placeholdered sample for one Sonnet call through the
 *          site (./learn.ts). The traits and stats are kept and go with every draft.
 *
 * Logs carry kinds and counts only (./log.ts). Message text lives in memory for one call at a time.
 */

export const OVERDUE_MS = 24 * 60 * 60_000;
/** What a model call sees in place of a photo or file with no words (#870): a marker, never the attachment. */
export const MEDIA_LINE = "[a photo or attachment]";
/** The gist of a thread that is only photos or files (#870): the hub's own words; no model reads it. */
export const MEDIA_GIST = "Sent a photo or attachment.";
/** The hub's own line for an unread tapback on Nikita's message (#950). */
export const REACTION_GIST = "Reacted to your message.";
/** The set-asides an unread chat waits out (#950): listed while Messages shows it unread, settled once it is read. */
const UNREAD_HELD: readonly Held[] = ["no-reply", "closing", "ender", "group", "code", "short-code", "promo"];
/** The hub's own line for an unread chat a rule keeps from the models (#950): listed, never read by one. */
export const RULE_GIST: Record<"code" | "short-code" | "promo", string> = { code: "A code or verification text, unread.", "short-code": "An automated sender, unread.", promo: "Marketing, unread." };
/** Why a one-to-one thread is set aside, as the Desk may see it (#870). The skip list and groups never show. */
const ASIDE_OF: Partial<Record<string, AsideWhy>> = { "no-reply": "no-reply", closing: "closing", done: "done", money: "money", code: "code", "short-code": "short-code", promo: "promo", ender: "ender" };
/**
 * A chat of several moved across the group line (#916, GROUP_MIN_PEOPLE): one that becomes a group loses its gist,
 * sort and draft (a group is never drafted for); one that becomes a regular chat loses its summary, and a group's
 * settle no longer holds it, so their next text makes it owed like any one-to-one thread.
 */
function regroup(t: Thread, group: boolean) {
  if (t.group === group) return;
  t.group = group;
  if (group) Object.assign(t, { draft: null, gist: "", sort: null });
  else {
    t.summary = null;
    if (t.state === "settled" && t.why === "group") t.why = null;
  }
}

/** How long the engine waits after the latest message before it sorts, so a burst of texts is one call. */
export const SETTLE_MS = 20_000;

/** What became of one request: a result, with a reason code for a refusal or a failure (#767). */
type Outcome = RequestResult | { result: RequestResult; reason: Reason };
export const THREAD_KEEP_MS = 7 * 24 * 60 * 60_000;
export const DRAFT_KEEP_MS = 7 * 24 * 60 * 60_000;
export const SUMMARY_KEEP_MS = 48 * 60 * 60_000;
export const LATER_KEEP_MS = 14 * 24 * 60 * 60_000;
export const SEEN_KEEP_MS = 24 * 60 * 60_000;
/** How often `serve` polls BlueBubbles for new messages (#749). */
export const POLL_MS = 5_000;
/** How far back each poll reaches past its cursor, for a message Messages writes a moment late. */
export const POLL_OVERLAP_MS = 2 * 60_000;
/** The most a catch-up reaches back, after the hub was off (a longer gap is left to Messages). */
export const CATCH_UP_MS = 24 * 60 * 60_000;
export const POLL_PAGE = 200;
export const POLL_PAGES = 10;
/** The backlog reads chats 1,000 a page (BlueBubbles' most), 10 pages at most. */
export const CHAT_PAGE = 1_000;
export const CHAT_PAGES = 10;
/** The most chats whose newest real message the backlog reads one by one (a reaction or a photo was last). #803: 40 left
 * many recent chats (a tapback last is common) out of the list altogether; each is one local BlueBubbles read. */
export const CHECK_MAX = 200;
/** The most chats the full scan reads one by one (#950), newest first: every chat active within SCAN_REACH_MS, and every unread one. */
export const SCAN_READ_MAX = 800;
/** The most threads one read check looks at (#924): the owed ones (held first), then the set-aside ones. Local reads only. */
export const RECHECK_MAX = 40;
/** The learn pass reads the year 1,000 messages a page, 80 pages at most. */
export const LEARN_PAGE = 1_000;
export const LEARN_PAGES = 80;
/** What the Desk shows of a thread's own texts (#758): the newest 5 with words, 1,000 characters in all (the sort window). */
export const SHOWN_MESSAGES = 5;
export const SHOWN_CHARS = 1_000;
/** The older-unanswered snapshot is dropped this long after the scan that made it. */
export const OLDER_KEEP_MS = 7 * 24 * 60 * 60_000;
/**
 * The most threads one round of `work` sorts (#861): a 100-thread backlog goes a few at a time, newest first, so the
 * Desk's sends and the list's pushes never wait behind it, and the site and Anthropic aren't hit in one burst.
 */
export const WORK_PER_ROUND = 6;
/** When a sort that didn't land is tried again (#861): a failed call backs off from 2 minutes to an hour; the cap waits 6 hours. */
export const RETRY_MIN_MS = 2 * 60_000;
export const RETRY_MAX_MS = 60 * 60_000;
export const RETRY_CAP_MS = 6 * 60 * 60_000;
/** Dialtone's answer failed the checks this many times in a row: the thread waits for the next scan instead of looping. */
export const REFUSED_MAX = 3;

/** Why a sort call threw (#861): the site answered 502 for a failed model call; anything else is the site or the way there. */
export function waitOf(e: unknown): GistWait {
  const status = e && typeof e === "object" && "status" in e ? (e as { status: unknown }).status : 0;
  return status === 502 ? "model" : "site";
}

/** A message guid as the state file keeps it (#749): 16 hex of its SHA-256, never the guid. */
const guidHash = (guid: string) => createHash("sha256").update(guid).digest("hex").slice(0, 16);

export interface EngineDeps {
  store: StateStore;
  bb: BlueBubbles;
  site: Site;
  log: Logger;
  config: HubConfig;
  /** The pairing's send key (the Keychain's send-key), which every Desk request must be signed with. */
  sendKey: Buffer;
  now: () => number;
  /** The local time zone's offset for a time, in minutes east of UTC (Date's own by default). */
  offsetAt?: (t: number) => number;
  /** The Mac's photo key (#642, api/_relay/photos.ts, macPhotoKey); left out, no photos are synced. */
  photoKey?: Buffer;
  /** Shrinks a contact picture to a small PNG (macOS sips, ./photos.ts). */
  resize?: Resize;
}

/** Local midnight of `t`. */
export function midnightOf(t: number, offsetAt: (t: number) => number = (x) => -new Date(x).getTimezoneOffset()): number {
  const off = offsetAt(t) * 60_000;
  return Math.floor((t + off) / 86_400_000) * 86_400_000 - off;
}

/** The next nudge after `now`, local time. */
export function nextNudge(nudges: [number, number][], now: number, offsetAt?: (t: number) => number): number | null {
  if (!nudges.length) return null;
  const today = midnightOf(now, offsetAt);
  const times = nudges.flatMap(([h, m]) => [today + (h * 60 + m) * 60_000, today + 86_400_000 + (h * 60 + m) * 60_000]);
  return times.filter((t) => t > now).sort((a, b) => a - b)[0] ?? null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
};

const digits = (h: string) => h.replace(/\D/g, "").slice(-10);

/**
 * A contact's handle as Messages' chat ids write it: an address lower-cased, a number with its own + kept. A number
 * saved without a country code stays bare digits: no country code is ever added, since "+1" in front of someone's
 * local number can be a stranger's (#536). Such a number is only texted in a chat Messages already has (`chatFor`).
 */
export function chatHandle(h: string): string {
  const t = h.trim();
  if (t.includes("@")) return t.toLowerCase();
  const d = t.replace(/\D/g, "");
  return t.startsWith("+") ? `+${d}` : d;
}
/** Whether a new chat may be started with this handle: an address, or a number already in full international form. */
export const startable = (h: string) => h.includes("@") || /^\+\d{7,15}$/.test(h);
/** A contact's handles with one entry per number (the same last 10 digits), the +international form kept when there is one. */
function onePerNumber(handles: string[]): string[] {
  const by = new Map<string, string>();
  for (const h of handles) {
    const k = h.includes("@") ? h : digits(h);
    const had = by.get(k);
    if (!had || (!had.startsWith("+") && h.startsWith("+"))) by.set(k, h);
  }
  return [...by.values()];
}
const sameHandle = (a: string, b: string) => (a.includes("@") || b.includes("@") ? a.trim().toLowerCase() === b.trim().toLowerCase() : digits(a).length >= 7 && digits(a) === digits(b));

/** A style profile from Nikita's own past replies: numbers only, no text kept. */
export function profileOf(replies: string[]): StyleProfile {
  const r = replies.filter((x) => x.trim());
  if (!r.length) return { length: 40, capitals: 0.5, emoji: 0.2, stops: 0.2 };
  const share = (f: (x: string) => boolean) => Math.round((r.filter(f).length / r.length) * 100) / 100;
  return {
    length: Math.round(r.reduce((a, x) => a + x.length, 0) / r.length),
    capitals: share((x) => /^[A-Z]/.test(x.trim())),
    emoji: share((x) => /\p{Extended_Pictographic}/u.test(x)),
    stops: share((x) => /\.$/.test(x.trim())),
  };
}

/** Whether any of Nikita's names stands as a word in the texts (#758: a group that names them is owed). */
/**
 * An unnamed chat of several, by its people's first names (#916, #923): a small one every name, a group its first two
 * and how many more ("Alex, Sam +5"), 80 characters at most; "Group chat" with none known.
 */
export function peopleName(names: readonly string[], group: boolean): string {
  if (!names.length) return "Group chat";
  if (!group || names.length <= 3) return names.join(", ").slice(0, 80);
  return `${names.slice(0, 2).join(", ").slice(0, 70)} +${names.length - 2}`;
}

export function namesSomeone(names: readonly string[], texts: readonly string[]): boolean {
  const hay = texts.join("\n").normalize("NFKC");
  return names.some((n) => {
    const esc = n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return esc.length >= 2 && new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "iu").test(hay);
  });
}

/** One text as the Desk shows it (#758). */
type Shown = NonNullable<TextItem["messages"]>[number];

export class Engine {
  private queue = new Set<string>();
  private restyles = new Map<string, string>();
  /** Threads Nikita asked a draft for (#923, "Write for me"): Blasto drafts only for these, and for a restyle. Memory only. */
  private wanted = new Set<string>();
  private contacts: Contact[] = [];
  private contactsAt = 0;
  /** BlueBubbles has answered the contacts call at least once (#861): only then is a count of 0 worth reporting. */
  private contactsAsked = false;
  /** Why each owed thread has no gist yet (#861), and when a sort that didn't land is tried again. Memory only. */
  private waits = new Map<string, GistWait>();
  private retryAt = new Map<string, number>();
  private tries = new Map<string, number>();
  private groupNames = new Map<string, string>();
  /**
   * Each chat of several's other people (#916), from the poll's and the backlog's participants: how many decides
   * whether it is a group (GROUP_MIN_PEOPLE), their handles name a small one on the Desk and run the skip list. Memory only.
   */
  private people = new Map<string, string[]>();
  private skipTerms: string[] = [];
  private skipAt = 0;
  private linkMessages: "up" | "down" | "unknown" = "unknown";
  private linkModels: "up" | "down" | "unknown" = "unknown";
  private hubState: "starting" | "listening" | "paused" | "error" = "starting";
  private working = false;
  private scan: Promise<{ owed: number; older: number } | null> | null = null;
  /**
   * The texts the Desk shows for each listed thread (#758, Nikita 2026-11-05): an owed one-to-one thread's unanswered
   * texts, a group's since Nikita's last reply. Memory only (never the state file or a log), set only once every rule
   * passed over the whole run, so a money, legal, code, promo or skip-listed thread never shows here; it goes with the
   * sealed list and leaves it when the thread closes.
   */
  private shown = new Map<string, Shown[]>();
  /**
   * Each shown line's opaque ref to its message guid (#888), per thread: memory only, for a tapback. The Desk sees the
   * ref; the guid never leaves the Mac, and is never stored or logged.
   */
  private lines = new Map<string, Map<string, string>>();
  /** Whether BlueBubbles' Private API (with its helper) is on, for tapbacks (#888); null until checked. */
  private tapbackState: TapbackState | null = null;
  private learning = false;
  private dirty = true;

  constructor(private readonly d: EngineDeps) {}

  private get offsetAt() {
    return this.d.offsetAt ?? ((x: number) => -new Date(x).getTimezoneOffset());
  }

  private change(f: (s: RelayState) => void): RelayState {
    const s = this.d.store.load();
    f(s);
    this.d.store.save(s);
    this.dirty = true;
    return s;
  }

  /** Contacts, from BlueBubbles, held in memory and refreshed hourly. */
  private async contactList(): Promise<Contact[]> {
    if (this.d.now() - this.contactsAt > 60 * 60_000) {
      try {
        const got = await this.d.bb.contacts();
        // An empty answer (BlueBubbles still starting, or Contacts not yet allowed) is asked again next time, not kept
        // for an hour: every name would read "Unknown" meanwhile (#803). The status counts what the hub can use (#861).
        const before = this.contactsAsked ? this.contacts.length : -1;
        if (got.length || !this.contacts.length) this.contacts = got;
        this.contactsAsked = true;
        if (this.contacts.length !== before) this.dirty = true;
        if (got.length) this.contactsAt = this.d.now();
      } catch (e) {
        this.d.log.error("error", e);
      }
    }
    return this.contacts;
  }

  private contactOf(handle: string): Contact | undefined {
    return handle ? this.contacts.find((c) => c.handles.some((h) => sameHandle(h, handle))) : undefined;
  }

  /** The private skip list's terms, from the site over the paired token, memory only, refreshed hourly. */
  async refreshSkipTerms(force = false): Promise<void> {
    if (!force && this.d.now() - this.skipAt < 60 * 60_000) return;
    const terms = await this.d.site.skipTerms();
    if (terms) {
      this.skipTerms = terms.map((t) => t.toLowerCase());
      this.skipAt = this.d.now();
      this.d.log.log("skip terms", { count: terms.length });
    } else this.d.log.log("skip terms failed");
  }

  /**
   * One poll of BlueBubbles for new messages (#749), every POLL_MS from `serve`, and a catch-up when the hub starts:
   * everything dated after the cursor (less POLL_OVERLAP_MS, for a message Messages writes late), oldest first, page
   * by page, each guid taken in once. The first poll ever starts from now; a gap is caught up for CATCH_UP_MS at most.
   * Paused, the cursor moves on and nothing is taken in, as the webhook was ignored. Returns how many came in.
   */
  async poll(): Promise<number> {
    const now = this.d.now();
    const s = this.d.store.load();
    if (s.paused || !s.inbox) {
      // Start (or, paused, move on) from now: what is already there, in the overlap window, counts as read.
      const recent: { h: string; at: number }[] = [];
      try {
        for (const p of await this.d.bb.since(now - POLL_OVERLAP_MS, 1_000)) recent.push({ h: guidHash(p.guid), at: p.at });
      } catch {
        // Nothing seen yet: the next poll reads the overlap again, and `serve` logs a poll that keeps failing.
      }
      this.change((x) => {
        x.inbox = { at: Math.max(now, ...recent.map((r) => r.at)), recent: recent.slice(-2_000) };
      });
      return 0;
    }
    let cursor = s.inbox.at;
    const recent = new Map(s.inbox.recent.map((e) => [e.h, e.at]));
    let from = Math.max(cursor - POLL_OVERLAP_MS, now - CATCH_UP_MS);
    let taken = 0;
    try {
      for (let page = 0; page < POLL_PAGES; page++) {
        const got = await this.d.bb.since(from, POLL_PAGE);
        for (const p of got) {
          const h = guidHash(p.guid);
          if (recent.has(h)) continue;
          recent.set(h, p.at);
          cursor = Math.max(cursor, p.at);
          if (p.inbound) {
            await this.onMessage(p.inbound);
            taken++;
          }
        }
        if (got.length < POLL_PAGE) break;
        const last = got[got.length - 1]!.at;
        if (last <= from) break;
        from = last;
      }
      this.linkMessages = "up";
    } finally {
      this.change((x) => {
        x.inbox = { at: cursor, recent: [...recent].filter(([, at]) => at >= cursor - POLL_OVERLAP_MS).map(([h, at]) => ({ h, at })).slice(-2_000) };
      });
    }
    if (taken) this.d.log.log("messages in", { count: taken });
    return taken;
  }

  /** One new message, from the poll. */
  async onMessage(m: Inbound): Promise<void> {
    const state = this.d.store.load();
    if (state.paused) return;
    await this.contactList();
    const multi = m.multi ?? m.group;
    if (multi && m.groupName) this.groupNames.set(m.chat, m.groupName);
    if (multi && m.members?.length) this.people.set(m.chat, m.members);
    const group = this.groupOf(m.chat, multi);
    const at = m.message.at;
    this.change((s) => {
      let t = s.threads.find((x) => x.chat === m.chat);
      // A chat of several whose size is known now (#916): a group from 6 others, a regular chat below.
      if (t && multi && this.people.has(m.chat)) regroup(t, group);
      if (!t) {
        t = { id: newThreadId(), chat: m.chat, group, state: "settled", why: null, since: at, lastIn: at, sort: null, gist: "", sortedAt: null, laterUntil: null, laterSet: null, draft: null, summary: null, repliedAt: null };
        s.threads.push(t);
      }
      // Any new message moves a chat off the older-unanswered snapshot: answered, or owed again below.
      if (s.older.some((o) => o.chat === m.chat)) {
        s.older = s.older.filter((o) => o.chat !== m.chat);
        s.olderCount = Math.max(0, s.olderCount - 1);
      }
      if (m.message.fromMe) {
        // A thread Nikita sent in from the Desk stays in the queue (#870): only Done (or a rule) settles it.
        if (t.sentHere !== undefined) {
          t.unread = false;
          return;
        }
        if (t.state === "owed" || t.state === "later") this.replied(s, t, at);
        if (t.group) t.summary = null;
        t.unread = false;
        delete t.held;
        return;
      }
      t.lastIn = Math.max(t.lastIn, at);
      t.unread = m.message.read !== true;
      // A new text is sorted afresh (#924): a set-aside held off for the last one doesn't carry over.
      delete t.held;
      if (t.group) {
        // A group stays summary-only (#758, `summarise`). #950: while Messages shows it unread it waits (held as a
        // group's set-aside, which lands once it is read), muted or not; once read it is owed only when Nikita was
        // asked or named.
        if (t.state !== "owed" && t.state !== "later") {
          if (t.unread) Object.assign(t, { state: "owed", why: null, since: at, held: "group" });
          else Object.assign(t, { state: "settled", why: "group" });
        }
        this.queue.add(t.id);
        this.d.log.log("thread settled", { group: 1 });
        return;
      }
      const contact = this.contactOf(m.message.handle);
      const why = settleByRule({ handle: m.message.handle, names: contact?.names ?? [], text: m.message.text }, this.skipTerms);
      // A code, a short code or a promo still waits while it is unread (#950: Messages' Unread filter shows it), with
      // the hub's own line, never a model's; it settles once it is read.
      if ((why === "code" || why === "short-code" || why === "promo") && t.unread && t.kept === undefined) {
        Object.assign(t, { state: "owed", why: null, since: t.state === "owed" || t.state === "later" ? t.since : at, gist: RULE_GIST[why], sort: null, draft: null, laterUntil: null, sortedAt: this.d.now(), held: why });
        this.queue.delete(t.id);
        this.forget(t.id);
        this.d.log.log("thread owed", { rule: 1 });
        return;
      }
      if (why) {
        // Settled whatever it was: a money or legal text, a code or a skip-listed sender never reaches a model, even
        // in a thread that was already owed (its draft goes too; Nikita still sees the thread in Messages).
        t.state = "settled";
        t.why = why;
        t.draft = null;
        t.laterUntil = null;
        this.queue.delete(t.id);
        this.d.log.log("thread settled", { rule: 1 });
        return;
      }
      if (t.state !== "owed" && t.state !== "later") {
        t.state = "owed";
        t.why = null;
        t.since = at;
        t.sort = null;
        t.gist = "";
        t.draft = null;
      } else t.draft = null;
      this.queue.add(t.id);
      this.d.log.log("thread owed");
    });
  }

  /**
   * Whether a chat is a group (#916): a chat of several with GROUP_MIN_PEOPLE others or more, or whose size isn't
   * known (as before). A one-to-one chat, or a chat of several with fewer, is handled as a regular chat.
   */
  private groupOf(chat: string, multi = isGroupChat(chat)): boolean {
    if (!multi) return false;
    const members = this.people.get(chat);
    return bigGroup(members ? members.length : null);
  }

  /** A send from the Desk counted for the day (#870): the reply time only for the first since their last text. */
  private countSend(s: RelayState, t: Thread, at: number) {
    const day = midnightOf(at, this.offsetAt);
    let d = s.days.find((x) => x.day === day);
    if (!d) {
      d = { day, sent: 0, minutes: [] };
      s.days.push(d);
    }
    d.sent += 1;
    if ((t.repliedAt ?? 0) < t.lastIn && d.minutes.length < 200) d.minutes.push(Math.max(0, Math.round((at - t.since) / 60_000)));
    t.repliedAt = at;
  }

  private replied(s: RelayState, t: Thread, at: number) {
    const minutes = Math.max(0, Math.round((at - t.since) / 60_000));
    const day = midnightOf(at, this.offsetAt);
    let d = s.days.find((x) => x.day === day);
    if (!d) {
      d = { day, sent: 0, minutes: [] };
      s.days.push(d);
    }
    d.sent += 1;
    if (d.minutes.length < 200) d.minutes.push(minutes);
    t.state = "replied";
    t.why = null;
    t.repliedAt = at;
    delete t.kept;
    delete t.media;
    t.draft = null;
    t.laterUntil = null;
    this.d.log.log("thread replied", { minutes });
  }

  /**
   * Sorts (and drafts for) the queued threads, one call at a time, each once its burst has settled, WORK_PER_ROUND at
   * most a round. #861: every owed one-to-one thread without a gist is in line, whatever brought it in (a text, the
   * backlog, a restart), and one whose sort didn't land (the cap, a failed call, the site or BlueBubbles out of reach)
   * is tried again after a backoff instead of waiting for the next day's scan; the reason goes to the Desk meanwhile.
   */
  async work(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      const now = this.d.now();
      const listed = this.d.store.load().threads;
      // Newest first, behind what is already in line.
      for (const t of [...listed].sort((a, b) => b.lastIn - a.lastIn)) {
        if (t.group || (t.state !== "owed" && t.state !== "later") || t.gist || this.queue.has(t.id)) continue;
        const at = this.retryAt.get(t.id);
        if (at !== undefined && at > now) continue;
        if (at === undefined && (this.tries.get(t.id) ?? 0) >= REFUSED_MAX) continue;
        this.retryAt.delete(t.id);
        this.queue.add(t.id);
      }
      let done = 0;
      for (const id of [...this.queue]) {
        if (done >= WORK_PER_ROUND) break;
        const s = this.d.store.load();
        if (s.paused) return;
        const t = s.threads.find((x) => x.id === id);
        if (!t) {
          this.queue.delete(id);
          continue;
        }
        if (this.d.now() - t.lastIn < SETTLE_MS && !this.restyles.has(id) && !this.wanted.has(id)) continue;
        this.queue.delete(id);
        done++;
        this.waits.delete(id);
        try {
          if (t.group) await this.summarise(t);
          else if (t.state === "owed" || t.state === "later") await this.sortAndDraft(t);
        } catch (e) {
          this.d.log.error("model error", e);
          this.linkModels = "down";
          this.waits.set(id, waitOf(e));
        }
        if (!t.group) this.afterSort(id);
      }
    } finally {
      this.working = false;
    }
  }

  /** After a sort (#861): a gist clears the wait; an owed thread still without one is tried again after a backoff. */
  private afterSort(id: string) {
    const t = this.d.store.load().threads.find((x) => x.id === id);
    if (!t || t.gist || (t.state !== "owed" && t.state !== "later")) {
      this.waits.delete(id);
      this.retryAt.delete(id);
      this.tries.delete(id);
      return;
    }
    const why = this.waits.get(id) ?? "messages";
    this.waits.set(id, why);
    const n = (this.tries.get(id) ?? 0) + 1;
    this.tries.set(id, n);
    if (why === "refused" && n >= REFUSED_MAX) {
      this.retryAt.delete(id);
      this.dirty = true;
      return;
    }
    this.retryAt.set(id, this.d.now() + (why === "cap" ? RETRY_CAP_MS : Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (n - 1))));
    this.dirty = true;
  }

  /** What the Desk says about an owed thread with no gist (#861): the last reason it didn't land, or in line. */
  private waitFor(t: Thread): GistWait | undefined {
    if (t.group || t.gist || (t.state !== "owed" && t.state !== "later")) return undefined;
    return this.waits.get(t.id) ?? "queued";
  }

  private async recent(chat: string, limit: number): Promise<Message[] | null> {
    try {
      const got = await this.d.bb.messages(chat, limit);
      this.linkMessages = "up";
      // Words, or a photo or file with none (#870): an attachment-only text is a text that came. Its words-only lines go
      // to the models and the Desk; of an attachment, only that there was one.
      return got.filter((m) => m.text.trim() || m.media).sort((a, b) => a.at - b.at);
    } catch (e) {
      this.linkMessages = "down";
      this.d.log.error("error", e);
      return null;
    }
  }

  private async summarise(t: Thread): Promise<void> {
    const msgs = await this.recent(t.chat, 60);
    if (!msgs) return;
    const lastMine = msgs.map((m) => m.fromMe).lastIndexOf(true);
    const since = msgs.slice(lastMine + 1);
    if (!since.length) return;
    const handles = [...new Set(since.map((m) => m.handle).filter(Boolean))];
    const contacts = await this.contactList();
    const ph = new Placeholders({
      members: handles.map((h) => ({ names: this.contactOf(h)?.names ?? [], handle: h })),
      others: contacts.flatMap((c) => c.names),
    });
    // The rules over every message in the run, each with its own sender: a money or legal text, a code or a
    // skip-listed member keeps the whole group away from the model (and drops any summary it had).
    if (since.some((m) => !m.fromMe && settleByRule({ handle: m.handle, names: this.contactOf(m.handle)?.names ?? [], text: m.text }, this.skipTerms) !== null)) {
      // Nor does its text reach the Desk (#758).
      this.forget(t.id);
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x) Object.assign(x, { summary: null, state: "settled", why: "group", held: undefined });
      });
      this.d.log.log("thread settled", { rule: 1, group: 1 });
      return;
    }
    // Trimmed here, on the Mac, to the privacy page's caps: only what the call may see leaves the Mac.
    const lines: Line[] = within(
      since.map((m) => ({ from: m.fromMe ? "me" : `Member ${handles.indexOf(m.handle) + 1}`, text: mediaOnly(m) ? MEDIA_LINE : ph.swap(m.text), ago: (this.d.now() - m.at) / 60_000 })),
      CAPS.groupMessages,
      CAPS.groupChars,
    );
    // The messages themselves, for Nikita's own eyes on the Desk (#758): real text, each with its sender's name and photo.
    this.shown.set(t.id, this.shownOf(since.filter((m) => !m.fromMe), true, t.id));
    const got = await this.d.site.sort({ group: true, lines });
    if ("paused" in got) return this.budgetStop();
    const answer = readSort(got.answer, true);
    this.linkModels = "up";
    this.d.log.log("model call", { group: 1 });
    if (!answer || !("summary" in answer)) return this.d.log.log("model refused");
    // Owed (#758) when someone asked Nikita something, or named them; otherwise summary-only, as before.
    const named = namesSomeone(this.d.config.me, since.filter((m) => !m.fromMe).map((m) => m.text));
    this.change((s) => {
      const x = s.threads.find((y) => y.id === t.id);
      if (!x) return;
      x.summary = { text: ph.restore(answer.summary), asked: answer.asked, at: this.d.now() };
      if ((answer.asked || named) && x.state !== "owed" && x.state !== "later") Object.assign(x, { state: "owed", why: null, since: since[0]!.at });
      // Asked or named (#950): it waits whether or not it is read, so an unread group's wait doesn't end on reading.
      if ((answer.asked || named) && x.held === "group") delete x.held;
    });
    this.d.log.log("group summarised");
  }

  private async sortAndDraft(t: Thread): Promise<void> {
    const msgs = await this.recent(t.chat, 100);
    if (!msgs) return void this.waits.set(t.id, "messages");
    // "Write for me" (#923): one draft, asked for once; taken here whether or not one can be written.
    const asked = this.wanted.delete(t.id);
    const contacts = await this.contactList();
    // A small chat of several (#916, under 6 others): handled as a one-to-one thread, its people each "Member N" in the
    // text a model reads (every line of theirs is "them"), each line's rules run with its own sender, and the skip list
    // over everyone in it. Its reply goes to the chat itself, never to one of them.
    const multi = isGroupChat(t.chat);
    // A one-to-one chat's other person from its chat id when no message of theirs carries a handle (#861).
    const theirs = multi ? "" : msgs.find((m) => !m.fromMe && m.handle)?.handle || chatPerson(t.chat);
    const contact = multi ? undefined : this.contactOf(theirs);
    const members = multi ? [...new Set([...msgs.filter((m) => !m.fromMe && m.handle).map((m) => m.handle), ...(this.people.get(t.chat) ?? [])])] : [];
    const ph = multi
      ? new Placeholders({ members: members.map((h) => ({ names: this.contactOf(h)?.names ?? [], handle: h })), others: contacts.flatMap((c) => c.names), restoreMembers: true })
      : new Placeholders({ contact: { names: contact?.names ?? [], handle: theirs }, others: contacts.filter((c) => c !== contact).flatMap((c) => c.names) });
    // Each line's rules with its sender (a one-to-one thread's every line with the contact, as before).
    const ruleOf = (m: Message) => {
      const h = multi ? (m.fromMe ? "" : m.handle) : theirs;
      return settleByRule({ handle: h, names: (multi ? this.contactOf(h)?.names : contact?.names) ?? [], text: m.text }, this.skipTerms);
    };
    const memberRuled = members.some((h) => settleByRule({ handle: h, names: this.contactOf(h)?.names ?? [], text: "" }, this.skipTerms) !== null);
    const lastMine = msgs.map((m) => m.fromMe).lastIndexOf(true);
    const unanswered = msgs.slice(lastMine + 1).filter((m) => !m.fromMe);
    // Nikita's own message is the newest (#642): he answered, on his phone or here, so the thread closes. No draft.
    if (!unanswered.length) {
      // Their unread tapback on Nikita's message (#950): it waits while Messages shows it unread, with the hub's own line.
      if (t.unread && lastMine >= 0 && t.lastIn > msgs[lastMine]!.at) {
        this.change((s) => {
          const x = s.threads.find((y) => y.id === t.id);
          if (x && (x.state === "owed" || x.state === "later")) Object.assign(x, { gist: REACTION_GIST, sortedAt: this.d.now(), held: x.held ?? "no-reply" });
        });
        return;
      }
      // Sent from the Desk (#870): it stays in the queue until Done.
      if (lastMine >= 0 && t.sentHere === undefined) this.closeReplied(t.id, msgs[lastMine]!.at);
      return;
    }
    // Their photos and files with no words (#870): counted for the Desk's "Photo" mark, never read.
    const media = unanswered.filter(mediaOnly).length;
    // Since the first text he hasn't answered (a backlog thread starts at their last one), and whether Messages shows
    // the newest read (#758): a mark only.
    // #924: kept unread in Messages, it is owed whatever Dialtone or closing intent reads; those verdicts are held off
    // until it is read. The rules below still settle it.
    const unread = unanswered[unanswered.length - 1]!.read !== true;
    this.change((s) => {
      const x = s.threads.find((y) => y.id === t.id);
      if (!x) return;
      x.since = Math.min(x.since, unanswered[0]!.at);
      x.lastIn = Math.max(x.lastIn, unanswered[unanswered.length - 1]!.at);
      x.unread = unread;
      if (media) x.media = media;
      else delete x.media;
    });
    // After Nikita's closing reply ("no worries", "sounds good", "already did it"), an acknowledgement owes nothing (#642):
    // settled without a model, and Blasto never drafts after it. A photo is never only an acknowledgement (#870). A
    // thread Nikita brought back stays.
    const closing = !t.kept && !media && lastMine >= 0 && closingReply(msgs[lastMine]!.text) && onlyAcks(unanswered.map((m) => m.text));
    // The ender pre-pass (#950): a read chat whose texts since Nikita's last only end the conversation ("ok cool",
    // "lol") waits on no one, with no model call. An unread one skips it, unless the text is over UNREAD_ENDER_MS old
    // (the Mac's read state can lag the phone's). A thread he brought back, or asked a draft for, stays.
    const newestIn = unanswered[unanswered.length - 1]!;
    const ended = !t.kept && !asked && !this.restyles.has(t.id) && !media && unanswered.every((m) => isEnder(m.text)) && (!unread || this.d.now() - newestIn.at >= UNREAD_ENDER_MS);
    if (ended && !closing) {
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x) Object.assign(x, { state: "settled", why: "ender", draft: null, gist: "", laterUntil: null, held: undefined });
      });
      this.d.log.log("thread settled", { ender: 1 });
      return;
    }
    if (closing && !unread) {
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x) Object.assign(x, { state: "settled", why: "closing", draft: null, gist: "", laterUntil: null, held: undefined });
      });
      this.d.log.log("thread settled", { closing: 1 });
      return;
    }
    // Every rule once more, over everything the calls below could carry: the whole unanswered run and the earlier
    // turns the draft sees (both sides). A skip-listed contact, a money or legal text, a code or a promo anywhere in
    // it settles the thread before anything reaches a model, so a thread with money talk is never sent, even after
    // Nikita answered it and a harmless text came in.
    const earliest = Math.max(0, lastMine - (CAPS.draftEarlier - 1));
    const seen = msgs.slice(earliest);
    const ruled = (memberRuled ? "skip" : null) ?? seen.map(ruleOf).find((w) => w !== null);
    // Unread, and only a code, a short code or a promo (#950): it waits as Messages shows it, with the hub's own line;
    // nothing of it reaches a model or the Desk, and it settles once it is read.
    if (unread && (ruled === "code" || ruled === "short-code" || ruled === "promo")) {
      this.forget(t.id);
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x && (x.state === "owed" || x.state === "later")) Object.assign(x, { gist: RULE_GIST[ruled], sort: null, draft: null, sortedAt: this.d.now(), held: ruled });
      });
      return;
    }
    if (ruled) {
      this.forget(t.id);
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x) Object.assign(x, { state: "settled", why: ruled, draft: null, gist: "", laterUntil: null, held: undefined });
      });
      this.d.log.log("thread settled", { rule: 1 });
      return;
    }
    // Clean of every rule: the recent turns, both sides (#870: Nikita's own lines marked `me`), go to Nikita's sealed
    // list for the Desk (#758). Display only; the same window the rules just passed.
    this.shown.set(t.id, this.shownOf(seen, false, t.id, multi));
    // Only photos and files, no words (#870): owed, with no model call (there is nothing for one to read). The gist is
    // the hub's own words, so the thread isn't queued again every round.
    if (unanswered.every(mediaOnly)) {
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x && (x.state === "owed" || x.state === "later")) Object.assign(x, { gist: MEDIA_GIST, sortedAt: this.d.now() });
      });
      return;
    }
    // An attachment shows to a model as a marker only, never its content or name (#870).
    const line = (m: Message): Line => ({ from: m.fromMe ? "me" : "them", text: mediaOnly(m) ? MEDIA_LINE : ph.swap(m.text), ago: (this.d.now() - m.at) / 60_000 });
    const restyle = this.restyles.get(t.id);
    this.restyles.delete(t.id);
    // A draft only on request (#923, Nikita: "usually doesn't like the drafts"): "Write for me", or his own words.
    const want = !!restyle || asked;
    // Held off while unread (#924): closing intent now, Dialtone's "no reply needed" below.
    let held: "no-reply" | "closing" | undefined = closing ? "closing" : undefined;
    if (!t.sort || !want) {
      // Nikita's own last message goes first, as context (#642): a thanks for his "no worries" reads as closed.
      const mineBefore = lastMine >= 0 ? [line(msgs[lastMine]!)] : [];
      const got = await this.d.site.sort({ group: false, lines: within([...mineBefore, ...unanswered.map(line)], CAPS.sortMessages, CAPS.sortChars) });
      if ("paused" in got) {
        this.waits.set(t.id, "cap");
        return this.budgetStop();
      }
      this.linkModels = "up";
      this.d.log.log("model call", { sort: 1 });
      const answer = readSort(got.answer, false);
      if (!answer || !("needsReply" in answer)) {
        this.waits.set(t.id, "refused");
        return this.d.log.log("model refused");
      }
      // A thread Nikita brought back (#870) stays owed whatever Dialtone reads; one he keeps unread (#924) or asked a
      // draft for (#923) stays owed too, its "no reply needed" held until it is read.
      const noReply = !answer.needsReply && !t.kept;
      if (noReply) held ??= "no-reply";
      const settled = noReply && !unread && !want;
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (!x) return;
        x.sort = answer.sort;
        x.gist = ph.restore(answer.gist);
        x.sortedAt = this.d.now();
        if (settled) Object.assign(x, { state: "settled", why: "no-reply", draft: null, held: undefined });
        else if (held && unread) x.held = held;
        else delete x.held;
      });
      this.d.log.log("sorted", { sooner: answer.sort === "sooner" ? 1 : 0 });
      if (settled) return;
    } else if (held && unread) {
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x) x.held = held;
      });
    }
    if (!want) return;
    // Trimmed here, on the Mac: the answered run and a few turns before it, the newest kept first, within the caps;
    // up to 8 of Nikita's own replies as examples, 1,500 characters in all.
    const context = within(seen.map(line), CAPS.draftEarlier + CAPS.sortMessages, CAPS.draftChars);
    // Style examples come from further back, so one that trips a rule is left out (not settled on: an old reply about
    // money shouldn't stop every draft in the thread for good); the context above is already clean.
    const mine = msgs.filter((m) => m.fromMe && !mediaOnly(m) && ruleOf(m) === null).map((m) => m.text);
    const examples: string[] = [];
    let used = 0;
    for (const e of mine.slice(-CAPS.styleExamples).reverse()) {
      const x = ph.swap(e).slice(0, CAPS.styleChars - used);
      if (!x) break;
      examples.unshift(x);
      used += x.length;
    }
    const voice = this.draftVoice(theirs);
    const got = await this.d.site.draft({ lines: context, examples, profile: profileOf(mine.slice(-CAPS.styleExamples)), ...(restyle && { dictated: ph.swap(restyle).slice(0, CAPS.dictatedChars) }), ...(voice && { voice }) });
    if ("paused" in got) return this.budgetStop();
    this.linkModels = "up";
    this.d.log.log("model call", { draft: 1 });
    const answer = readDraft(got.answer);
    if (!answer) return this.d.log.log("draft refused");
    this.change((s) => {
      const x = s.threads.find((y) => y.id === t.id);
      if (x && (x.state === "owed" || x.state === "later")) x.draft = { text: ph.restore(answer.draft).slice(0, 600), at: this.d.now(), by: restyle ? "restyled" : "blasto" };
    });
    this.d.log.log("draft ready");
  }

  /** A thread Nikita answered elsewhere closes as replied (#642): no draft, out of the owed count. */
  private closeReplied(id: string, at: number) {
    this.change((s) => {
      const x = s.threads.find((y) => y.id === id);
      if (x && (x.state === "owed" || x.state === "later")) this.replied(s, x, at);
    });
    this.d.log.log("thread closed");
  }

  /**
   * The closing check (#642), every few minutes: an owed one-to-one thread whose newest message in Messages is
   * Nikita's own (a reply the webhook missed, or sent from his phone) closes. It resurfaces only when they write again.
   * The read check (#924) rides along: a thread whose "no reply needed" or closing verdict was held off while unread
   * settles once their latest text is read, and one Relay set aside that way comes back once it is unread again
   * (Nikita's "Mark as Unread" on the phone reaches the Mac's Messages through iCloud).
   */
  async recheck(): Promise<void> {
    const now = this.d.now();
    const threads = this.d.store.load().threads;
    // A thread sent in from the Desk stays in the queue until Done (#870), so it isn't closed here. Held ones first.
    // #950: groups too, so an unread group's wait ends once it is read.
    const owed = threads.filter((t) => (t.state === "owed" || t.state === "later") && t.sentHere === undefined).sort((a, b) => Number(!!b.held) - Number(!!a.held));
    const aside = threads.filter((t) => !t.group && t.state === "settled" && (t.why === "no-reply" || t.why === "closing" || t.why === "ender") && now - t.lastIn < OLDER_WINDOW_MS).sort((a, b) => b.lastIn - a.lastIn);
    for (const t of [...owed, ...aside].slice(0, RECHECK_MAX)) {
      const latest = await this.d.bb.messages(t.chat, 3).catch(() => null);
      if (!latest) return;
      const newest = latest.reduce<Message | null>((a, m) => (!a || m.at >= a.at ? m : a), null);
      const theirs = latest.filter((m) => !m.fromMe).reduce<Message | null>((a, m) => (!a || m.at >= a.at ? m : a), null);
      if (t.state === "settled") {
        // Unread again (#924): owed, its set-aside held off until it is read. Its gist stays; a new text is the poll's.
        if (theirs && newest === theirs && theirs.read !== true && (t.repliedAt ?? 0) < theirs.at)
          this.change((s) => {
            const x = s.threads.find((y) => y.id === t.id);
            if (x && x.state === "settled" && (x.why === "no-reply" || x.why === "closing" || x.why === "ender")) Object.assign(x, { state: "owed", held: x.why, why: null, unread: true, lastIn: Math.max(x.lastIn, theirs.at) });
          });
        continue;
      }
      if (newest?.fromMe && newest.at > t.lastIn) this.closeReplied(t.id, newest.at);
      else {
        // Read since (#758): Messages now has a read time for their newest text. The row stays owed; only the mark goes,
        // unless a set-aside was held off for it (#924): then it lands now.
        const unread = theirs ? theirs.read !== true : false;
        if (theirs && (unread !== (t.unread === true) || (!unread && t.held)))
          this.change((s) => {
            const x = s.threads.find((y) => y.id === t.id);
            if (!x) return;
            x.unread = unread;
            if (!unread) this.release(x);
          });
      }
    }
  }

  /** A thread whose set-aside was held off while unread (#924), now read: it settles as Dialtone or closing intent read it. */
  private release(x: Thread): boolean {
    const held = x.held;
    delete x.held;
    if (!held || x.kept || (x.state !== "owed" && x.state !== "later")) return false;
    Object.assign(x, { state: "settled", why: held, draft: null, laterUntil: null });
    this.wanted.delete(x.id);
    this.d.log.log("thread settled", { [held === "closing" ? "closing" : "read"]: 1 });
    return true;
  }

  /**
   * The Desk's copy of the texts (#758): the newest SHOWN_MESSAGES with words, SHOWN_CHARS in all, oldest first. In a
   * group, or a small chat of several (#916), each of theirs carries its sender's name and, when the site has it, their
   * photo's opaque id; outside a group Nikita's own lines are marked `me`.
   */
  private shownOf(msgs: Message[], group: boolean, thread: string, several = group): Shown[] {
    const photos = this.d.store.load().photos;
    const out: Shown[] = [];
    const refs = new Map<string, string>();
    let used = 0;
    // Control and format characters (a zero-width space, a direction mark) are stripped first, as the site does, and a
    // text left empty is skipped (#803): the site refused a whole list over one such text.
    const clean = (t: string) => t.replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" ? "\n" : "")).trim();
    for (const m of [...msgs].filter((x) => clean(x.text) || x.media).reverse()) {
      if (out.length >= SHOWN_MESSAGES || used >= SHOWN_CHARS) break;
      // A photo or file with no words (#870) shows as "Photo" on the Desk: nothing of the attachment.
      const media = !clean(m.text);
      const text = media ? MEDIA_TEXT : clean(m.text).slice(0, SHOWN_CHARS - used).trim();
      if (!text) break;
      used += text.length;
      const named = several && !m.fromMe;
      const contact = named ? this.contactOf(m.handle) : undefined;
      const photo = contact && this.d.photoKey ? photoIdOf(this.d.photoKey, contact.handles) : "";
      // Their line's tapback ref (#888): opaque, from the guid under the send key; the guid stays here, in `lines`.
      const ref = !m.fromMe && m.guid ? this.refOf(thread, m.guid) : "";
      if (ref && !refs.has(ref)) refs.set(ref, m.guid!);
      out.unshift({ text, at: Math.max(Date.UTC(2026, 0, 1), Math.floor(m.at)), ...(named && { from: (contact?.names[0] || "Unknown sender").slice(0, 80) }), ...(photo && photos[photo] && { photo }), ...(media && { media: true as const }), ...(!group && m.fromMe && { me: true as const }), ...(ref && refs.get(ref) === m.guid && { ref }) });
    }
    this.lines.set(thread, refs);
    return out;
  }

  /** A line's ref (#888): 8 hex of an HMAC under the send key over the thread and the message guid. Stable across restarts. */
  private refOf(thread: string, guid: string): string {
    return createHmac("sha256", this.d.sendKey).update(`tapback-ref|${thread}|${guid}`).digest("hex").slice(0, 8);
  }

  /** A thread's shown lines and their refs, dropped together. */
  private forget(id: string) {
    this.shown.delete(id);
    this.lines.delete(id);
  }

  /**
   * Whether tapbacks can go (#888): BlueBubbles' Private API with its helper. Asked at start and every few minutes;
   * an answer that can't be read leaves the last one standing.
   */
  async checkTapbacks(): Promise<void> {
    const on = await this.d.bb.privateApi().catch(() => null);
    if (on === null) return;
    const next: TapbackState = on ? "on" : "off";
    if (next !== this.tapbackState) {
      this.tapbackState = next;
      this.dirty = true;
      this.d.log.log("tapbacks", { on: on ? 1 : 0 });
    }
  }

  /**
   * After a restart the Desk's copies are gone (memory only): read them again for a few listed threads at a time,
   * through every rule, as `sortAndDraft` and `summarise` would. A thread a rule matches shows nothing.
   */
  private async fillShown(): Promise<void> {
    const s = this.d.store.load();
    const want = s.threads.filter((t) => !this.shown.has(t.id) && (t.state === "owed" || t.state === "later" || (t.group && t.summary)));
    // Every listed thread at once (#803: 10 a report left most of a 50-chat backlog without its texts for the better
    // part of an hour after each restart). Local BlueBubbles reads, no model.
    for (const t of want.slice(0, MAX_ITEMS)) {
      const msgs = await this.recent(t.chat, 25);
      if (!msgs) return;
      const lastMine = msgs.map((m) => m.fromMe).lastIndexOf(true);
      // A group's texts since Nikita's last reply; a one-to-one thread's recent turns, both sides, as `sortAndDraft` shows them (#870).
      const run = t.group ? msgs.slice(lastMine + 1).filter((m) => !m.fromMe) : msgs.slice(Math.max(0, lastMine - (CAPS.draftEarlier - 1)));
      const multi = isGroupChat(t.chat);
      const handle = multi ? "" : (t.chat.split(";").pop() ?? "");
      const ruled = run.some((m) => settleByRule({ handle: multi ? m.handle : m.handle || handle, names: this.contactOf(multi ? m.handle : m.handle || handle)?.names ?? [], text: m.text }, this.skipTerms) !== null);
      this.shown.set(t.id, ruled ? [] : this.shownOf(run, t.group, t.id, multi));
    }
  }

  /** What a Blasto call carries of the learned voice (#758) for this contact: null before a learn. */
  private draftVoice(handle: string): DraftVoice | null {
    const s = this.d.store.load();
    const v = s.voice;
    if (!v) return null;
    const relation: Relation | null = handle ? (s.relations[handleKey(handle)] ?? null) : null;
    return { traits: v.traits, relation, tone: relation && relation !== "other" ? v.tones[relation] : [], stats: v.stats };
  }

  /**
   * The backlog (#758): every chat's last message from BlueBubbles' chat query, sorted on the Mac (./backlog.ts). An
   * owed chat Relay doesn't already have (or has answered or settled before that message) becomes an owed thread and
   * goes to Dialtone and Blasto like a new text, where every rule runs again over the whole run; older ones become
   * the "N older unanswered" snapshot. Paused, nothing is read. Returns the counts, or null when it couldn't read.
   */
  backlog(): Promise<{ owed: number; older: number } | null> {
    // One scan at a time: a Rescan that lands while the start-up scan runs waits for that one.
    this.scan ??= this.scanAll().finally(() => {
      this.scan = null;
    });
    return this.scan;
  }

  private async scanAll(): Promise<{ owed: number; older: number } | null> {
    const now = this.d.now();
    if (this.d.store.load().paused) return null;
    await this.contactList();
    const contactOf = (h: string) => this.contactOf(h);
    const chats: Awaited<ReturnType<BlueBubbles["chatList"]>> = [];
    try {
      // Every page until an empty one (#870, ./backlog.ts).
      chats.push(...(await allChats(this.d.bb, CHAT_PAGE, CHAT_PAGES)));
      this.linkMessages = "up";
    } catch (e) {
      this.linkMessages = "down";
      this.d.log.error("backlog failed", e);
      return null;
    }
    // Each chat of several's people (#916), so the poll and the Desk know which are groups.
    for (const c of chats) if ((c.multi ?? c.group) && c.members?.length) this.people.set(c.chat, c.members);
    // A chat of several's own name in Messages (#950): the Desk's chip shows it, the people's names only without one.
    for (const c of chats) if ((c.multi ?? c.group) && c.name) this.groupNames.set(c.chat, c.name);
    const muted = new Set(chats.filter((c) => c.muted).map((c) => c.chat));
    // Every chat active lately, or whose last item is theirs and unread, judged on its own newest messages (#950):
    // the same path as `relay why` (./backlog.ts, judgeChat). The chat query's last message is BlueBubbles' MAX(ROWID),
    // which Messages in iCloud can make an older message, so it only picks which chats to read. Older ones are let go.
    const sorted = emptySort();
    const seen = new Set<string>();
    const wanted = chats.filter((c) => !seen.has(c.chat) && seen.add(c.chat) && scanWants(c, now)).sort((a, b) => b.lastAt - a.lastAt);
    for (const c of wanted.slice(0, SCAN_READ_MAX)) {
      const msgs = await this.recent(c.chat, 25);
      if (msgs === null) continue;
      place(sorted, c, judgeChat(c, msgs, now, this.skipTerms, contactOf));
    }
    finish(sorted);
    // Newest first (#803): Dialtone sorts the newest ones first, so the top of the Desk gets its gists soonest.
    sorted.owed.sort((a, b) => b.at - a.at);
    sorted.older.sort((a, b) => b.at - a.at);
    let added = 0;
    this.change((s) => {
      // A thread whose chat's size is known now (#916): a group from 6 others, a regular chat below.
      for (const t of s.threads) if (isGroupChat(t.chat) && this.people.has(t.chat)) regroup(t, this.groupOf(t.chat));
      // Muted in Messages (#950): a mark only, from this scan.
      for (const t of s.threads) {
        if (muted.has(t.chat)) t.muted = true;
        else delete t.muted;
      }
      for (const e of sorted.owed) {
        const t = s.threads.find((x) => x.chat === e.chat);
        if (t && (t.state === "owed" || t.state === "later")) {
          t.unread = e.unread;
          // Listed only while unread (#950): a group's or a code sender's set-aside lands once it is read.
          if (e.unread && e.untilRead && !t.held) t.held = e.untilRead;
          // Read now (#924): a set-aside held off while it was unread lands.
          if (!e.unread && t.held && this.release(t)) continue;
          // Their latest text (#895): a text the hub missed while it was off still keeps the thread inside the window.
          t.lastIn = Math.max(t.lastIn, e.at);
          // No gist (#803: a model error or the budget stop dropped it from the queue, and nothing queued it
          // again): it showed "No gist yet" for good. Each scan, and so each hub start, queues it once more.
          if (!t.gist) this.queue.add(t.id);
          continue;
        }
        // Settled by Dialtone's read or by closing intent (#870: an earlier hub's wrong verdict stayed for good): their
        // text is the last word, so it goes back in line for a fresh sort, once per text. A rule's settle, the skip
        // list, Nikita's own "done" and a reply of his stay as they are.
        const revisit = t && t.state === "settled" && (t.why === "no-reply" || t.why === "closing") && (t.rechecked ?? 0) < e.at && (t.repliedAt ?? 0) < e.at;
        // Kept unread in Messages (#924): a thread Dialtone or closing intent set aside is owed again, its verdict held
        // off until it is read; its gist stays, so no model reads it again. Done and a rule's settle stay as they are.
        // It counts as this text's revisit.
        // #950: so is one a group, a code, a short code, a promo or the ender check set aside: Messages' Unread filter
        // shows it, so the list does. The skip list, money and legal and Nikita's Done stay as they are.
        const heldWhy = t && t.state === "settled" ? t.why : null;
        if (t && e.unread && heldWhy && UNREAD_HELD.includes(heldWhy as Held) && (t.repliedAt ?? 0) < e.at && (t.doneAt ?? 0) < e.at) {
          Object.assign(t, { state: "owed", held: e.untilRead ?? (heldWhy as Held), why: null, lastIn: Math.max(t.lastIn, e.at), unread: true, rechecked: Math.max(t.rechecked ?? 0, e.at) });
          if (!t.gist) this.queue.add(t.id);
          added++;
          continue;
        }
        // Relay answered, settled or dismissed it after this message: it stays as it is.
        // Nikita's own Done (#914) holds against every text up to when he pressed it.
        if (t && !revisit && Math.max(t.lastIn, t.repliedAt ?? 0, t.sortedAt ?? 0, t.doneAt ?? 0) >= e.at) continue;
        if (t) Object.assign(t, { state: "owed", why: null, since: Math.min(t.since, e.at), lastIn: Math.max(t.lastIn, e.at), sort: null, gist: "", draft: null, laterUntil: null, unread: e.unread, ...(revisit && { rechecked: e.at }) });
        else s.threads.push({ id: newThreadId(), chat: e.chat, group: this.groupOf(e.chat), state: "owed", why: null, since: e.at, lastIn: e.at, sort: null, gist: "", sortedAt: null, laterUntil: null, laterSet: null, draft: null, summary: null, repliedAt: null, unread: e.unread, ...(e.untilRead && e.unread && { held: e.untilRead }), ...(e.muted && { muted: true as const }) });
        if (t && e.unread && e.untilRead) t.held = e.untilRead;
        this.queue.add(s.threads.find((x) => x.chat === e.chat)!.id);
        added++;
      }
      // Set aside by the scan (#950): a rule or the ender check, listed under "set aside" with why instead of vanishing.
      // A thread Nikita brought back, sent in from the Desk or answered after it stays as it is.
      for (const e of sorted.aside) {
        const t = s.threads.find((x) => x.chat === e.chat);
        if (!t) {
          s.threads.push({ id: newThreadId(), chat: e.chat, group: false, state: "settled", why: e.why, since: e.at, lastIn: e.at, sort: null, gist: "", sortedAt: null, laterUntil: null, laterSet: null, draft: null, summary: null, repliedAt: null });
          continue;
        }
        if (t.kept || t.sentHere !== undefined || Math.max(t.repliedAt ?? 0, t.doneAt ?? 0) >= e.at) continue;
        if (t.state === "settled" && t.why === e.why) continue;
        if (t.state === "settled" && t.why !== null && !["no-reply", "closing", "ender"].includes(t.why)) continue;
        Object.assign(t, { state: "settled", why: e.why, draft: null, laterUntil: null, held: undefined, lastIn: Math.max(t.lastIn, e.at) });
      }
      const ids = new Map(s.older.map((o) => [o.chat, o.id]));
      const owedChats = new Set(s.threads.filter((t) => t.state === "owed" || t.state === "later").map((t) => t.chat));
      const older = sorted.older.filter((e) => !owedChats.has(e.chat));
      s.older = older.slice(0, MAX_OLDER_ROWS).map((e) => ({ id: ids.get(e.chat) ?? newThreadId(), chat: e.chat, at: e.at, unread: e.unread }));
      s.olderCount = Math.min(9_999, older.length);
      s.scannedAt = now;
    });
    this.d.log.log("backlog scanned", { chats: chats.length, owed: sorted.owed.length, added, older: sorted.older.length, settled: sorted.settled, groups: sorted.groups });
    return { owed: sorted.owed.length, older: sorted.older.length };
  }

  /**
   * "Learn from my texts" (#758): the last 12 months of messages, read once into memory from BlueBubbles' message
   * query, give the numbers (over every sent text) and the sample (./learn.ts). One call through the site, under the
   * texts line's cap; the answer is checked here again, and only traits, tones, relations and numbers are kept.
   */
  async learn(): Promise<RequestResult> {
    if (this.learning || this.d.store.load().paused) return "refused";
    this.learning = true;
    try {
      return await this.learnOnce();
    } finally {
      this.learning = false;
    }
  }

  private async learnOnce(): Promise<RequestResult> {
    const now = this.d.now();
    const contacts = await this.contactList();
    const all: Said[] = [];
    try {
      let from = now - LEARN_WINDOW_MS;
      for (let page = 0; page < LEARN_PAGES; page++) {
        const got = await this.d.bb.since(from, LEARN_PAGE);
        for (const p of got) if (p.inbound) all.push({ chat: p.inbound.chat, group: p.inbound.multi ?? p.inbound.group, fromMe: p.inbound.message.fromMe, text: p.inbound.message.text, at: p.inbound.message.at, handle: p.inbound.message.handle });
        if (got.length < LEARN_PAGE) break;
        const last = got[got.length - 1]!.at;
        // A page that ends where it began (1,000 messages in one millisecond) can't move on; stop rather than loop.
        if (last <= from) break;
        from = last + 1;
      }
    } catch (e) {
      this.d.log.error("voice failed", e);
      return "failed";
    }
    const stats = voiceStats(all);
    const sample = sampleSent(all, (h) => this.contactOf(h), this.skipTerms, contacts, now);
    all.length = 0;
    if (sample.from < LEARN_MIN) {
      this.d.log.log("voice failed", { few: sample.from });
      return "failed";
    }
    let got: Awaited<ReturnType<Site["learn"]>>;
    try {
      got = await this.d.site.learn(sample.input);
    } catch (e) {
      this.d.log.error("voice failed", e);
      this.linkModels = "down";
      return "failed";
    }
    if ("paused" in got) {
      this.budgetStop();
      return "failed";
    }
    this.linkModels = "up";
    const answer = readLearn(got.answer, [...sample.labels.keys()]);
    if (!answer) {
      this.d.log.log("model refused");
      return "failed";
    }
    const relations: Record<string, Relation> = {};
    for (const r of answer.relations) for (const h of sample.labels.get(r.label)?.handles ?? []) relations[handleKey(h)] = r.kind;
    const voice: Voice = { traits: answer.traits, tones: answer.tones, stats, from: sample.from, contacts: sample.contacts, at: now, usd: Math.round(got.usd * 10_000) / 10_000 };
    this.change((s) => {
      s.voice = voice;
      s.relations = relations;
    });
    this.d.log.log("voice learned", { texts: sample.from, contacts: sample.contacts, stats: stats.texts, usd: voice.usd });
    return "done";
  }

  /** Contact photos (#642, ./photos.ts): once a day and at start, only with the Mac's photo key. Counts in the log only. */
  async syncPhotos(): Promise<void> {
    if (!this.d.photoKey || !this.d.resize) return;
    // Marked as running (#891), so `relay check` can say a sync is under way: sips over a few hundred pictures takes time.
    this.change((s) => {
      s.photosRun = this.d.now();
    });
    try {
      const got = await syncPhotos({ bb: this.d.bb, site: this.d.site, key: this.d.photoKey, resize: this.d.resize }, this.d.store.load().photos);
      this.change((s) => {
        s.photos = got.photos;
        s.photosAt = this.d.now();
        s.photosRun = null;
        s.photosFail = got.failed ? { at: this.d.now(), status: got.status, failed: got.failed } : null;
      });
      this.d.log.log("photos synced", { count: got.count, failed: got.failed, unreadable: got.unreadable, ...(got.failed && { status: got.status }) });
    } catch (e) {
      // The HTTP status (a number) says which refusal it was (#891); never the error's words.
      const status = statusOf(e);
      this.change((s) => {
        s.photosRun = null;
        s.photosFail = { at: this.d.now(), status, failed: 0 };
      });
      this.d.log.error("photos failed", e, { status });
    }
  }

  private budgetStop() {
    this.linkModels = "down";
    this.d.log.log("budget stop");
  }

  /**
   * The Desk's requests, polled from the site, each checked here before anything happens: the send key's signature
   * over every field, the 10 minutes, never seen before, and the thread (and for a send, the very draft) on this
   * Mac's own list. Only then does a send go out through BlueBubbles. The result goes back to the site.
   */
  async act(): Promise<void> {
    let raw: unknown[];
    try {
      raw = await this.d.site.requests();
    } catch (e) {
      return this.d.log.error("error", e);
    }
    const results: { rid: string; result: RequestResult; reason?: Reason }[] = [];
    for (const r of raw) {
      const req = readTextRequest(r);
      if (!req) {
        // One this hub can't read (a site newer than the hub): said so, never left "Sending…" until it times out.
        const rid = (r as { rid?: unknown } | null)?.rid;
        if (typeof rid === "string" && RID.test(rid)) results.push({ rid, result: "refused", reason: this.why("unreadable") });
        continue;
      }
      let out: Outcome;
      try {
        out = await this.actOne(req);
      } catch (e) {
        // It may have got as far as BlueBubbles, so it reads as "may have sent", with the reason.
        this.d.log.error("error", e);
        out = { result: "failed", reason: "hub-error" };
      }
      results.push(typeof out === "string" ? { rid: req.rid, result: out } : { rid: req.rid, ...out });
    }
    if (results.length) await this.d.site.results(results).catch((e) => this.d.log.error("error", e));
  }

  /** A reason code, logged as its number on the closed list (the log takes numbers only). */
  private why(reason: Reason): Reason {
    this.d.log.log("request refused", { reason: REASONS.indexOf(reason) });
    return reason;
  }

  /** One request. Exported through `act` only; the only place in the hub that sends. */
  private async actOne(req: NonNullable<ReturnType<typeof readTextRequest>>): Promise<Outcome> {
    const now = this.d.now();
    const state = this.d.store.load();
    const refuse = (reason: Reason) => ({ result: "refused" as const, reason: this.why(reason) });
    if (!requestSigned(this.d.sendKey, req, req.sig)) return refuse("signature");
    if (req.until <= now || req.created > now + 60_000) return refuse("expired");
    if (state.seen.some((e) => e.rid === req.rid)) return refuse("replay");
    // Spent before it acts: a request seen once is never acted on again, whatever happens next.
    this.change((s) => {
      s.seen.push({ rid: req.rid, at: now });
    });
    if (state.paused) return refuse("paused");
    if (req.kind === "compose") return this.compose(req, state);
    // The chores (#758): read every chat again, or learn the voice. Neither names a thread or can send.
    if (req.kind === "rescan") return (await this.backlog()) ? "done" : { result: "failed", reason: this.why("messages-down") };
    if (req.kind === "learn") return this.learn();
    const t = state.threads.find((x) => x.id === req.thread);
    // A card Skippy asked for (#536): its send is checked and sent right here too, and "done" dismisses it.
    const card = t ? undefined : state.cards.find((c) => c.id === req.thread);
    if (card && req.kind === "send") return this.sendCard(req, card);
    if (card && req.kind === "done") {
      this.change((s) => {
        s.cards = s.cards.filter((c) => c.id !== card.id);
      });
      return "done";
    }
    if (!t) return refuse("gone");
    if (req.kind === "react") return this.react(req, t);
    if (req.kind === "send") {
      // A group (#805) takes only Nikita's own typed words (it never has a draft), and only while the Desk lists it:
      // owed, or settled with its summary. A rule match clears the summary, so a ruled group never takes a send.
      const listed = t.state === "owed" || t.state === "later" || (t.group && t.state === "settled" && t.summary !== null);
      if (!listed || (t.group && req.draftAt !== 0)) return refuse("not-owed");
      if (!req.text.trim() || req.text.length > 2_000) return refuse("bad-text");
      // Bound to what Nikita saw (#767): the request carries the text he tapped Send on, signed. A draft Blasto
      // replaced since (a restyle, a draft that landed while he typed his own) doesn't stop it; a message from them
      // newer than what he saw does. Nothing came in after the draft on screen (or, with no draft, after the tap).
      // A group's own words answer the room, not one text, so a busy group's newer texts don't stop them (#805).
      if (!t.group && req.draftAt !== (t.draft?.at ?? 0) && t.lastIn > (req.draftAt || req.created)) return refuse("new-message");
      // Never the same text twice (#870, multi-send): a request id acts once (`seen`, above), and a Resend of one that
      // timed out but went is refused when Messages already shows that very text of Nikita's after their last one.
      // Another text to the same thread goes: Nikita may send more than one.
      // An inline reply (#950): their line, by the ref the Desk was shown; the guid only from this Mac's own memory
      // (`lines`), as for a tapback. BlueBubbles sends a reply only through the Private API.
      let replyTo: string | undefined;
      if (req.reply) {
        if (this.tapbackState === "off") return refuse("tapbacks-off");
        const shown = this.shown.get(t.id) ?? [];
        replyTo = shown.some((m) => m.ref === req.reply && !m.me) ? this.lines.get(t.id)?.get(req.reply) : undefined;
        if (!replyTo) return refuse("no-line");
      }
      const latest = await this.d.bb.messages(t.chat, 10).catch(() => null);
      if (!latest) return refuse("messages-down");
      const same = (a: string) => a.trim().replace(/\s+/g, " ") === req.text.trim().replace(/\s+/g, " ");
      if (latest.some((m) => m.fromMe && m.at > t.lastIn && same(m.text))) return refuse("answered");
      const failed = await this.sendVia(t.chat, req.text, replyTo);
      if (failed) return failed;
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (!x) return;
        // The thread stays in the queue (#870): only Done (or a rule) settles it. The send is counted, the draft goes.
        this.countSend(s, x, this.d.now());
        Object.assign(x, { sentHere: this.d.now(), draft: null, unread: false });
      });
      this.d.log.log("sent");
      return "sent";
    }
    if (req.kind === "later") {
      const until = nextNudge(this.d.config.nudges, now, this.offsetAt) ?? now + 4 * 60 * 60_000;
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x && (x.state === "owed" || x.state === "later")) Object.assign(x, { state: "later", laterUntil: until, laterSet: x.laterSet ?? now });
      });
      this.d.log.log("later");
      return "done";
    }
    if (req.kind === "done") {
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        // #914: Done holds against everything up to now (a scan reads their latest text fresher than lastIn can be).
        if (x) Object.assign(x, { state: "settled", why: "done", draft: null, laterUntil: null, kept: undefined, sentHere: undefined, held: undefined, doneAt: now });
      });
      return "done";
    }
    if (req.kind === "back") {
      // "Bring back" (#870): a thread Dialtone, closing intent or Nikita's own "done" set aside goes back in line and
      // stays owed until he replies. A rule's settle never comes back: its texts never reach a model.
      if (t.group || t.state !== "settled" || !(t.why === "no-reply" || t.why === "closing" || t.why === "done" || t.why === "ender")) return refuse("not-owed");
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x) Object.assign(x, { state: "owed", why: null, sort: null, gist: "", draft: null, laterUntil: null, kept: true, held: undefined, doneAt: undefined });
      });
      this.waits.delete(t.id);
      this.retryAt.delete(t.id);
      this.tries.delete(t.id);
      this.queue.add(t.id);
      this.d.log.log("thread back");
      return "done";
    }
    // draft (#923, "Write for me") and restyle (Nikita's dictated words): for Blasto, on the next round of work.
    if (t.group || (t.state !== "owed" && t.state !== "later")) return refuse("not-owed");
    if (req.kind === "draft") {
      this.wanted.add(t.id);
      this.queue.add(t.id);
      this.d.log.log("draft asked");
      return "done";
    }
    this.restyles.set(t.id, req.text);
    this.queue.add(t.id);
    return "done";
  }

  /**
   * The chat a new text to `handle` goes in, never a guessed number: Relay's own thread with them; else a one-to-one
   * chat Messages already has with that handle (an address exactly, a number by its last 10 digits), iMessage first;
   * else, only for an address or a +country number, a new iMessage chat. A bare number with no chat is null: the card
   * tells Nikita to text that one himself.
   */
  private async chatFor(handle: string, state: RelayState, chats: () => Promise<string[] | null>): Promise<{ chat: string; channel: "iMessage" | "SMS"; fresh?: true } | null> {
    const known = state.threads.filter((t) => !t.group && sameHandle(t.chat.split(";").pop() ?? "", handle)).sort((a, b) => b.lastIn - a.lastIn)[0];
    if (known) return { chat: known.chat, channel: channelOf(known.chat) };
    const have = ((await chats()) ?? []).filter((g) => sameHandle(g.split(";").pop() ?? "", handle));
    const found = have.find((g) => channelOf(g) === "iMessage") ?? have[0];
    if (found) return { chat: found, channel: channelOf(found) };
    const h = chatHandle(handle);
    return startable(h) ? { chat: `iMessage;-;${h}`, channel: "iMessage", fresh: true } : null;
  }

  /**
   * A new text Skippy asked for (#536). Who is found here, on the Mac: no match is a "none" card, several (or one
   * contact with several numbers) a "choices" card for Nikita to pick from, never a guess. The rules run over the ask
   * with the contact's names and handle (the skip list, money and legal, codes) and over every past text used as a
   * style example; a match is an "off" card, with no model call. Blasto then writes it from the placeholdered ask.
   */
  private async compose(req: NonNullable<ReturnType<typeof readTextRequest>>, state: RelayState): Promise<Outcome> {
    const who = req.who ?? "";
    const now = this.d.now();
    const contacts = await this.contactList();
    const existing = state.cards.find((c) => c.id === req.thread);
    const put = (card: Card) =>
      this.change((s) => {
        s.cards = [...s.cards.filter((c) => c.id !== card.id), card].slice(-20);
      });
    let target: CardTarget | null = null;
    let name = who.slice(0, 80);
    if (who.startsWith("pick:")) {
      // One of the choices this Mac offered on that card: its own id, never a handle from the Desk.
      const choice = existing?.state === "choices" ? existing.choices.find((c) => c.pick === who.slice(5)) : undefined;
      if (!choice) return { result: "refused", reason: this.why("gone") };
      target = choice;
      name = choice.name;
    } else {
      if (existing) return { result: "refused", reason: this.why("replay") };
      const found = matchContacts(contacts, who);
      const options = found.flatMap((c) => onePerNumber(c.handles.map(chatHandle)).filter((h) => maskHandle(h)).map((h) => ({ name: (c.names[0] ?? who).slice(0, 80), handle: h })));
      if (!options.length) {
        put({ id: req.thread, state: "none", name, target: null, choices: [], draft: null, at: now });
        return "done";
      }
      // Messages' chats, read once for this ask (null when BlueBubbles didn't answer: then only Relay's own threads
      // and full international numbers or addresses can be texted).
      let list: Promise<string[] | null> | null = null;
      const chats = () => (list ??= this.d.bb.chats().catch(() => null));
      const reachable: CardTarget[] = [];
      for (const o of options.slice(0, 6)) {
        const where = await this.chatFor(o.handle, state, chats);
        if (where) reachable.push({ pick: randomBytes(4).toString("hex"), ...o, ...where });
      }
      if (!reachable.length) {
        put({ id: req.thread, state: "nochat", name: options[0]!.name, target: null, choices: [], draft: null, at: now });
        this.d.log.log("compose settled");
        return "done";
      }
      if (reachable.length > 1) {
        put({ id: req.thread, state: "choices", name, target: null, choices: reachable, draft: null, at: now });
        this.d.log.log("text composed", { choices: reachable.length });
        return "done";
      }
      target = { ...reachable[0]!, pick: "" };
      name = target.name;
    }
    const contact = this.contactOf(target.handle);
    const names = contact?.names ?? [target.name];
    // The rules over the ask itself, with who it goes to: the skip list, money and legal, codes. No model call after one.
    if (settleByRule({ handle: target.handle, names, text: req.text }, this.skipTerms)) {
      put({ id: req.thread, state: "off", name, target: null, choices: [], draft: null, at: now });
      this.d.log.log("compose settled");
      return "done";
    }
    const ph = new Placeholders({ contact: { names, handle: target.handle }, others: contacts.filter((c) => c !== contact).flatMap((c) => c.names) });
    const msgs = (await this.recent(target.chat, 100)) ?? [];
    // Style examples only: Nikita's own past texts to them, each through the rules first. No thread goes with it.
    const mine = msgs.filter((m) => m.fromMe && settleByRule({ handle: target!.handle, names, text: m.text }, this.skipTerms) === null).map((m) => m.text);
    const examples: string[] = [];
    let used = 0;
    for (const e of mine.slice(-CAPS.styleExamples).reverse()) {
      const x = ph.swap(e).slice(0, CAPS.styleChars - used);
      if (!x) break;
      examples.unshift(x);
      used += x.length;
    }
    const intent = ph.swap(req.text).slice(0, CAPS.composeChars).trim();
    if (!intent) return { result: "refused", reason: this.why("bad-text") };
    let got: Awaited<ReturnType<Site["compose"]>>;
    try {
      const voice = this.draftVoice(target.handle);
      got = await this.d.site.compose({ intent, examples, profile: profileOf(mine.slice(-CAPS.styleExamples)), ...(voice && { voice }) });
    } catch (e) {
      this.d.log.error("model error", e);
      this.linkModels = "down";
      return { result: "failed", reason: "model" };
    }
    if ("paused" in got) {
      this.budgetStop();
      return { result: "failed", reason: "model" };
    }
    this.linkModels = "up";
    this.d.log.log("model call", { compose: 1 });
    const answer = readDraft(got.answer);
    if (!answer) {
      this.d.log.log("draft refused");
      return { result: "failed", reason: "model" };
    }
    const at = this.d.now();
    put({ id: req.thread, state: "ready", name, target, choices: [], draft: { text: ph.restore(answer.draft).slice(0, 600), at }, at });
    this.d.log.log("text composed", { ready: 1 });
    return "done";
  }

  /**
   * A tapback (#888): one of the six, on one of their lines the Desk was shown for a listed thread, by its ref. The guid
   * comes from this Mac's own memory (`lines`), never from the request. It goes through BlueBubbles' react route (the
   * Private API); it settles nothing and counts as no reply. Signature, 10 minutes and single use were checked in `actOne`.
   */
  private async react(req: NonNullable<ReturnType<typeof readTextRequest>>, t: Thread): Promise<Outcome> {
    const refuse = (reason: Reason) => ({ result: "refused" as const, reason: this.why(reason) });
    const listed = t.state === "owed" || t.state === "later" || (t.group && t.state === "settled" && t.summary !== null);
    if (!listed || req.draftAt !== 0) return refuse("not-owed");
    const tb = readTapback(req.text);
    if (!tb) return refuse("bad-text");
    if (this.tapbackState === "off") return refuse("tapbacks-off");
    const shown = this.shown.get(t.id) ?? [];
    const guid = shown.some((m) => m.ref === tb.ref && !m.me) ? this.lines.get(t.id)?.get(tb.ref) : undefined;
    if (!guid) return refuse("no-line");
    try {
      if (!(await this.d.bb.react(t.chat, guid, tb.tapback))) return { result: "failed", reason: "bb-refused" };
    } catch (e) {
      // The Private API off (or its helper gone) since the last check: said so, and the Desk's buttons give way.
      if (e instanceof BlueBubblesError && e.kind === "http" && /private api|helper/i.test(e.detail)) {
        this.tapbackState = "off";
        this.dirty = true;
        return refuse("tapbacks-off");
      }
      const reason = sendReason(e);
      this.d.log.log("tapback failed", { reason: REASONS.indexOf(reason), status: e instanceof BlueBubblesError ? e.status : 0 });
      return { result: "failed", reason };
    }
    this.d.log.log("tapback sent");
    return "sent";
  }

  /** A card's send (#536): the card's own recipient, the very text version on screen, and never twice. */
  private async sendCard(req: NonNullable<ReturnType<typeof readTextRequest>>, card: Card): Promise<Outcome> {
    const refuse = (reason: Reason) => ({ result: "refused" as const, reason: this.why(reason) });
    if (card.state !== "ready" || !card.target || !card.draft) return refuse(card.state === "sent" ? "answered" : "gone");
    if (req.draftAt !== card.draft.at) return refuse("changed");
    if (!req.text.trim() || req.text.length > 2_000) return refuse("bad-text");
    const target = card.target;
    // Messages shows Nikita texted them since the card was made: this very text (a send that timed out but went) marks
    // the card sent; anything else means the card is behind the chat, so it says so and sends nothing. A chat this card
    // starts has no messages yet.
    const latest = await this.d.bb.messages(target.chat, 10).catch(() => (target.fresh ? [] : null));
    if (!latest) return refuse("messages-down");
    const mine = latest.filter((m) => m.fromMe && m.at >= card.at);
    if (mine.length) {
      const went = mine.some((m) => m.text.trim() === req.text.trim());
      this.change((s) => {
        const c = s.cards.find((x) => x.id === card.id);
        if (c) Object.assign(c, { state: went ? "sent" : "moved", draft: null });
      });
      return refuse("answered");
    }
    const failed = await this.sendVia(target.chat, req.text);
    if (failed) return failed;
    this.change((s) => {
      const c = s.cards.find((x) => x.id === card.id);
      if (c) Object.assign(c, { state: "sent", draft: null });
    });
    this.d.log.log("sent", { card: 1 });
    return "sent";
  }

  /**
   * The one BlueBubbles send (#767): null when it went, else "failed" with why (a timeout may still have sent; the
   * Desk says so). The log gets the reason's number and BlueBubbles' HTTP status, never its words.
   */
  private async sendVia(chat: string, text: string, replyTo?: string): Promise<{ result: "failed"; reason: Reason } | null> {
    let reason: Reason | null = null;
    let status = 0;
    try {
      if (!(await this.d.bb.send(chat, text, `relay-${randomUUID()}`, replyTo))) reason = "bb-refused";
    } catch (e) {
      // A reply with the Private API off (or its helper gone) since the last check (#950): said so, like a tapback.
      if (replyTo && e instanceof BlueBubblesError && e.kind === "http" && /private api|helper/i.test(e.detail)) {
        this.tapbackState = "off";
        this.dirty = true;
        this.d.log.log("send failed", { reason: REASONS.indexOf("tapbacks-off"), status: e.status });
        return { result: "failed", reason: "tapbacks-off" };
      }
      reason = sendReason(e);
      status = e instanceof BlueBubblesError ? e.status : 0;
    }
    if (!reason) return null;
    this.d.log.log("send failed", { reason: REASONS.indexOf(reason), status });
    if (reason === "mac-permission") this.d.log.log("mac permission");
    return { result: "failed", reason };
  }

  /** The hourly sweep (and at start-up): every kind of row ends by its deadline (docs/RELAY-PRIVACY.md, "Retention"). */
  sweep(): void {
    const now = this.d.now();
    this.change((s) => {
      for (const t of s.threads) {
        if (t.draft && now - t.draft.at > DRAFT_KEEP_MS) t.draft = null;
        if (t.summary && now - t.summary.at > SUMMARY_KEEP_MS) t.summary = null;
        if (t.state === "later" && t.laterUntil !== null && t.laterUntil <= now) Object.assign(t, { state: "owed", laterUntil: null });
        if (t.laterSet !== null && now - t.laterSet > LATER_KEEP_MS) Object.assign(t, { laterUntil: null, laterSet: null, state: t.state === "later" ? "owed" : t.state });
      }
      // The older-unanswered snapshot ends a week after the scan that made it (the hub scans daily).
      if (s.scannedAt !== null && now - s.scannedAt > OLDER_KEEP_MS) {
        s.older = [];
        s.olderCount = 0;
      }
      // An owed thread past the 30-day window (#758) leaves the list for the older-unanswered snapshot.
      for (const t of s.threads) {
        if ((t.state === "owed" || t.state === "later") && !t.group && now - t.lastIn > owedWindow(t.unread) && !s.older.some((o) => o.chat === t.chat)) {
          s.older.unshift({ id: newThreadId(), chat: t.chat, at: t.lastIn, unread: t.unread === true });
          s.olderCount = Math.min(9_999, s.olderCount + 1);
        }
      }
      // A one-to-one thread is remembered through the owed window (#870: the Desk lists every recent one, set aside or
      // answered, by date), so a Rescan doesn't bring back what Nikita dismissed; a group's row goes after a week.
      // Rows hold no text.
      const keep = (t: Thread) => (t.group ? THREAD_KEEP_MS : OWED_WINDOW_MS);
      s.threads = s.threads.filter((t) => ((t.state === "owed" || t.state === "later") && now - t.lastIn <= owedWindow(t.unread)) || (t.state !== "owed" && t.state !== "later" && now - Math.max(t.repliedAt ?? 0, t.lastIn, t.doneAt ?? 0) < keep(t)));
      s.older = s.older.slice(0, MAX_OLDER_ROWS);
      const today = midnightOf(now, this.offsetAt);
      // The streak: each day that ended with nobody left past their window adds one; a day that didn't resets it.
      if (s.streak.lastDay === null) s.streak = { days: 0, lastDay: today };
      else if (s.streak.lastDay < today) {
        const late = s.threads.some((t) => (t.state === "owed" || t.state === "later") && today - t.since > OVERDUE_MS);
        s.streak = { days: late ? 0 : s.streak.days + 1, lastDay: today };
      }
      s.days = s.days.filter((d) => today - d.day < 7 * 86_400_000);
      s.seen = s.seen.filter((e) => now - e.at < SEEN_KEEP_MS);
      s.cards = s.cards.filter((c) => now - c.at < CARD_KEEP_MS);
      s.sweptAt = now;
      // The Desk's copies (#758) go with their threads.
      const listed = new Set(s.threads.filter((t) => t.state === "owed" || t.state === "later" || (t.group && t.summary)).map((t) => t.id));
      for (const id of [...this.shown.keys()]) if (!listed.has(id)) this.forget(id);
    });
    this.d.log.log("sweep");
  }

  setHub(state: "listening" | "paused" | "error") {
    this.hubState = state;
    this.dirty = true;
  }

  async checkMessages(): Promise<void> {
    this.linkMessages = (await this.d.bb.ping()) ? "up" : "down";
    // Contacts asked again while there are none (#861), so names appear soon after macOS lets BlueBubbles read them.
    if (this.linkMessages === "up" && !this.contacts.length) await this.contactList();
  }

  pause(): void {
    this.change((s) => {
      s.paused = true;
    });
    this.queue.clear();
    this.restyles.clear();
    this.wanted.clear();
    this.hubState = "paused";
    this.d.log.log("hub paused");
  }

  resume(): void {
    this.change((s) => {
      s.paused = false;
    });
    this.hubState = "listening";
    this.d.log.log("hub resumed");
  }

  /** The counts for the site, checked against the allowlist before they go. */
  status(): RelayStatus | null {
    const s = this.d.store.load();
    const now = this.d.now();
    const owedT = s.threads.filter((t) => t.state === "owed" || t.state === "later");
    const today = midnightOf(now, this.offsetAt);
    const week: Day[] = [...s.days].filter((d) => today - d.day < 7 * 86_400_000 && d.day >= Date.UTC(2026, 0, 1)).sort((a, b) => a.day - b.day).slice(-7);
    const cap = (n: number) => Math.min(9_999, n);
    const status: RelayStatus = {
      v: RELAY_STATUS_VERSION,
      at: now,
      hub: s.paused ? "paused" : this.hubState,
      messages: this.linkMessages,
      models: this.linkModels,
      owed: cap(owedT.length),
      sooner: cap(owedT.filter((t) => t.state === "owed" && t.sort === "sooner").length),
      overdue: cap(owedT.filter((t) => now - t.since > OVERDUE_MS).length),
      later: cap(owedT.filter((t) => t.state === "later").length),
      settled: cap(s.threads.filter((t) => t.state === "settled").length),
      draftsReady: cap(owedT.filter((t) => t.draft).length),
      sentToday: cap(s.days.find((d) => d.day === today)?.sent ?? 0),
      streakDays: cap(s.streak.days),
      week: week.map((d) => ({ day: d.day, sent: cap(d.sent), medianMinutes: median(d.minutes) === null ? null : Math.min(43_200, median(d.minutes)!) })),
      nextNudgeAt: s.paused ? null : nextNudge(this.d.config.nudges, now, this.offsetAt),
      unread: cap(owedT.filter((t) => t.unread === true).length),
      older: cap(s.olderCount),
      // How many contacts BlueBubbles let the hub read (#861): 0 means macOS keeps Contacts from BlueBubbles. A count only.
      ...(this.contactsAsked && { contacts: cap(this.contacts.length) }),
    };
    const read = readRelayStatus(status);
    if (!read.ok) {
      this.d.log.log("status refused");
      return null;
    }
    return read.status;
  }

  /**
   * The who's-waiting list for the Desk: who, when, the states and the models' words, and (#758) an owed thread's own
   * newest texts, for Nikita's eyes only (sealed on the site), never from a thread a rule settled, a week old at most.
   */
  texts(): TextsView {
    const s = this.d.store.load();
    const now = this.d.now();
    const owedState = (t: Thread) => t.state === "owed" || t.state === "later";
    const shownNow = (t: Thread) => (this.shown.get(t.id) ?? []).filter((m) => now - m.at < Math.max(SHOWN_KEEP_MS, owedState(t) ? owedWindow(t.unread) : 0));
    // Owed ones within the 30-day window (#758), newest first (#803: oldest first, the cap cut the newest ones off the
    // list); then the groups' summaries from the last week. The Desk orders them itself.
    const items: TextItem[] = s.threads
      // An owed thread is listed while their latest text is inside the window (#861: by `since`, the first unanswered
      // one, a thread they kept writing in for over 30 days was counted owed and never shown).
      // #924: one Nikita keeps unread in Messages stays 60 days.
      .filter((t) => t.state !== "replied" && (t.state !== "settled" || (t.group && t.summary)) && (owedState(t) ? now - t.lastIn < owedWindow(t.unread) : now - t.since < THREAD_KEEP_MS))
      .sort((a, b) => Number(owedState(b)) - Number(owedState(a)) || b.lastIn - a.lastIn)
      .slice(0, MAX_ITEMS)
      .map((t) => {
        const { name, photo } = this.whoOf(t.chat);
        return {
          id: t.id,
          name: name.slice(0, 80),
          channel: channelOf(t.chat),
          group: t.group,
          state: t.state === "replied" ? "settled" : t.state,
          sort: t.sort,
          since: Math.max(Date.UTC(2026, 0, 1), Math.floor(t.since)),
          // Their latest text (#895): the site keeps an owed item by it, as this list and `relay check` do.
          ...(owedState(t) && { last: Math.max(Date.UTC(2026, 0, 1), Math.floor(t.since), Math.floor(t.lastIn)) }),
          laterUntil: t.laterUntil === null ? null : Math.floor(t.laterUntil),
          gist: t.gist.slice(0, 160),
          draft: t.draft ? { text: t.draft.text.slice(0, 600), at: Math.floor(t.draft.at) } : null,
          summary: t.summary ? { text: t.summary.text.slice(0, 300), asked: t.summary.asked } : null,
          ...(photo && s.photos[photo] && { photo }),
          ...(owedState(t) && t.unread === true && { unread: true as const }),
          // Their own texts (#758): an owed one-to-one thread's unanswered ones, a group's since Nikita's last reply.
          ...((owedState(t) || t.group) && shownNow(t).length && { messages: shownNow(t) }),
          // Why there's no gist yet (#861), from a closed list.
          ...(this.waitFor(t) && { wait: this.waitFor(t) }),
          // How many of their unanswered texts are only a photo or file (#870): a count, never the attachment.
          ...(owedState(t) && !t.group && t.media && { media: Math.min(999, t.media) }),
          // Muted in Messages (#950): a mark only.
          ...(t.muted && { muted: true as const }),
        };
      });
    // Every other one-to-one thread with a text from them in the window (#870, Nikita 2026-11-05: every recent
    // conversation on the line, by date): who, when and why it is set aside, from a closed list. No text, no gist.
    // The skip list's never show, nor a thread Nikita answered.
    const aside: AsideItem[] = s.threads
      .filter((t) => !t.group && t.state === "settled" && t.why !== null && ASIDE_OF[t.why] !== undefined && now - t.lastIn < OLDER_WINDOW_MS && t.lastIn >= Date.UTC(2026, 0, 1))
      .sort((a, b) => b.lastIn - a.lastIn)
      .slice(0, MAX_ASIDE)
      .map((t) => {
        const { name, photo } = this.whoOf(t.chat);
        return { id: t.id, name: name.slice(0, 80), channel: channelOf(t.chat), since: Math.floor(t.lastIn), why: ASIDE_OF[t.why!] as AsideWhy, ...(photo && s.photos[photo] && { photo }) };
      });
    // Older unanswered (#758): who and since when, no gist or draft. Someone not in the contacts reads as the owed ones
    // do (#861): the number's last 4 digits or a masked address, never the handle.
    const olderItems: OlderItem[] = s.older.slice(0, MAX_OLDER).map((o) => {
      const { name, photo } = this.whoOf(o.chat);
      return { id: o.id, name: name.slice(0, 80), channel: channelOf(o.chat), since: Math.max(Date.UTC(2026, 0, 1), Math.floor(o.at)), ...(photo && s.photos[photo] && { photo }), ...(o.unread && { unread: true as const }) };
    });
    // The cards (#536): who (name and mask, never the handle), the text, the choices. Newest first.
    const cards: TextCard[] = s.cards
      .filter((c) => now - c.at < CARD_KEEP_MS)
      .sort((a, b) => b.at - a.at)
      .slice(0, 10)
      .flatMap((c): TextCard[] => {
        const mask = c.target ? maskHandle(c.target.handle) : null;
        if (c.state === "ready" && (!mask || !c.draft)) return [];
        return [
          {
            id: c.id,
            state: c.state,
            name: c.name.replace(/\s+/g, " ").slice(0, 80) || "Someone",
            mask: c.state === "ready" || c.state === "sent" ? mask : null,
            channel: c.target?.channel ?? "iMessage",
            draft: c.state === "ready" && c.draft ? { text: c.draft.text.slice(0, 600), at: Math.floor(c.draft.at) } : null,
            choices: c.state === "choices" ? c.choices.flatMap((x) => { const m = maskHandle(x.handle); return m ? [{ pick: x.pick, name: x.name.replace(/\s+/g, " ").slice(0, 80), mask: m, channel: x.channel }] : []; }) : [],
            at: Math.max(Date.UTC(2026, 0, 1), Math.floor(c.at)),
          },
        ];
      })
      .filter((c) => c.state !== "choices" || c.choices.length > 0);
    return { v: 1, at: now, items, cards, older: { count: Math.max(olderItems.length, s.olderCount), items: olderItems }, scannedAt: s.scannedAt === null ? null : Math.max(Date.UTC(2026, 0, 1), Math.floor(s.scannedAt)), voice: s.voice, aside, ...(this.tapbackState && { tapbacks: this.tapbackState }) };
  }

  /**
   * Who a chat is with, as the Desk names it: a one-to-one chat's contact (someone not in the contacts by the number's
   * last 4 digits or a masked address, #803, never the handle) and their photo id (#642, an opaque id, only when that
   * photo is on the site); a chat of several by its name in Messages, else (#916) a small one its people's first names,
   * a stranger by their mask, and (#923, Nikita: two chips both read "Group chat") an unnamed group its first two
   * people and how many more ("Alex, Sam +5"); "Group chat" only while its people aren't known.
   */
  private whoOf(chat: string): { name: string; photo: string } {
    const photos = this.d.store.load().photos;
    if (isGroupChat(chat)) {
      const named = this.groupNames.get(chat);
      if (named) return { name: named.slice(0, 80), photo: "" };
      const members = this.people.get(chat) ?? [];
      const names = members.map((h) => this.contactOf(h)?.names[0]?.split(/\s+/)[0] || maskHandle(h) || "Unknown").filter(Boolean);
      return { name: peopleName(names, this.groupOf(chat)), photo: "" };
    }
    const handle = chatPerson(chat);
    const contact = this.contactOf(handle);
    const mask = contact ? null : maskHandle(handle);
    const photo = contact && this.d.photoKey ? photoIdOf(this.d.photoKey, contact.handles) : "";
    return { name: contact?.names[0] || (mask ? `Unknown (${mask})` : "Unknown sender"), photo: photo && photos[photo] ? photo : "" };
  }

  /** Sends the status and the list when something changed (or `force`). */
  async report(force = false): Promise<void> {
    if (!this.dirty && !force) return;
    this.dirty = false;
    await this.fillShown().catch((e) => this.d.log.error("error", e));
    const status = this.status();
    try {
      if (status) {
        await this.d.site.status(status);
        this.d.log.log("status sent", { owed: status.owed });
      }
      await this.d.site.texts(this.texts());
    } catch (e) {
      this.dirty = true;
      this.d.log.error("status failed", e);
    }
  }

  /** Whether any work waits (for tests and the loop). */
  pending(): number {
    return this.queue.size;
  }
}
