import { randomBytes, randomUUID } from "node:crypto";
import { readRelayStatus, RELAY_STATUS_VERSION, type RelayStatus } from "@ceo/core";
import { CAPS, readDraft, readSort, within, type Line, type StyleProfile } from "../../../api/_relay/models.ts";
import { CARD_KEEP_MS, readTextRequest, type RequestResult, type TextCard, type TextItem, type TextsView } from "../../../api/_relay/texts.ts";
import { maskHandle, matchContacts } from "../../../api/_relay/compose.ts";
import { requestSigned } from "../../../api/_relay/tokens.ts";
import { channelOf, type BlueBubbles, type Contact, type Inbound, type Message } from "./bluebubbles.ts";
import type { HubConfig } from "./config.ts";
import type { Logger } from "./log.ts";
import { Placeholders } from "./placeholders.ts";
import { settleByRule } from "./rules.ts";
import type { Site } from "./site.ts";
import { newThreadId, type Card, type CardTarget, type Day, type RelayState, type StateStore, type Thread } from "./store.ts";

/**
 * Relay's texts line on the Mac (#535, docs/RELAY-PRIVACY.md): the engine the launchd job runs.
 *
 *   in     BlueBubbles' webhook (./server.ts) hands each new message to `onMessage`. Paused, it is ignored.
 *          Nikita's own message settles the thread as replied. Anything else is settled by rule on the Mac (skip
 *          list, money and legal, short codes, one-time codes, promos: ./rules.ts) or marked owed and queued.
 *   sort   `work` reads the thread's last messages from BlueBubbles into memory, swaps names and numbers for
 *          placeholders, trims, and sends the snippet to the site for Dialtone (Haiku): a reply owed or not, sooner or
 *          normal, a one-line gist. A group gets a two-sentence summary and never a draft.
 *   draft  for an owed one-to-one thread, the same for Blasto (Sonnet), with up to 8 of Nikita's own past replies to
 *          that contact as style examples. Names go back in only on the Mac, into the draft.
 *   out    the counts (RelayStatus) and the who's-waiting list (names, gists, drafts) go to the site; no message body.
 *   act    the Desk's requests, polled from the site. A send goes out through BlueBubbles only when its signature,
 *          its 10 minutes, its single use and its thread and draft all check out here (`act`). Nothing else in the hub
 *          calls `bb.send`.
 *   card   a new text Skippy asked for (#536, a "compose" request): the contact found here, on the Mac, by name (the
 *          choices when it fits several, never a guess), the rules run over the ask and every past text used as a
 *          style example, Blasto writes it from the placeholdered ask, and the card (name, last 4 digits or a masked
 *          address, the text) goes to the site with the list. Its send is an ordinary send request, through `act`.
 *
 * Logs carry kinds and counts only (./log.ts). Message text lives in memory for one call at a time.
 */

export const OVERDUE_MS = 24 * 60 * 60_000;
/** How long the engine waits after the latest message before it sorts, so a burst of texts is one call. */
export const SETTLE_MS = 20_000;
export const THREAD_KEEP_MS = 7 * 24 * 60 * 60_000;
export const DRAFT_KEEP_MS = 7 * 24 * 60 * 60_000;
export const SUMMARY_KEEP_MS = 48 * 60 * 60_000;
export const LATER_KEEP_MS = 14 * 24 * 60 * 60_000;
export const SEEN_KEEP_MS = 24 * 60 * 60_000;

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

