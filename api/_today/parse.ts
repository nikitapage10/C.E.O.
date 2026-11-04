/**
 * Today's quick words (#622): what Nikita types or says into Today's capture line, or back to a thing held for them,
 * read into one plain intent with fixed rules: no model, no network, the same answer every time. The Desk runs it in
 * the browser on every word; only when the rules can't tell does it ask the today-todos endpoint, which asks Claude
 * Haiku for the intent and resolves any time it names with these same rules (./route.ts).
 *
 *   capture   "tomorrow I need to respond to the dermatologist"  -> a to-do, due tomorrow 9:00 am Mountain
 *   talk back "snooze till Friday" / "remind me in 2 hours" / "note: waiting on their reply" / "done" / "make it a to-do"
 *
 * Times are Mountain (America/Denver), Nikita's clock and the Desk's. A day with no time of day lands at 9:00 am.
 *
 * Pure and dependency-free, so the browser imports it as it is. Underscore folder: never served as a function.
 */

export const TZ = "America/Denver";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A day named without a time of day lands here (Mountain). */
export const DEFAULT_HOUR = 9;
/** The longest to-do, note or spoken line kept. */
export const TEXT_MAX = 200;

// ——— Mountain wall clock ———

let FMT: Intl.DateTimeFormat | null = null;

export interface Wall {
  y: number;
  /** 1..12 */
  mo: number;
  d: number;
  h: number;
  mi: number;
  /** 0 Sunday .. 6 Saturday */
  wd: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The Mountain wall clock at a moment. */
export function wall(ms: number): Wall {
  FMT ??= new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" });
  const p = Object.fromEntries(FMT.formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), wd: WEEKDAY_INDEX[p.weekday ?? "Sun"] ?? 0 };
}

/** The moment a Mountain wall-clock time names (days past the month's end roll over). */
export function atWall(y: number, mo: number, d: number, h: number, mi = 0): number {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let guess = want + 7 * HOUR;
  for (let i = 0; i < 3; i++) {
    const w = wall(guess);
    const seen = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);
    if (seen === want) break;
    guess += want - seen;
  }
  return guess;
}

