/**
 * What "Hey Skippy" heard, sorted without a model call (#627): rules first, cheap and the same every time.
 *
 *   shopping  "add garlic and lemons", "we need milk, eggs and bread", "out of coffee", "buy oat milk", or a bare list
 *             of nouns ("garlic and lemons"): the items go on the Kitchen list.
 *   remove    "remove garlic", "take milk off the list", "cross off eggs", "delete bread from my shopping list" (#657):
 *             those items come off the Kitchen list.
 *   todo      "remind me to call the dermatologist tomorrow", "to-do: renew the passport", "call the vet on Friday",
 *             "email Sam tomorrow": a private to-do.
 *   device    the home devices (#632): "vacuum, go clean the kitchen", "clean the hall and the dining room", "start the
 *             vacuum", "pause the vacuum", "send the vacuum home", "feed the cat", "give the cat wet food", "clean the
 *             litter box", "run a litter cycle". Runs through the rails in api/_haven/devices/home.ts.
 *   workout   the Gym's plan (#660): "did core day A", "log core workout", "finished my core workout", "done with the
 *             gym": that session is logged (api/_haven/gym.ts). A question ("did I do core this week?") isn't a log.
 *   skippy    anything else (a question, small talk, a bare single word): Desk Skippy's own chat answers it, under its
 *             own caps (api/skippy.ts, phoneAnswer). Talk about the meal plan always goes here (#698): "swap Tuesday
 *             for tacos", "make Friday a HelloFresh night", "quinoa instead of rice on Monday", "more spicy", "send the
 *             week to King Soopers" are Skippy's meal tools (rooms/haven/tools.ts), never a to-do or shopping.
 *
 * Since #637 a device ask also carries its numbers and words: "feed the cat 2 portions" (portions), "next bowl" or
 * "switch the wet feeder to tray 2" (wet.rotate, plate), "clean the kitchen quietly, vacuum only" (suction, water).
 *
 * Corrections (#641): a leading "no", "I meant", "actually", "like", "can you just"… is dropped before the rules run,
 * and "add garlic to my grocery list", "as an item for my groceries" or "not as a task" is always shopping. Right
 * after a to-do, a bare "not as a task, on the list" moves that to-do onto the Kitchen list (`fromLastTodo`).
 *
 * And `sayAdded` / `sayTodo`: the short line the shortcut speaks back.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { whenLabel } from "../_today/parse.js";

export type Capture =
  | { kind: "shopping"; items: string[]; fromLastTodo?: boolean }
  | { kind: "remove"; items: string[] }
  | { kind: "workout"; session?: string }
  | { kind: "todo"; text: string }
  | { kind: "device"; action: DeviceAction; rooms?: string[]; portions?: number; plate?: number; suction?: "quiet" | "max"; water?: "off" | "on" }
  | { kind: "skippy"; text: string };

/** The home devices' actions a capture can ask for (#632; api/_haven/devices/types.ts names the same ones). */
export type DeviceAction = "vacuum.start" | "vacuum.pause" | "vacuum.dock" | "vacuum.rooms" | "feeder.feed" | "wet.open" | "wet.rotate" | "wet.close" | "wet.status" | "litter.clean";

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

/** A leading correction or filler (#641): "no", "I meant", "actually", "like", "can you just", any run of them. */
const CORRECTION = /^(?:(?:no|nope|nah|wait|sorry|oops|actually|i meant|i mean|meant|what i meant was|like|so|um|uh|er|okay|ok|well|just|can you(?: just)?|could you(?: just)?|would you(?: just)?|please)\b[,.!:;-]*\s+)+/i;

/** The words with any leading correction dropped; the words as they were when nothing else is left. */
export function uncorrected(text: string): string {
  const t = text.replace(CORRECTION, "").trim();
  return t || text;
}