/** A contact's handle as Messages' chat ids write it: an address lower-cased, a number in +digits form. */
export function chatHandle(h: string): string {
  const t = h.trim();
  if (t.includes("@")) return t.toLowerCase();
  const d = t.replace(/\D/g, "");
  if (t.startsWith("+")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d.length > 11 ? `+${d}` : d;
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

export class Engine {
  private queue = new Set<string>();
  private restyles = new Map<string, string>();
  private contacts: Contact[] = [];
  private contactsAt = 0;
  private groupNames = new Map<string, string>();
  private skipTerms: string[] = [];
  private skipAt = 0;
  private linkMessages: "up" | "down" | "unknown" = "unknown";
  private linkModels: "up" | "down" | "unknown" = "unknown";
  private hubState: "starting" | "listening" | "paused" | "error" = "starting";
  private working = false;
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
        this.contacts = await this.d.bb.contacts();
        this.contactsAt = this.d.now();
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

  /** One message from BlueBubbles' webhook. */
  async onMessage(m: Inbound): Promise<void> {
    const state = this.d.store.load();
    if (state.paused) return;
    await this.contactList();
    if (m.group && m.groupName) this.groupNames.set(m.chat, m.groupName);
    const at = m.message.at;
    this.change((s) => {
      let t = s.threads.find((x) => x.chat === m.chat);
      if (!t) {
        t = { id: newThreadId(), chat: m.chat, group: m.group, state: "settled", why: null, since: at, lastIn: at, sort: null, gist: "", sortedAt: null, laterUntil: null, laterSet: null, draft: null, summary: null, repliedAt: null };
        s.threads.push(t);
      }
      if (m.message.fromMe) {
        if (t.state === "owed" || t.state === "later") this.replied(s, t, at);
        if (t.group) t.summary = null;
        return;
      }
      t.lastIn = Math.max(t.lastIn, at);
      if (t.group) {
        t.state = "settled";
        t.why = "group";
        this.queue.add(t.id);
        this.d.log.log("thread settled", { group: 1 });
        return;
      }
      const contact = this.contactOf(m.message.handle);
      const why = settleByRule({ handle: m.message.handle, names: contact?.names ?? [], text: m.message.text }, this.skipTerms);
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
    t.draft = null;
    t.laterUntil = null;
    this.d.log.log("thread replied", { minutes });
  }

  /** Sorts (and drafts for) the queued threads, one call at a time, each once its burst has settled. */
  async work(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      for (const id of [...this.queue]) {
        const s = this.d.store.load();
        if (s.paused) return;
        const t = s.threads.find((x) => x.id === id);
        if (!t) {
          this.queue.delete(id);
          continue;
        }
        if (this.d.now() - t.lastIn < SETTLE_MS && !this.restyles.has(id)) continue;
        this.queue.delete(id);
        try {
          if (t.group) await this.summarise(t);
          else if (t.state === "owed" || t.state === "later") await this.sortAndDraft(t);
        } catch (e) {
          this.d.log.error("model error", e);
          this.linkModels = "down";
        }
      }
    } finally {
      this.working = false;
    }
  }

  private async recent(chat: string, limit: number): Promise<Message[] | null> {
    try {
      const got = await this.d.bb.messages(chat, limit);
      this.linkMessages = "up";
      return got.filter((m) => m.text.trim()).sort((a, b) => a.at - b.at);
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
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x) x.summary = null;
      });
      this.d.log.log("thread settled", { rule: 1, group: 1 });
      return;
    }
    // Trimmed here, on the Mac, to the privacy page's caps: only what the call may see leaves the Mac.
    const lines: Line[] = within(
      since.map((m) => ({ from: m.fromMe ? "me" : `Member ${handles.indexOf(m.handle) + 1}`, text: ph.swap(m.text), ago: (this.d.now() - m.at) / 60_000 })),
      CAPS.groupMessages,
      CAPS.groupChars,
    );
    const got = await this.d.site.sort({ group: true, lines });
    if ("paused" in got) return this.budgetStop();
    const answer = readSort(got.answer, true);
    this.linkModels = "up";
    this.d.log.log("model call", { group: 1 });
    if (!answer || !("summary" in answer)) return this.d.log.log("model refused");
    this.change((s) => {
      const x = s.threads.find((y) => y.id === t.id);
      if (x) x.summary = { text: ph.restore(answer.summary), asked: answer.asked, at: this.d.now() };
    });
    this.d.log.log("group summarised");
  }

  private async sortAndDraft(t: Thread): Promise<void> {
    const msgs = await this.recent(t.chat, 100);
    if (!msgs) return;
    const contacts = await this.contactList();
    const theirs = msgs.find((m) => !m.fromMe)?.handle ?? "";
    const contact = this.contactOf(theirs);
    const ph = new Placeholders({ contact: { names: contact?.names ?? [], handle: theirs }, others: contacts.filter((c) => c !== contact).flatMap((c) => c.names) });
    const lastMine = msgs.map((m) => m.fromMe).lastIndexOf(true);
    const unanswered = msgs.slice(lastMine + 1).filter((m) => !m.fromMe);
    if (!unanswered.length) return;
    // Every rule once more, over everything the calls below could carry: the whole unanswered run and the earlier
    // turns the draft sees (both sides). A skip-listed contact, a money or legal text, a code or a promo anywhere in
    // it settles the thread before anything reaches a model, so a thread with money talk is never sent, even after
    // Nikita answered it and a harmless text came in.
    const earliest = Math.max(0, lastMine - (CAPS.draftEarlier - 1));
    const seen = msgs.slice(earliest);
    const ruled = seen.map((m) => settleByRule({ handle: theirs, names: contact?.names ?? [], text: m.text }, this.skipTerms)).find((w) => w !== null);
    if (ruled) {
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x) Object.assign(x, { state: "settled", why: ruled, draft: null, gist: "", laterUntil: null });
      });
      this.d.log.log("thread settled", { rule: 1 });
      return;
    }
    const line = (m: Message): Line => ({ from: m.fromMe ? "me" : "them", text: ph.swap(m.text), ago: (this.d.now() - m.at) / 60_000 });
    const restyle = this.restyles.get(t.id);
    this.restyles.delete(t.id);
    if (!t.sort || !restyle) {
      const got = await this.d.site.sort({ group: false, lines: within(unanswered.map(line), CAPS.sortMessages, CAPS.sortChars) });
      if ("paused" in got) return this.budgetStop();
      this.linkModels = "up";
      this.d.log.log("model call", { sort: 1 });
      const answer = readSort(got.answer, false);
      if (!answer || !("needsReply" in answer)) return this.d.log.log("model refused");
      const settled = !answer.needsReply;
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (!x) return;
        x.sort = answer.sort;
        x.gist = ph.restore(answer.gist);
        x.sortedAt = this.d.now();
        if (settled) Object.assign(x, { state: "settled", why: "no-reply", draft: null });
      });
      this.d.log.log("sorted", { sooner: answer.sort === "sooner" ? 1 : 0 });
      if (settled) return;
    }
    // Trimmed here, on the Mac: the answered run and a few turns before it, the newest kept first, within the caps;
    // up to 8 of Nikita's own replies as examples, 1,500 characters in all.
    const context = within(seen.map(line), CAPS.draftEarlier + CAPS.sortMessages, CAPS.draftChars);
    // Style examples come from further back, so one that trips a rule is left out (not settled on: an old reply about
    // money shouldn't stop every draft in the thread for good); the context above is already clean.
    const mine = msgs.filter((m) => m.fromMe && settleByRule({ handle: theirs, names: contact?.names ?? [], text: m.text }, this.skipTerms) === null).map((m) => m.text);
    const examples: string[] = [];
    let used = 0;
    for (const e of mine.slice(-CAPS.styleExamples).reverse()) {
      const x = ph.swap(e).slice(0, CAPS.styleChars - used);
      if (!x) break;
      examples.unshift(x);
      used += x.length;
    }
    const got = await this.d.site.draft({ lines: context, examples, profile: profileOf(mine.slice(-CAPS.styleExamples)), ...(restyle && { dictated: ph.swap(restyle).slice(0, CAPS.dictatedChars) }) });
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
    const results: { rid: string; result: RequestResult }[] = [];
    for (const r of raw) {
      const req = readTextRequest(r);
      if (!req) continue;
      results.push({ rid: req.rid, result: await this.actOne(req) });
    }
    if (results.length) await this.d.site.results(results).catch((e) => this.d.log.error("error", e));
  }

  /** One request. Exported through `act` only; the only place in the hub that sends. */
  private async actOne(req: NonNullable<ReturnType<typeof readTextRequest>>): Promise<RequestResult> {
    const now = this.d.now();
    const state = this.d.store.load();
    const refuse = () => {
      this.d.log.log("request refused");
      return "refused" as const;
    };
    if (!requestSigned(this.d.sendKey, req, req.sig)) return refuse();
    if (req.until <= now || req.created > now + 60_000) return refuse();
    if (state.seen.some((e) => e.rid === req.rid)) return refuse();
    // Spent before it acts: a request seen once is never acted on again, whatever happens next.
    this.change((s) => {
      s.seen.push({ rid: req.rid, at: now });
    });
    if (state.paused) return refuse();
    if (req.kind === "compose") return this.compose(req, state);
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
    if (!t) return refuse();
    if (req.kind === "send") {
      if (t.group || (t.state !== "owed" && t.state !== "later") || req.draftAt !== (t.draft?.at ?? 0) || !req.text.trim() || req.text.length > 2_000) return refuse();
      // Already answered (an earlier send that timed out but went, or a reply from the phone the webhook missed):
      // BlueBubbles shows a message of Nikita's newer than the last one in. Never send twice.
      const latest = await this.d.bb.messages(t.chat, 5).catch(() => null);
      if (!latest) return refuse();
      const answered = latest.filter((m) => m.fromMe).reduce((a, m) => Math.max(a, m.at), 0);
      if (answered > t.lastIn) {
        this.change((s) => {
          const x = s.threads.find((y) => y.id === t.id);
          if (x) this.replied(s, x, answered);
        });
        return refuse();
      }
      const ok = await this.d.bb.send(t.chat, req.text, `relay-${randomUUID()}`).catch(() => false);
      if (!ok) {
        this.d.log.log("send failed");
        return "failed";
      }
      this.change((s) => {
        const x = s.threads.find((y) => y.id === t.id);
        if (x) this.replied(s, x, this.d.now());
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
        if (x) Object.assign(x, { state: "settled", why: "done", draft: null, laterUntil: null });
      });
      return "done";
    }
    // restyle: Nikita's dictated words, for Blasto, on the next round of work.
    if (t.group || (t.state !== "owed" && t.state !== "later")) return refuse();
    this.restyles.set(t.id, req.text);
    this.queue.add(t.id);
    return "done";
  }

  /** The chat a new text to `handle` goes in: Relay's own thread with them, else the one Messages has, else a new iMessage. */
  private async chatFor(handle: string, state: RelayState): Promise<{ chat: string; channel: "iMessage" | "SMS" }> {
    const known = state.threads.filter((t) => !t.group && sameHandle(t.chat.split(";").pop() ?? "", handle)).sort((a, b) => b.lastIn - a.lastIn)[0];
    if (known) return { chat: known.chat, channel: channelOf(known.chat) };
    const h = chatHandle(handle);
    for (const svc of h.includes("@") ? (["iMessage"] as const) : (["iMessage", "SMS"] as const)) {
      const chat = `${svc};-;${h}`;
      const got = await this.d.bb.messages(chat, 1).catch(() => null);
      if (got && got.length) return { chat, channel: svc };
    }
    return { chat: `iMessage;-;${h}`, channel: "iMessage" };
  }

  /**
   * A new text Skippy asked for (#536). Who is found here, on the Mac: no match is a "none" card, several (or one
   * contact with several numbers) a "choices" card for Nikita to pick from, never a guess. The rules run over the ask
   * with the contact's names and handle (the skip list, money and legal, codes) and over every past text used as a
   * style example; a match is an "off" card, with no model call. Blasto then writes it from the placeholdered ask.
   */
  private async compose(req: NonNullable<ReturnType<typeof readTextRequest>>, state: RelayState): Promise<RequestResult> {
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
      if (!choice) {
        this.d.log.log("request refused");
        return "refused";
      }
      target = choice;
      name = choice.name;
    } else {
      if (existing) {
        this.d.log.log("request refused");
        return "refused";
      }
      const found = matchContacts(contacts, who);
      const options = found.flatMap((c) => [...new Set(c.handles.map(chatHandle))].filter((h) => maskHandle(h)).map((h) => ({ name: (c.names[0] ?? who).slice(0, 80), handle: h })));
      if (!options.length) {
        put({ id: req.thread, state: "none", name, target: null, choices: [], draft: null, at: now });
        return "done";
      }
      if (options.length > 1) {
        const choices: CardTarget[] = [];
        for (const o of options.slice(0, 6)) choices.push({ pick: randomBytes(4).toString("hex"), ...o, ...(await this.chatFor(o.handle, state)) });
        put({ id: req.thread, state: "choices", name, target: null, choices, draft: null, at: now });
        this.d.log.log("text composed", { choices: choices.length });
        return "done";
      }
      target = { pick: "", ...options[0]!, ...(await this.chatFor(options[0]!.handle, state)) };
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
    if (!intent) return "refused";
    let got: Awaited<ReturnType<Site["compose"]>>;
    try {
      got = await this.d.site.compose({ intent, examples, profile: profileOf(mine.slice(-CAPS.styleExamples)) });
    } catch (e) {
      this.d.log.error("model error", e);
      this.linkModels = "down";
      return "failed";
    }
    if ("paused" in got) {
      this.budgetStop();
      return "failed";
    }
    this.linkModels = "up";
    this.d.log.log("model call", { compose: 1 });
    const answer = readDraft(got.answer);
    if (!answer) {
      this.d.log.log("draft refused");
      return "failed";
    }
    const at = this.d.now();
    put({ id: req.thread, state: "ready", name, target, choices: [], draft: { text: ph.restore(answer.draft).slice(0, 600), at }, at });
    this.d.log.log("text composed", { ready: 1 });
    return "done";
  }

  /** A card's send (#536): the card's own recipient, the very text version on screen, and never twice. */
  private async sendCard(req: NonNullable<ReturnType<typeof readTextRequest>>, card: Card): Promise<RequestResult> {
    const refuse = () => {
      this.d.log.log("request refused");
      return "refused" as const;
    };
    if (card.state !== "ready" || !card.target || !card.draft || req.draftAt !== card.draft.at || !req.text.trim() || req.text.length > 2_000) return refuse();
    const target = card.target;
    // Already sent (a send that timed out but went): Messages shows this very text from Nikita since the card was made.
    const latest = await this.d.bb.messages(target.chat, 5).catch(() => null);
    if (!latest) return refuse();
    if (latest.some((m) => m.fromMe && m.at >= card.at && m.text.trim() === req.text.trim())) {
      this.change((s) => {
        const c = s.cards.find((x) => x.id === card.id);
        if (c) Object.assign(c, { state: "sent", draft: null });
      });
      return refuse();
    }
    const ok = await this.d.bb.send(target.chat, req.text, `relay-${randomUUID()}`).catch(() => false);
    if (!ok) {
      this.d.log.log("send failed");
      return "failed";
    }
    this.change((s) => {
      const c = s.cards.find((x) => x.id === card.id);
      if (c) Object.assign(c, { state: "sent", draft: null });
    });
    this.d.log.log("sent", { card: 1 });
    return "sent";
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
      s.threads = s.threads.filter((t) => t.state === "owed" || t.state === "later" || now - Math.max(t.repliedAt ?? 0, t.lastIn) < THREAD_KEEP_MS);
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
    });
    this.d.log.log("sweep");
  }

  setHub(state: "listening" | "paused" | "error") {
    this.hubState = state;
    this.dirty = true;
  }

  async checkMessages(): Promise<void> {
    this.linkMessages = (await this.d.bb.ping()) ? "up" : "down";
  }

  pause(): void {
    this.change((s) => {
      s.paused = true;
    });
    this.queue.clear();
    this.restyles.clear();
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
    };
    const read = readRelayStatus(status);
    if (!read.ok) {
      this.d.log.log("status refused");
      return null;
    }
    return read.status;
  }

  /** The who's-waiting list for the Desk: who, when, the states and the models' words. Never a message body. */
  texts(): TextsView {
    const s = this.d.store.load();
    const now = this.d.now();
    const items: TextItem[] = s.threads
      .filter((t) => t.state !== "replied" && (t.state !== "settled" || (t.group && t.summary)) && now - t.since < THREAD_KEEP_MS)
      .sort((a, b) => b.lastIn - a.lastIn)
      .slice(0, 60)
      .map((t) => {
        const handle = t.chat.split(";").pop() ?? "";
        const name = t.group ? this.groupNames.get(t.chat) || "Group chat" : this.contactOf(handle)?.names[0] || "Unknown sender";
        return {
          id: t.id,
          name: name.slice(0, 80),
          channel: channelOf(t.chat),
          group: t.group,
          state: t.state === "replied" ? "settled" : t.state,
          sort: t.sort,
          since: Math.max(Date.UTC(2026, 0, 1), Math.floor(t.since)),
          laterUntil: t.laterUntil === null ? null : Math.floor(t.laterUntil),
          gist: t.gist.slice(0, 160),
          draft: t.draft ? { text: t.draft.text.slice(0, 600), at: Math.floor(t.draft.at) } : null,
          summary: t.summary ? { text: t.summary.text.slice(0, 300), asked: t.summary.asked } : null,
        };
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
    return { v: 1, at: now, items, cards };
  }

  /** Sends the status and the list when something changed (or `force`). */
  async report(force = false): Promise<void> {
    if (!this.dirty && !force) return;
    this.dirty = false;
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