/** The Mountain day `days` after the one `now` is in, at h:mi. */
function dayAt(now: number, days: number, h: number, mi = 0): number {
  const w = wall(now);
  return atWall(w.y, w.mo, w.d + days, h, mi);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT_DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

/** "9:00 am", "2:30 pm", as the Desk writes Mountain times. */
export function clock(ms: number): string {
  const w = wall(ms);
  const h12 = w.h % 12 || 12;
  return `${h12}:${String(w.mi).padStart(2, "0")} ${w.h < 12 ? "am" : "pm"}`;
}

/** A due time in a few words, from where `now` stands: "today 5:00 pm", "tomorrow 9:00 am", "Friday 9:00 am", "Nov 12 9:00 am". */
export function whenLabel(at: number, now: number): string {
  const a = wall(at);
  const n = wall(now);
  const days = Math.round((Date.UTC(a.y, a.mo - 1, a.d) - Date.UTC(n.y, n.mo - 1, n.d)) / DAY);
  const t = clock(at);
  if (days === 0) return a.h >= 18 ? `tonight ${t}` : `today ${t}`;
  if (days === 1) return `tomorrow ${t}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[a.wd]![0]!.toUpperCase()}${WEEKDAYS[a.wd]!.slice(1)} ${t}`;
  const month = new Date(Date.UTC(a.y, a.mo - 1, a.d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${month} ${t}`;
}

// ——— When ———

export interface When {
  at: number;
  /** The words that said it, so the rest of the line can be read without them. */
  start: number;
  end: number;
}

const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, "forty-five": 45, few: 3, couple: 2, "a couple of": 2, "a few": 3 };
const numOf = (s: string): number | null => {
  const t = s.toLowerCase().replace(/^a (few|couple)( of)?$/, "$1");
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return NUM_WORDS[t] ?? null;
};

/** Parts of the day, as hours. */
const PARTS: Record<string, number> = { morning: 9, noon: 12, lunch: 12, lunchtime: 12, afternoon: 14, evening: 18, night: 20, tonight: 20 };

/** A clock time in the words ("at 3", "3pm", "15:30", "noon", "9 in the morning"): [hour, minute, start, end], or null. */
function timeOfDay(text: string): { h: number; mi: number; start: number; end: number; part?: boolean } | null {
  const re = /\b(?:at\s+|by\s+|around\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?(?=\W|$)/gi;
  for (const m of text.matchAll(re)) {
    const lead = /^(at|by|around)\s/i.test(m[0]);
    const suffix = m[3]?.toLowerCase().replace(/\./g, "");
    if (!lead && !suffix && !m[2]) continue;
    // "in 2 hours" and "2 days" are durations, not times.
    if (/^\s*(min|minute|hour|hr|day|week|month)/i.test(text.slice(m.index! + m[0].length))) continue;
    let h = Number(m[1]);
    const mi = m[2] ? Number(m[2]) : 0;
    if (h > 23 || mi > 59) continue;
    if (suffix === "pm" && h < 12) h += 12;
    else if (suffix === "am" && h === 12) h = 0;
    else if (!suffix || suffix.startsWith("o")) {
      // "at 3" means the afternoon; "at 8" the morning; a bare 24-hour time is as it is.
      if (h >= 1 && h <= 6) h += 12;
    }
    return { h, mi, start: m.index!, end: m.index! + m[0].length };
  }
  const named = /\b(?:at\s+|by\s+)?(noon|midday|midnight)\b/i.exec(text);
  if (named) return { h: /mid?night/i.test(named[1]!) ? 0 : 12, mi: 0, start: named.index, end: named.index + named[0].length };
  const part = /\b(?:(?:in\s+the|this|tomorrow|by)\s+)?(morning|afternoon|evening|lunch(?:time)?|night)\b/i.exec(text);
  if (part) {
    const lead = /^(tomorrow)\s/i.test(part[0]);
    const start = lead ? part.index + part[0].toLowerCase().indexOf(part[1]!.toLowerCase()) : part.index;
    return { h: PARTS[part[1]!.toLowerCase()]!, mi: 0, start, end: part.index + part[0].length, part: true };
  }
  return null;
}

/**
 * The first time the words name, from `now`: today, tonight, tomorrow, a weekday ("Friday", "next Tuesday"),
 * "in 2 hours", "in 20 minutes", "in 3 days", "next week", "this weekend", "later", "end of day", with or without a
 * time of day. Null when they name none.
 */
export function parseWhen(raw: string, now: number): When | null {
  const text = raw.toLowerCase();
  const w = wall(now);
  const spans: Array<[number, number]> = [];
  const take = (m: RegExpExecArray) => spans.push([m.index, m.index + m[0].length]);
  const out = (at: number): When => ({ at, start: Math.min(...spans.map((s) => s[0])), end: Math.max(...spans.map((s) => s[1])) });

  // A stretch from now: "in 2 hours", "in half an hour", "in a few days", "for an hour".
  const rel = /\b(?:in|for|after)\s+(half an hour|half hour|an? hour and a half|(\d+(?:\.\d+)?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|a few|a couple(?: of)?|few|couple)\s*(min(?:ute)?s?|h(?:ou)?rs?|hours?|days?|weeks?|months?))\b/i.exec(text);
  if (rel) {
    take(rel);
    if (/half/.test(rel[1]!)) return out(now + (/and a half/.test(rel[1]!) ? 90 : 30) * MIN);
    const n = numOf(rel[2]!) ?? 1;
    const unit = rel[3]!.toLowerCase();
    if (unit.startsWith("m") && !unit.startsWith("mo")) return out(now + Math.round(n * MIN));
    if (unit.startsWith("h")) return out(now + Math.round(n * HOUR));
    const tod = timeOfDay(text.slice(0, rel.index) + " ".repeat(rel[0].length) + text.slice(rel.index + rel[0].length));
    if (tod) spans.push([tod.start, tod.end]);
    const h = tod?.h ?? DEFAULT_HOUR;
    const mi = tod?.mi ?? 0;
    if (unit.startsWith("d")) return out(dayAt(now, Math.round(n), h, mi));
    if (unit.startsWith("w")) return out(dayAt(now, Math.round(n * 7), h, mi));
    return out(atWall(w.y, w.mo + Math.round(n), w.d, h, mi));
  }

  const tod = timeOfDay(text);
  const withTime = (days: number, fallback: number, fallbackMi = 0): When => {
    if (tod) spans.push([tod.start, tod.end]);
    return out(dayAt(now, days, tod?.h ?? fallback, tod ? tod.mi : fallbackMi));
  };

  let m: RegExpExecArray | null;
  if ((m = /\b(?:the\s+)?day after tomorrow\b/.exec(text))) {
    take(m);
    return withTime(2, DEFAULT_HOUR);
  }
  if ((m = /\b(?:tomorrow|tmrw|tmr|tomorow)\b/.exec(text))) {
    take(m);
    return withTime(1, DEFAULT_HOUR);
  }
  if ((m = /\b(?:tonight|this evening)\b/.exec(text))) {
    take(m);
    const at = dayAt(now, 0, tod && tod.h >= 12 ? tod.h : 20, tod && tod.h >= 12 ? tod.mi : 0);
    if (tod && tod.h >= 12) spans.push([tod.start, tod.end]);
    return out(at > now ? at : now + HOUR);
  }
  if ((m = /\b(?:end of (?:the )?day|eod|close of business|cob)\b/.exec(text))) {
    take(m);
    const at = dayAt(now, 0, 17);
    return out(at > now ? at : now + HOUR);
  }
  if ((m = /\b(?:later today|later on|later)\b/.exec(text)) && !/\b(?:week|month)\b/.test(text.slice(m.index))) {
    take(m);
    if (tod && !tod.part) {
      spans.push([tod.start, tod.end]);
      const at = dayAt(now, 0, tod.h, tod.mi);
      return out(at > now ? at : now + 3 * HOUR);
    }
    return out(now + 3 * HOUR);
  }
  if ((m = /\b(?:next week)\b/.exec(text))) {
    take(m);
    // The Monday after this week (Monday to Sunday).
    const days = ((8 - w.wd) % 7) || 7;
    return withTime(days, DEFAULT_HOUR);
  }
  if ((m = /\b(?:this |on the |over the )?weekend\b/.exec(text))) {
    take(m);
    const days = w.wd === 6 ? 7 : (6 - w.wd + 7) % 7 || 7;
    return withTime(w.wd === 0 ? 6 : days, 10);
  }
  if ((m = /\b(?:next month)\b/.exec(text))) {
    take(m);
    if (tod) spans.push([tod.start, tod.end]);
    return out(atWall(w.y, w.mo + 1, 1, tod?.h ?? DEFAULT_HOUR, tod?.mi ?? 0));
  }
  const dayRe = new RegExp(`\\b(?:(next|this|on|by|until|till|til)\\s+)?(${WEEKDAYS.join("|")}|${Object.keys(SHORT_DAYS).join("|")})\\b`);
  if ((m = dayRe.exec(text))) {
    const name = m[2]!;
    const target = WEEKDAYS.indexOf(name) >= 0 ? WEEKDAYS.indexOf(name) : SHORT_DAYS[name]!;
    // "sat" and "wed" are words too: only a short name with a lead word or alone counts.
    if (WEEKDAYS.indexOf(name) < 0 && !m[1] && (/\b(?:the|a|my|your)\s+$/.test(text.slice(0, m.index)) || !/^\s*(?:at|morning|afternoon|evening|night|\d|$)/.test(text.slice(m.index + m[0].length)))) {
      // fall through to the rest
    } else {
      take(m);
      let days = (target - w.wd + 7) % 7;
      if (days === 0) days = 7;
      return withTime(days, DEFAULT_HOUR);
    }
  }
  if ((m = /\b(?:today|this afternoon|this morning)\b/.exec(text))) {
    take(m);
    const fallback = /afternoon/.test(m[0]) ? 14 : /morning/.test(m[0]) ? 9 : 17;
    if (tod) spans.push([tod.start, tod.end]);
    const at = dayAt(now, 0, tod?.h ?? fallback, tod?.mi ?? 0);
    return out(at > now ? at : now + HOUR);
  }
  if (tod) {
    // Only a time of day: the next time the clock says it.
    spans.push([tod.start, tod.end]);
    const at = dayAt(now, 0, tod.h, tod.mi);
    return out(at > now + MIN ? at : dayAt(now, 1, tod.h, tod.mi));
  }
  return null;
}

// ——— Intents ———

export type Intent =
  /** A new to-do of Nikita's own, from the capture line. */
  | { kind: "add"; text: string; due?: number }
  /** Out of the list until then. */
  | { kind: "snooze"; until: number }
  /** Stays in the list, and pings / rises to the top then. */
  | { kind: "remind"; at: number }
  | { kind: "note"; text: string }
  | { kind: "done" }
  /** A held thing becomes a to-do of Nikita's own. */
  | { kind: "todo"; due?: number };

export interface Choice {
  label: string;
  intent: Intent;
}

export type Reading = { ok: true; intent: Intent } | { ok: false; ask: string; choices: [Choice, Choice] };

const FILLER = /^(?:\s*(?:ok(?:ay)?|so|um+|uh+|hey|alright|right|well|please|and|also|oh|yeah|hmm+)[,.!]?\s+)+/i;
/** What Nikita says before the to-do itself: "I need to", "remind me to", "don't forget to". */
const LEAD = /^(?:(?:i\s+)?(?:need|have|got|gotta|must|should|want|wanna)\s+(?:to\s+)?|i'?ll\s+|i\s+will\s+|remind\s+me\s+(?:to\s+)?|don'?t\s+(?:let\s+me\s+)?forget\s+(?:to\s+)?|remember\s+to\s+|to-?do:?\s+|add\s+(?:a\s+)?to-?do:?\s+(?:to\s+)?|make\s+sure\s+(?:i\s+|to\s+)?|let'?s\s+)/i;

/** Tidies a spoken line: the words around it gone, its first letter up, no trailing stop. */
export function tidy(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) t = t.replace(FILLER, "").replace(LEAD, "").trim();
  t = t
    .replace(/^(?:that|to)\s+/i, "")
    .replace(/^[,;:.\-–—\s]+|[,;:.\-–—\s]+$/g, "")
    .replace(/\s+(?:on|at|by|until|till|for)$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, TEXT_MAX);
}

const without = (text: string, w: When | null) => (w ? `${text.slice(0, w.start)} ${text.slice(w.end)}` : text);

/** The capture line: always a to-do, with its due time when the words name one. Null for nothing said. */
export function readCapture(raw: string, now: number): Intent | null {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text) return null;
  const when = parseWhen(text, now);
  const what = tidy(without(text, when));
  if (!what) return null;
  return when ? { kind: "add", text: what, due: when.at } : { kind: "add", text: what };
}

const DONE = /^(?:(?:it'?s|that'?s|all|i'?m|we'?re|mark(?:\s+it)?(?:\s+as)?)\s+)?(?:done|did it|finished|handled|sorted|complete[d]?|taken care of|dismiss(?:ed)?|ignore(?: it| this)?|clear(?: it)?|drop(?: it)?|never ?mind|not needed|no longer needed|got it|resolved|close(?: it)?|remove(?: it)?|delete(?: it)?)\b/i;
const DONE_ANY = /\b(?:already (?:done|handled|did it|replied|answered|sent)|i (?:did|handled|replied|answered|sent|paid|called|finished) (?:it|that|them|this)|mark(?:\s+it)?\s+(?:as\s+)?done|dismiss(?: it| this)?)\b/i;
const SNOOZE = /\b(?:snooze|not now|push(?: it)?(?: back| off| out)?|postpone|defer|hold off|later|ask (?:me )?again|bring (?:it|this) back|come back|deal with (?:it|this)|look at (?:it|this)|wait (?:until|till|til))\b/i;
const REMIND = /\b(?:remind(?:er)?|ping me|nudge me|tell me|alert me|let me know)\b/i;
const NOTE = /^(?:note|add (?:a )?note|note (?:that|to self)|fyi|for the record|memo)\b[:,\s-]*/i;
const NOTE_CUE = /\b(?:waiting (?:on|for)|they said|she said|he said|left (?:a )?(?:voicemail|message)|called (?:them|her|him)|emailed|texted|sent (?:it|them|her|him)|heard back|no answer|booked|scheduled for|appointment (?:is|on))\b/i;
const TODO = /\b(?:to-?do|task|add (?:it|this|that) to (?:my )?(?:list|to-?dos?)|put (?:it|this) on my list|track (?:it|this)|keep (?:it|this) on my list|turn (?:it|this) into|make (?:it|this) (?:a|my|one of my) (?:to-?do|task))\b/i;

const intentLabel = (i: Intent, now: number): string => {
  switch (i.kind) {
    case "snooze":
      return `Snooze till ${whenLabel(i.until, now)}`;
    case "remind":
      return `Remind me ${whenLabel(i.at, now)}`;
    case "note":
      return "Add it as a note";
    case "done":
      return "Mark it done";
    case "todo":
      return i.due ? `To-do for ${whenLabel(i.due, now)}` : "Make it a to-do";
    case "add":
      return "Add a to-do";
  }
};

const choice = (intent: Intent, now: number): Choice => ({ label: intentLabel(intent, now), intent });

/**
 * Talking back to a held thing: snooze, remind, note, done, or a to-do of Nikita's own. A bare time asks whether to
 * snooze or remind (two chips). Null when the rules can't tell, which is when Claude is asked.
 */
export function readTalkBack(raw: string, now: number): Reading | null {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text) return null;
  const stripped = text.replace(FILLER, "").trim();
  const ok = (intent: Intent): Reading => ({ ok: true, intent });

  const note = NOTE.exec(stripped);
  if (note) {
    const body = stripped.slice(note[0].length).trim();
    if (body) return ok({ kind: "note", text: (body.charAt(0).toUpperCase() + body.slice(1)).slice(0, TEXT_MAX) });
  }

  const when = parseWhen(stripped, now);
  const rest = without(stripped, when).trim();

  if (REMIND.test(rest)) {
    if (when) return ok({ kind: "remind", at: when.at });
    return { ok: false, ask: "Remind you when?", choices: [choice({ kind: "remind", at: now + HOUR }, now), choice({ kind: "remind", at: dayAt(now, 1, DEFAULT_HOUR) }, now)] };
  }
  if (TODO.test(rest)) return ok(when ? { kind: "todo", due: when.at } : { kind: "todo" });
  if (SNOOZE.test(rest) || /^(?:until|till|til|wait)\b/i.test(rest)) {
    if (when) return ok({ kind: "snooze", until: when.at });
    return ok({ kind: "snooze", until: dayAt(now, 1, DEFAULT_HOUR) });
  }
  if (DONE.test(stripped) || DONE_ANY.test(stripped)) return ok({ kind: "done" });
  if (NOTE_CUE.test(stripped)) return ok({ kind: "note", text: (stripped.charAt(0).toUpperCase() + stripped.slice(1)).slice(0, TEXT_MAX) });

  // Only a time ("tomorrow", "Friday at 3", "in 2 hours"): snooze it, or keep it and remind?
  if (when && !/[a-z]{3,}/i.test(rest.replace(/\b(?:till|until|til|on|at|by|for|in|the|me|it|this|that|please|morning|afternoon|evening|night)\b/gi, ""))) {
    return { ok: false, ask: `${whenLabel(when.at, now).replace(/^./, (c) => c.toUpperCase())}: snooze it or remind you?`, choices: [choice({ kind: "snooze", until: when.at }, now), choice({ kind: "remind", at: when.at }, now)] };
  }
  return null;
}

/** When neither the rules nor Claude can tell: a note, or a to-do of its own. */
export function fallbackChoices(raw: string, now: number): Reading {
  const text = tidy(raw) || "Follow up";
  const when = parseWhen(raw, now);
  return { ok: false, ask: "Not sure what you meant. Which one?", choices: [choice({ kind: "note", text }, now), choice(when ? { kind: "todo", due: when.at } : { kind: "todo" }, now)] };
}

/** The one-line confirmation of what an intent did. */
export function didLine(i: Intent, now: number): string {
  switch (i.kind) {
    case "add":
      return i.due ? `Added for ${whenLabel(i.due, now)}` : "Added to your list";
    case "snooze":
      return `Snoozed till ${whenLabel(i.until, now)}`;
    case "remind":
      return `Reminder set for ${whenLabel(i.at, now)}`;
    case "note":
      return "Note added";
    case "done":
      return "Marked done";
    case "todo":
      return i.due ? `Made a to-do for ${whenLabel(i.due, now)}` : "Made it a to-do";
  }
}

// ——— What Claude may answer ———

/** The intent kinds Claude may pick, and the words it gives back for a time (resolved here, never by the model). */
export const MODEL_KINDS = ["add", "snooze", "remind", "note", "done", "todo", "unclear"] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

/**
 * Claude's answer, read with these rules: its kind, its text, and its `when` words run through parseWhen. Anything
 * off-shape, or a time it names that can't be read, is null (the Desk then shows the two fallback chips).
 */
export function readModelIntent(answer: unknown, mode: "capture" | "item", now: number): Intent | null {
  const a = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
  const kind = MODEL_KINDS.find((k) => k === a.kind);
  if (!kind || kind === "unclear") return null;
  const text = typeof a.text === "string" ? a.text.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX) : "";
  const whenWords = typeof a.when === "string" ? a.when.slice(0, 60) : "";
  const when = whenWords ? parseWhen(whenWords, now) : null;
  if (whenWords && !when) return null;
  if (mode === "capture") {
    const t = tidy(text);
    if (!t) return null;
    return when ? { kind: "add", text: t, due: when.at } : { kind: "add", text: t };
  }
  switch (kind) {
    case "snooze":
      return { kind: "snooze", until: when?.at ?? dayAt(now, 1, DEFAULT_HOUR) };
    case "remind":
      return when ? { kind: "remind", at: when.at } : null;
    case "note":
      return text ? { kind: "note", text } : null;
    case "done":
      return { kind: "done" };
    case "todo":
      return when ? { kind: "todo", due: when.at } : { kind: "todo" };
    default:
      return null;
  }
}