/** "add garlic to my grocery list", "put eggs on the shopping list", "add milk as an item for my groceries". */
const LIST_ADD = /\b(?:add|put|buy|get|grab|stick)\s+(.+?)\s+(?:(?:to|on|onto|in|into)\s+(?:the|my|our)\s+(?:kitchen |shopping |grocery |groceries )?(?:list|groceries|grocery)|as an? (?:item|grocery|groceries|shopping item)|for (?:the|my|our) (?:grocery|groceries|shopping))\b/i;
/** "not as a task", "don't add that as a to-do", "not a reminder". */
const NOT_A_TASK = /\b(?:not|don'?t (?:add|make|put) (?:that|it|this)?\s*(?:as )?)\s*(?:as )?an? (?:task|to-?do|reminder)\b|\bnot (?:as )?an? (?:task|to-?do|reminder)\b/i;
/** Says it belongs on the shopping list. */
const SHOP_WORDS = /\b(?:grocery|groceries|shopping list|kitchen list|as an? item|on the list|to the list)\b/i;

/** A correction that is clearly shopping (#641): the items, or the last to-do to move; null when it isn't one. */
export function listCorrection(text: string, last: Capture["kind"] | null): Extract<Capture, { kind: "shopping" }> | null {
  const m = LIST_ADD.exec(text);
  if (m?.[1]) {
    const items = itemsOf(m[1].replace(/^(?:it|that|this)$/i, ""));
    if (items.length && items.length <= ITEMS_MAX && items.every(looksLikeItem)) return { kind: "shopping", items };
  }
  if (NOT_A_TASK.test(text) && SHOP_WORDS.test(text) && last === "todo") return { kind: "shopping", items: [], fromLastTodo: true };
  return null;
}

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

const NUMBER_WORD: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, "a couple of": 2, "a couple": 2, couple: 2 };
const numberOf = (w: string): number | undefined => (/^\d+$/.test(w) ? Number(w) : NUMBER_WORD[w.toLowerCase()]);

/** "2 portions", "three scoops", "a couple of portions": how many dry portions were asked for. */
const PORTIONS = /\b(\d{1,2}|an?|one|two|three|four|five|six|seven|eight|nine|ten|a couple(?: of)?|couple)\s+(?:more\s+)?(?:portions?|scoops?|servings?|helpings?)\b/i;
/** The wet tray: "next bowl", "rotate the tray", "switch the wet feeder to tray 2". */
const ROTATE = /\b(?:next|another|fresh|new|second|third) (?:bowl|tray|plate)\b|\b(?:rotate|turn|switch|spin|move|advance)\b.*\b(?:bowls?|trays?|plates?)\b/i;
const PLATE = /\b(?:bowl|tray|plate)\s*(?:number\s*)?(\d|one|two|three)\b/i;

