/**
 * What "Hey Skippy" heard, sorted without a model call (#627): rules first, cheap and the same every time.
 *
 *   shopping  "add garlic and lemons", "we need milk, eggs and bread", "out of coffee", "buy oat milk", or a bare list
 *             of nouns ("garlic and lemons"): the items go on the Kitchen list.
 *   todo      "remind me to call the dermatologist tomorrow", "to-do: renew the passport", "call the vet on Friday",
 *             "email Sam tomorrow": a private to-do.
 *   device    the home devices (#632): "vacuum, go clean the kitchen", "clean the hall and the dining room", "start the
 *             vacuum", "pause the vacuum", "send the vacuum home", "feed the cat", "give the cat wet food", "clean the
 *             litter box", "run a litter cycle". Runs through the rails in api/_haven/devices/home.ts.
 *   skippy    anything else (a question, small talk, a bare single word): Desk Skippy's own chat answers it, under its
 *             own caps (api/skippy.ts, phoneAnswer).
 *
 * And `sayAdded` / `sayTodo`: the short line the shortcut speaks back.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { whenLabel } from "../_today/parse.js";

export type Capture =
  | { kind: "shopping"; items: string[] }
  | { kind: "todo"; text: string }
  | { kind: "device"; action: DeviceAction; rooms?: string[] }
  | { kind: "skippy"; text: string };

/** The home devices' actions a capture can ask for (#632; api/_haven/devices/types.ts names the same ones). */
export type DeviceAction = "vacuum.start" | "vacuum.pause" | "vacuum.dock" | "vacuum.rooms" | "feeder.feed" | "wet.open" | "litter.clean";

/** The most items one capture adds, and the longest one. */
export const ITEMS_MAX = 12;
const ITEM_WORDS = 4;