/** The vacuum's optional mode words, and the words with them taken out. */
export function vacuumMode(t: string): { rest: string; suction?: "quiet" | "max"; water?: "off" | "on" } {
  let rest = t;
  let suction: "quiet" | "max" | undefined;
  let water: "off" | "on" | undefined;
  const take = (re: RegExp, by = " ") => {
    const hit = re.test(rest);
    if (hit) rest = rest.replace(re, by);
    return hit;
  };
  if (take(/,?\s*\b(?:on )?(?:quiet(?:ly)?|silent(?:ly)?|quiet mode)\b/gi)) suction = "quiet";
  else if (take(/,?\s*\b(?:on |at )?(?:max(?:imum)?|turbo|full)(?: power| suction| mode)?\b/gi)) suction = "max";
  if (take(/,?\s*\b(?:(?:and |but )?vacuum only|(?:and |but )?(?:with )?no mop(?:ping)?|without (?:the )?mop(?:ping)?|(?:and |but )?don'?t mop)\b/gi)) water = "off";
  else if (take(/\bvacuum and mop\b/gi, "vacuum")) water = "on";
  else if (take(/,?\s*\b(?:and mop(?:ping)?(?: too| as well)?|mop(?:ping)? too|mop(?:ping)? as well|with (?:the )?mop(?:ping)?)\b/gi)) water = "on";
  rest = rest.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").replace(/[,\s]+$/, "").trim();
  return { rest, ...(suction && { suction }), ...(water && { water }) };
}

/** A home-device ask, or null. Never calls anything. */
export function deviceAsk(text: string): Extract<Capture, { kind: "device" }> | null {
  const t0 = text.replace(/^(?:please\s+|can you\s+|could you\s+)/i, "").trim();
  // The litter box first: "clean the litter box" is never a vacuum job.
  if (LITTER.test(t0) && /\b(?:clean|cycle|run|empty|scoop|start)\b/i.test(t0)) return { kind: "device", action: "litter.clean" };
  // The wet feeder's questions and its lid.
  if (/\bwhat'?s (?:in|on) (?:the )?wet (?:food )?feeder\b|\bwet (?:food )?feeder(?:'s)? (?:status|schedule|plan)\b|\bwhich bowl\b/i.test(t0)) return { kind: "device", action: "wet.status" };
  if (/\bclose (?:the )?(?:wet (?:food )?feeder|wet feeder'?s lid|lid on the wet (?:food )?feeder|feeder'?s lid)\b/i.test(t0)) return { kind: "device", action: "wet.close" };
  // The wet tray's turn first: "give the cat the next bowl" is a turn, not an opening.
  if (ROTATE.test(t0) && (/\b(?:wet|feeder|cat|cats|kitty|bowl|tray)\b/i.test(t0) || /^next (?:bowl|tray)/i.test(t0))) {
    const p = PLATE.exec(t0);
    const plate = p?.[1] ? numberOf(p[1]) : /\bsecond (?:bowl|tray)\b/i.test(t0) ? 2 : /\bthird (?:bowl|tray)\b/i.test(t0) ? 3 : undefined;
    return { kind: "device", action: "wet.rotate", ...(plate && { plate }) };
  }
  if (/\b(?:feed|give)\b.*\b(?:cat|cats|kitty|kitten|kitties)\b|\bfeed (?:a|one|\d{1,2}|two|three|four|five|six) (?:more )?portions?\b/i.test(t0) || /^(?:dispense|drop) (?:a |one |\d{1,2} |two |three |four |five |six )?portions?\b/i.test(t0)) {
    if (/\bwet\b|\bcan\b|\bpate\b|\bpâté\b|\btray\b|\bbowl\b|\blid\b/i.test(t0)) return { kind: "device", action: "wet.open" };
    const n = PORTIONS.exec(t0);
    const portions = n?.[1] ? numberOf(n[1]) : undefined;
    return { kind: "device", action: "feeder.feed", ...(portions && portions > 1 && { portions }) };
  }
  // The vacuum's mode words come out before the rooms are read: "clean the kitchen on max" is the kitchen.
  const { rest: t, ...mode } = vacuumMode(t0);
  if (/\bopen (?:the )?wet (?:food )?feeder\b/i.test(t)) return { kind: "device", action: "wet.open" };
  const vac = VACUUM.test(t);
  if (vac && /\b(?:pause|stop|hold on|wait)\b/i.test(t)) return { kind: "device", action: "vacuum.pause" };
  if (vac && /\b(?:home|dock|base|charger|charge|back)\b/i.test(t) && !/\bclean\b.*\bhome\b/i.test(t)) return { kind: "device", action: "vacuum.dock" };
  const m = /\b(?:clean|vacuum|hoover|do)\s+(.+)$/i.exec(t.replace(/^(?:hey\s+)?(?:vacuum|robot)(?:[,:]\s*|\s+(?=go\b))(?:go\s+)?/i, ""));
  const where = m?.[1]?.replace(/[.!?]+$/, "").trim() ?? "";
  if (where && (vac || ROOM_WORDS.test(where) || EVERYWHERE.test(where))) {
    if (EVERYWHERE.test(where)) return { kind: "device", action: "vacuum.start", ...mode };
    const rooms = where.replace(/^(?:up\s+)?(?:the\s+)?/i, "").split(/\s*(?:,|&|\band\b)\s*/i).map((r) => r.replace(/^the\s+/i, "").trim()).filter(Boolean);
    if (rooms.length) return { kind: "device", action: "vacuum.rooms", rooms: rooms.slice(0, 8), ...mode };
  }
  if (vac && /\b(?:start|go|run|clean|vacuum)\b/i.test(t)) return { kind: "device", action: "vacuum.start", ...mode };
  return null;
}

/* ── Taking things off the Kitchen list (#657) ── */

const ON_LIST = "(?:on |from |off |in |of )?(?:the |my |our )?(?:kitchen |shopping |grocery |groceries )?(?:list|groceries)";
/** "remove garlic [from the list]", "delete eggs", "cross off eggs", "scratch milk", "get rid of bread". */
const REMOVE_A = new RegExp(`^(?:remove|delete|cross off|cross out|scratch|strike off|strike|take out|get rid of|drop|clear)\\s+(.+?)(?:\\s+${ON_LIST})?$`, "i");
/** "take milk off the list", "cross eggs off my list", "take garlic and lemons off". */
const REMOVE_B = new RegExp(`^(?:take|cross|scratch|strike|knock|get)\\s+(.+?)\\s+off(?:\\s+${ON_LIST})?$`, "i");

/** Items to take off the Kitchen list, or null when the words aren't that. */
export function removeAsk(text: string): Extract<Capture, { kind: "remove" }> | null {
  const t = text.replace(/^(?:please\s+|can you\s+|could you\s+)/i, "").trim();
  const m = REMOVE_B.exec(t) ?? REMOVE_A.exec(t);
  if (!m?.[1]) return null;
  const items = itemsOf(m[1].replace(/\s+(?:please|now)$/i, ""));
  if (!items.length || items.length > ITEMS_MAX || !items.every(looksLikeItem)) return null;
  return { kind: "remove", items };
}

/**
 * The meal planner's words (#698): a night's dinner, its parts, its switches, the heat, the week's plan and its cart.
 * Said with them, a day name is the night to change, not when to do something, so the words go to Skippy's tools.
 */
const MEAL_TALK =
  /\b(?:dinners?|meals?|meal plan|recipes?|hello ?fresh|for two|for one|(?:bigger|smaller|larger|half|double|extra) portions?|portions? (?:size|bigger|smaller)|spic(?:y|ier|iest|iness|e level)|milder|less hot|hotter|heat level|swap|instead of|not for me|backups?|the week'?s (?:groceries|shopping|meals|dinners|plan)|(?:this|next) week'?s (?:meals|dinners|plan|menu)|plan (?:the|next|a) week|king soopers|(?:my|the) cart|meal catalog|protein goal|taste profile|undo (?:that|the) (?:swap|change)|put (?:it|that) back)\b/i;

/** Whether the words are about the meal plan (`MEAL_TALK`), so Skippy's tools take them. */
export const mealTalk = (text: string): boolean => MEAL_TALK.test(text);

/** A follow-on to the last capture: "and milk too", "also eggs", "plus bread as well". */
const FOLLOW_START = /^(?:oh,?\s+)?(?:and|also|plus)\b,?\s*/i;
const FOLLOW_END = /,?\s+(?:too|as well|also)$/i;

/* ── The Gym's plan (#660) ── */

const WORKOUT_DONE = /^(?:i\s+)?(?:just\s+)?(?:did|done|finished|completed|crushed|smashed|knocked out|log(?:ged)?|track(?:ed)?|record(?:ed)?|mark(?:ed)?)\b/i;
const WORKOUT_DONE_TAIL = /\b(?:done|finished|complete|completed|in the bag)$/i;
const WORKOUT_NOUN = /\b(?:core|abs|workout|work-?out|gym|training|session|day [a-g])\b/i;
/** "did I…", "have I…", "how many…": asking about the log, not adding to it. */
const WORKOUT_ASK = /^(?:did|have|has|had)\s+(?:i|we|you)\b|^(?:how|what|when|which|is|are|was|were|should|can|could|do|does)\b/i;
const SESSION_NAMED = /\b(?:day|session|workout)\s+([a-g])\b|\bcore\s+([a-g])\b|\b([a-g])\s+(?:day|session|workout)\b/i;

/** A logged session ("did core day A", "log core workout", "core workout done"), or null. Never calls anything. */
export function workoutAsk(raw: string, text: string): Extract<Capture, { kind: "workout" }> | null {
  if (/\?\s*$/.test(raw) || WORKOUT_ASK.test(text) || !WORKOUT_NOUN.test(text)) return null;
  const t = text.replace(/^(?:i\s+)?(?:just\s+)?/i, "");
  if (!WORKOUT_DONE.test(t) && !WORKOUT_DONE_TAIL.test(t)) return null;
  // "log the gym's wifi password" isn't a session: the words left must be about the workout.
  const rest = t.replace(WORKOUT_DONE, "").replace(WORKOUT_DONE_TAIL, "").replace(/\b(?:my|the|a|today'?s|this morning'?s|tonight'?s|with|for|today|tonight|this morning|this evening)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (rest.split(" ").length > 5) return null;
  const m = SESSION_NAMED.exec(t);
  const letter = (m?.[1] ?? m?.[2] ?? m?.[3])?.toLowerCase();
  // A bare "a" in "did a core workout" is an article, not day A.
  const named = letter && !(letter === "a" && /\ba\s+(?:core\s+)?(?:workout|session|day)\b/i.test(t) && !/\b(?:day|session|workout|core)\s+a\b/i.test(t)) ? letter : undefined;
  return { kind: "workout", ...(named && { session: named }) };
}

/**
 * Sorts one dictated line. Never calls anything. `last` is which way this phone's previous capture went, in the last
 * ten minutes (api/_haven/convo.ts): after shopping, "and milk too" is more shopping.
 */
export function classify(raw: string, last: Capture["kind"] | null = null): Capture {
  const text = uncorrected(tidy(raw));
  if (!text) return { kind: "skippy", text };
  // A correction that clearly says "on the list" (#641) is shopping, whatever else it says.
  const fixed = listCorrection(text, last);
  if (fixed) return fixed;
  if (last === "shopping" && (FOLLOW_START.test(text) || FOLLOW_END.test(text))) {
    const items = itemsOf(text.replace(FOLLOW_START, "").replace(FOLLOW_END, ""));
    if (items.length && items.length <= ITEMS_MAX && items.every(looksLikeItem)) return { kind: "shopping", items };
  }
  // Taking things off the list comes before everything else ("get rid of …" would read as a buy).
  const gone = removeAsk(text);
  if (gone) return gone;
  // A logged workout (#660) before the to-dos: "did core day A" is done, not to do. "Remind me to…" stays a to-do.
  if (!TODO_START.test(text)) {
    const workout = workoutAsk(raw, text);
    if (workout) return workout;
  }
  // A to-do says so, starts with a to-do verb, or says when. A home-device ask comes before the to-do verbs, so
  // "clean the kitchen" runs the vacuum, while "remind me to clean the kitchen" stays a to-do.
  if (TODO_START.test(text)) return { kind: "todo", text: todoText(text) };
  const device = deviceAsk(text);
  if (device) return device;
  // The meal plan (#698): Skippy's tools, before the to-do verbs ("send the week to King Soopers") and the days.
  if (mealTalk(text)) return { kind: "skippy", text };
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

/** What the shortcut says after taking items off the list (#657). Quiet only when everything asked for went. */
export function sayRemoved(r: { removed: string[]; missing: string[]; ambiguous: Array<{ said: string; could: string[] }> }): string {
  const parts: string[] = [];
  if (r.removed.length) parts.push(`Took ${joinNames(r.removed)} off the list.`);
  if (r.missing.length) parts.push(`I couldn't find ${joinNames(r.missing)} on the list.`);
  for (const a of r.ambiguous) parts.push(`Which ${a.said}: ${joinNames(a.could.slice(0, 4))}?`);
  return parts.join(" ") || "I didn't catch what to take off.";
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