const TIME = /\b(?:today|tonight|tomorrow|this (?:morning|afternoon|evening|weekend|week)|next (?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|at \d{1,2}(?::\d{2})?\s*(?:am|pm)?|in (?:an hour|\d+ (?:minutes?|hours?|days?)))\b/i;
const TODO_START = /^(?:remind me(?: to)?|reminder(?: to)?|set a reminder(?: to)?|to-?do:?|add (?:a )?(?:to-?do|task|reminder)(?: to)?:?|new (?:to-?do|task):?|task:?|don'?t let me forget(?: to)?|i (?:need|have|got) to|i'?ve got to|i must|gotta)\b\s*/i;
const TODO_VERB = /^(?:call|ring|phone|email|e-mail|text|message|book|schedule|pay|renew|cancel|reply to|respond to|follow up|send|submit|file|fix|clean|finish|write|return|pick up the|drop off|check on|check in with|sign|print|order|make an appointment)\b/i;
const SHOP_START = /^(?:please\s+)?(?:add|put|we need|we'?re out of|we are out of|i'?m out of|i am out of|out of|need|i need|buy|get|grab|pick up|we'?re low on|running low on|low on)\s+/i;
const LIST_TAIL = /\s+(?:to|on|onto) (?:the |my |our )?(?:kitchen |shopping |grocery |groceries )?(?:list|groceries)$/i;
const NOT_A_LIST = /^(?:what|who|whom|whose|how|why|when|where|which|is|are|am|was|were|can|could|should|would|will|shall|do|does|did|have|has|had|tell|show|explain|hi|hello|hey|yo|thanks|thank|ok|okay|yes|no|nope|yeah|good|great|please|sorry|i|i'm|im|it|it's|that|this|let's|lets)\b/i;
const FILLER = /^(?:hey |ok |okay )?skippy[,.]?\s+/i;
const ARTICLE = /^(?:a|an|some|the|more|a few|few|a couple of|a bag of|a bottle of|a box of|a pack of|a carton of)\s+/i;

/** The words as said: one line, no wake word, no trailing punctuation. */
export function tidy(text: string): string {
  return text.normalize("NFKC").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().replace(FILLER, "").replace(/[.!?…]+$/, "").trim();
}

/** A list of things from "garlic, lemons and oat milk": split on commas, "and", "&" and "plus", articles dropped. */
export function itemsOf(text: string): string[] {
  return text
    .split(/\s*(?:,|;|&|\band\b|\bplus\b|\balso\b)\s*/i)
    .map((s) => s.trim().replace(ARTICLE, "").replace(/[.!?…"]+$/, "").trim())
    .filter(Boolean);
}

const looksLikeItem = (s: string) => /^[\p{L}\p{N}'’\- ]+$/u.test(s) && s.split(" ").length <= ITEM_WORDS && !TIME.test(s);

/** The to-do's own words: "remind me to" dropped, the first letter up. */
export function todoText(text: string): string {
  const t = text.replace(TODO_START, "").replace(/^[:,\s-]+/, "").trim() || text;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ── The home devices (#632) ── */

const VACUUM = /\b(?:vacuum|robot|roborock|hoover|roomba)\b/i;
const LITTER = /\blitter(?:[ -]?(?:box|robot))?\b/i;
/** Room words that make a bare "clean the <room>" a vacuum job, not a to-do. */
const ROOM_WORDS = /^(?:the\s+)?(?:kitchen|hall|hallway|entry|entryway|foyer|living room|lounge|dining room|dining area|dining|bedroom|master bedroom|bathroom|office|studio|corridor|den|family room|guest room|kids'? room)(?:\s*(?:,|and|&)\s*(?:the\s+)?(?:kitchen|hall|hallway|entry|entryway|foyer|living room|lounge|dining room|dining area|dining|bedroom|master bedroom|bathroom|office|studio|corridor|den|family room|guest room|kids'? room))*$/i;
const EVERYWHERE = /^(?:the\s+)?(?:house|whole house|home|whole place|place|apartment|flat|everywhere|floors?|all(?: the)? rooms)$/i;

/** A home-device ask, or null. Never calls anything. */
export function deviceAsk(text: string): Extract<Capture, { kind: "device" }> | null {
  const t = text.replace(/^(?:please\s+|can you\s+|could you\s+)/i, "").trim();
  // The litter box first: "clean the litter box" is never a vacuum job.
  if (LITTER.test(t) && /\b(?:clean|cycle|run|empty|scoop|start)\b/i.test(t)) return { kind: "device", action: "litter.clean" };
  if (/\b(?:feed|give)\b.*\b(?:cat|cats|kitty|kitten|kitties)\b|\bfeed (?:a|one) portion\b/i.test(t) || /^(?:dispense|drop) (?:a |one )?portion\b/i.test(t)) {
    return { kind: "device", action: /\bwet\b|\bcan\b|\bpate\b|\bpâté\b|\btray\b|\bbowl\b|\blid\b/i.test(t) ? "wet.open" : "feeder.feed" };
  }
  if (/\bopen (?:the )?wet (?:food )?feeder\b/i.test(t)) return { kind: "device", action: "wet.open" };
  const vac = VACUUM.test(t);
  if (vac && /\b(?:pause|stop|hold on|wait)\b/i.test(t)) return { kind: "device", action: "vacuum.pause" };
  if (vac && /\b(?:home|dock|base|charger|charge|back)\b/i.test(t) && !/\bclean\b.*\bhome\b/i.test(t)) return { kind: "device", action: "vacuum.dock" };
  const m = /\b(?:clean|vacuum|hoover|do)\s+(.+)$/i.exec(t.replace(/^(?:hey\s+)?(?:vacuum|robot)[,:]?\s+(?:go\s+)?/i, ""));
  const where = m?.[1]?.replace(/[.!?]+$/, "").trim() ?? "";
  if (where && (vac || ROOM_WORDS.test(where) || EVERYWHERE.test(where))) {
    if (EVERYWHERE.test(where)) return { kind: "device", action: "vacuum.start" };
    const rooms = where.replace(/^(?:up\s+)?(?:the\s+)?/i, "").split(/\s*(?:,|&|\band\b)\s*/i).map((r) => r.replace(/^the\s+/i, "").trim()).filter(Boolean);
    if (rooms.length) return { kind: "device", action: "vacuum.rooms", rooms: rooms.slice(0, 8) };
  }
  if (vac && /\b(?:start|go|run|clean|vacuum)\b/i.test(t)) return { kind: "device", action: "vacuum.start" };
  return null;
}

/** A follow-on to the last capture: "and milk too", "also eggs", "plus bread as well". */
const FOLLOW_START = /^(?:oh,?\s+)?(?:and|also|plus)\b,?\s*/i;
const FOLLOW_END = /,?\s+(?:too|as well|also)$/i;

/**
 * Sorts one dictated line. Never calls anything. `last` is which way this phone's previous capture went, in the last
 * ten minutes (api/_haven/convo.ts): after shopping, "and milk too" is more shopping.
 */
export function classify(raw: string, last: Capture["kind"] | null = null): Capture {
  const text = tidy(raw);
  if (!text) return { kind: "skippy", text };
  if (last === "shopping" && (FOLLOW_START.test(text) || FOLLOW_END.test(text))) {
    const items = itemsOf(text.replace(FOLLOW_START, "").replace(FOLLOW_END, ""));
    if (items.length && items.length <= ITEMS_MAX && items.every(looksLikeItem)) return { kind: "shopping", items };
  }
  // A to-do says so, starts with a to-do verb, or says when. A home-device ask comes before the to-do verbs, so
  // "clean the kitchen" runs the vacuum, while "remind me to clean the kitchen" stays a to-do.
  if (TODO_START.test(text)) return { kind: "todo", text: todoText(text) };
  const device = deviceAsk(text);
  if (device) return device;
  if (TODO_VERB.test(text)) return { kind: "todo", text: todoText(text) };
  // Shopping: "add …", "we need …", "out of …", with or without "to the list".
  const shop = SHOP_START.exec(text);
  if (shop || LIST_TAIL.test(text)) {
    const rest = text.slice(shop ? shop[0].length : 0).replace(LIST_TAIL, "").trim();
    const items = itemsOf(rest);
    if (items.length && items.length <= ITEMS_MAX && items.every(looksLikeItem)) return { kind: "shopping", items };
  }
  if (TIME.test(text) && !NOT_A_LIST.test(text)) return { kind: "todo", text: todoText(text) };
  // A bare list of two or more nouns, nothing else ("garlic and lemons").
  if (!NOT_A_LIST.test(text)) {
    const items = itemsOf(text);
    if (items.length >= 2 && items.length <= ITEMS_MAX && items.every(looksLikeItem)) return { kind: "shopping", items };
  }
  return { kind: "skippy", text };
}

/** "a", "a and b", "a, b and c". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What the shortcut says after adding to the Kitchen list. Short and spoken. */
export function sayAdded(added: string[], already: string[]): string {
  if (!added.length && !already.length) return "I didn't catch anything to add.";
  if (!added.length) return `${cap(joinNames(already))} ${already.length === 1 ? "is" : "are"} already on the list.`;
  const first = `Added ${joinNames(added)} to the list.`;
  if (!already.length) return first;
  return `${first} ${cap(joinNames(already))} ${already.length === 1 ? "was" : "were"} already on it.`;
}

/** What the shortcut says after keeping a to-do. */
export function sayTodo(text: string, due?: string, now = 0): string {
  const t = text.replace(/[.!?…]+$/, "");
  const when = due ? `, ${whenLabel(Date.parse(due), now)}` : "";
  return `On your to-dos: ${t.length > 120 ? `${t.slice(0, 117).trimEnd()}…` : t}${when}.`;
}

/** The longest a spoken answer may be (two short sentences). */
export const SAY_MAX = 240;

/**
 * Skippy's reply cut to something a phone can say: the first two sentences, at most SAY_MAX characters. A hand-off
 * keeps the quick take and says the rest goes on the Desk.
 */
export function spokenOf(reply: string, handedOff: boolean): string {
  const sentences = reply.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  // A hand-off's own tail ("…the answer will show on the Desk", "Handed to …") is said our way instead.
  const kept = handedOff ? sentences.filter((s) => !/\b(?:will show on the Desk|Handed to|answer will show)\b/i.test(s)) : sentences;
  const take = kept.slice(0, handedOff ? 1 : 2).join(" ");
  const tail = handedOff ? " I'll put the rest on the Desk." : "";
  const room = SAY_MAX - tail.length;
  const body = take.length > room ? `${take.slice(0, room - 1).trimEnd()}…` : take;
  return `${body}${tail}`.trim() || (handedOff ? "I'll put the rest on the Desk." : "Hmm. Try that again, monkey.");
}
