/**
 * Skippy's quick tier, by rules (#926): the asks that need no model to understand, sorted in microseconds, the same on
 * every surface (typed on the Desk, a room's mic, hold Space on any page, the phone's "Skippy" shortcut, a Talk call).
 *
 *   climate   "what's the temperature in the apartment?", "is the heat on?", "how warm is it in here?": the Haven's
 *             home_status read, the thermostat's line. Never "set the thermostat to 70" (no tool sets it) and never the
 *             weather outside or a city's (those go to the model and the web).
 *   schedule  a question about when a device runs next (#952: "when is the next wet food cycle for my cat?"): the
 *             Haven's home_status read for that device (the wet plan, the dry plan, the vacuum's schedule), so the next
 *             meal or clean is answered from the device's own schedule on every surface, with no model to misread it.
 *   devices   the Hey Skippy rules for the home devices (api/_haven/classify.ts deviceAsk, #632 and #713): "open the wet
 *             food feeder", "feed the cat two portions", "vacuum the kitchen", "run the litter box", "what's in the wet
 *             feeder?". Hyphens and a possessive are smoothed first ("wet-food", "the cat's wet food feeder").
 *
 *   house     "how's the house?", "everything OK at home?" (#1067): the Haven's house_check line, the temperature, the
 *             lights on, the to-dos and tonight's dinner in one sentence.
 *   lights    a plain order to switch the lights (#1011): "turn on the lights", "lights off", "switch the study lamp
 *             on". "The lights" means every light at once (`ALL_LIGHTS`); a name goes to the lights' own name match.
 *
 * `spokenAsked` (and `spokenLights` for the lights) is the words check a spoken surface runs before a home device acts
 * on the model's call: Nikita's own words must ask for that very action (the phone's rule), so a model's guess or a
 * page's text never runs one.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { DD_CUE, LIST_CUE, deviceAsk } from "../../_haven/classify.js";

/** A tool call the rules settled, with exactly the input the tool's schema takes. */
export interface DirectAsk {
  tool: "home_status" | "home_device" | "lights_set" | "house_check";
  input: Record<string, unknown>;
}

/** The home in words: "the house", "home", "the apartment", "the Haven". */
const HOME = String.raw`(?:the (?:house|apartment|flat|place|haven|home front)|home|my (?:house|apartment|place|flat)|things (?:at|back) home|everything (?:at|back) home|stuff at home|it at home)`;
const TAIL = String.raw`(?:\s+(?:looking|doing|going|holding up|been))?(?:\s+(?:today|tonight|right now|now|at the moment|lately|then))?(?:,?\s+skippy)?`;
/** "How's the house?", "how is home looking?", "everything OK at home?", "check on the house", "house check". */
const HOUSE = new RegExp(
  String.raw`^(?:` +
    String.raw`(?:so\s+)?how(?:'s| is| are|s)\s+${HOME}${TAIL}` +
    String.raw`|(?:is\s+)?everything\s+(?:ok|okay|good|alright|all right|fine|quiet)\s+(?:at|back)\s+home${TAIL}` +
    String.raw`|(?:what's|whats|what is)\s+(?:going on|happening|up)\s+(?:at|back)\s+home${TAIL}` +
    String.raw`|(?:give me\s+(?:a\s+)?|do\s+(?:a\s+)?)?(?:house|home)\s+(?:check(?:-?in)?|status|report)${TAIL}` +
    String.raw`|(?:can you\s+)?check (?:in )?on\s+${HOME}${TAIL}` +
    String.raw`)$`,
  "i",
);

/** "How's the house?" and the like (#1067): the house_check line, the same on every surface. */
export function houseAsk(text: string): boolean {
  const t = smooth(text).replace(FILLER, "").replace(/[.!?]+$/, "").trim();
  return t.length <= DIRECT_MAX && HOUSE.test(t);
}

/** The longest ask the rules take: commands and quick questions are short; anything longer is the model's. */
export const DIRECT_MAX = 120;

/** Spoken words smoothed for the rules: "wet-food" is "wet food", "the cat's wet food feeder" is "the wet food feeder". */
export function smooth(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/(\p{L})-(\p{L})/gu, "$1 $2")
    .replace(/\b(?:the )?(?:cat's|cats'|kitty's)\s+(?=(?:wet|dry)\b)/gi, "the ")
    .replace(/^(?:(?:hey|ok|okay|yo)\s+)?skippy[,:]?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

const CLIMATE = /\b(?:temperature|temp|thermostat|humidity|humid|degrees|heating|heater|furnace|a\/?c|air ?con(?:ditioning)?|how (?:warm|hot|cold|chilly)|(?:is it|it's|its) (?:warm|hot|cold|chilly)|heat (?:on|running))\b/i;
/** A change, not a question: no tool sets the thermostat from a sentence, so the model says what it can do. */
const CLIMATE_SET = /\b(?:set|turn|raise|lower|bump|change|crank|put|make it|switch|increase|decrease|drop)\b/i;
/** The weather or somewhere else: not the apartment. */
const ELSEWHERE = /\b(?:outside|outdoors|weather|forecast|tomorrow|tonight|this week|in (?!(?:the|my|our|here|this)\b)[a-z]+)\b/i;

/** The apartment's climate asked about, or not. */
export function climateAsk(text: string): boolean {
  const t = smooth(text);
  return CLIMATE.test(t) && !CLIMATE_SET.test(t) && !ELSEWHERE.test(t.replace(/\bin (?:the )?(?:apartment|flat|house|home|place|living room|bedroom|kitchen|office|studio)\b/gi, ""));
}

/** Spoken filler in front of an ask: "yeah, um, so, okay, hey". */
const FILLER = /^(?:(?:yeah|yes|yep|yo|um+|uh+|er+|erm|hmm+|so|okay|ok|hey|well|and|also|alright|all right|cool|right|like|oh)\b[\s,.!-]*)+/i;

/**
 * A question about the home, not an order (02:10Z 2026-11-06: "can you tell me what the vacuum cleaner's next schedule
 * is gonna be?" set the vacuum off). A question only ever reads; it never runs a device. "Can you vacuum the kitchen?"
 * is still an order: only asking-for-information words make it a question.
 */
export function infoQuestion(text: string): boolean {
  const t = smooth(text).replace(FILLER, "").trim();
  if (/^(?:is|are|was|were|what|what's|whats|which|when|where|why|how|did|does|do|has|have|had|will|would|should|any)\b/i.test(t)) return true;
  if (/\b(?:tell me|let me know|do you know|any idea|wondering|curious|i wonder|check (?:on|if|whether|when|what))\b/i.test(t)) return true;
  return /\b(?:schedule[ds]?|scheduled|next (?:run|clean|cleaning|cycle|meal|feeding|time)|what time|status|how long|how much|last (?:run|time|clean|cleaned|ran))\b/i.test(t);
}

/** Which device's schedule a home_status read answers. */
export type ScheduleAbout = "wet-feeder" | "dry-feeder" | "feeders" | "vacuum";

const WHEN = /\b(?:when|what time|schedule[ds]?|scheduled|next|upcoming|due|plan(?:ned)?|cycle|timer)\b/i;
const WET = /\b(?:wet(?: food)?|pate|pâté|polar)\b/i;
const DRY = /\b(?:dry(?: food)?|kibble|granary)\b/i;
const FEED = /\b(?:feed(?:er|ing|s)?|fed|meal|meals|food|eat|breakfast|dinner|supper)\b/i;
const VAC = /\b(?:vacuum(?: cleaner)?|robot|roomba|hoover|roborock|mop)\b/i;

/**
 * A question about when a home device runs next (#952), and which device: "when is the next wet food cycle for my
 * cat?" is the wet feeder's plan, "when does the vacuum run next?" the vacuum's schedule. Only a question, never an
 * order. Null for anything else.
 */
export function scheduleAsk(text: string): ScheduleAbout | null {
  const t = smooth(text).replace(FILLER, "").trim();
  // What already happened ("when did the vacuum last run?") is the model's, with the history it can read.
  if (!infoQuestion(t) || !WHEN.test(t) || /\b(?:last|did|ago|yesterday|earlier)\b/i.test(t)) return null;
  if (VAC.test(t)) return "vacuum";
  if (!FEED.test(t) && !WET.test(t) && !DRY.test(t)) return null;
  if (WET.test(t) && !DRY.test(t)) return "wet-feeder";
  if (DRY.test(t) && !WET.test(t)) return "dry-feeder";
  return /\b(?:cat|cats|kitty|kitten|feeders?|meal|meals|food|feeding)\b/i.test(t) ? "feeders" : null;
}

/** The home's devices by name: the feeders, the vacuum, the litter box, the fountain, the thermostat, the lights. */
const HOME_THING = /\b(?:feeders?|wet food|dry food|kibble|cat'?s? (?:food|meal|bowl)|vacuum|roborock|roomba|robot|litter|fountain|thermostat|temperature|heat(?:ing)?|a\/?c|lights?|lamp)\b/i;

/**
 * Whether an ask is about the home's devices (#952): such an ask is answered by Skippy's one brain with the devices'
 * reads on every surface, never by a responder that can't read them.
 */
export function homeAsk(text: string): boolean {
  const t = smooth(text);
  return houseAsk(t) || climateAsk(t) || scheduleAsk(t) !== null || deviceAsk(t) !== null || HOME_THING.test(t);
}

/** The ask the rules settle at once, or null for the model. Never calls anything. */
export function directAsk(text: string): DirectAsk | null {
  const t = smooth(text).replace(FILLER, "").replace(/[.!?]+$/, "").trim();
  if (!t || t.length > DIRECT_MAX) return null;
  if (houseAsk(t)) return { tool: "house_check", input: {} };
  if (climateAsk(t)) return { tool: "home_status", input: { about: "climate" } };
  const when = scheduleAsk(t);
  if (when) return { tool: "home_status", input: { about: when } };
  const d = deviceAsk(t);
  if (!d) {
    // The lights (#1011): only an order switches them; a question about them is the model's, with lights_list.
    const l = infoQuestion(text) ? null : lightsAsk(t);
    return l ? { tool: "lights_set", input: l } : null;
  }
  if (d.action === "wet.status") return { tool: "home_status", input: { about: "wet-feeder" } };
  // A question about a device reads its status; only an order runs it.
  if (infoQuestion(text)) return null;
  return {
    tool: "home_device",
    input: {
      action: d.action,
      ...(d.rooms?.length && { rooms: d.rooms.slice(0, 8) }),
      ...(typeof d.portions === "number" && d.portions >= 1 && d.portions <= 4 && { portions: d.portions }),
      ...(typeof d.plate === "number" && d.plate >= 1 && d.plate <= 3 && { plate: d.plate }),
      ...(d.suction && { suction: d.suction }),
      ...(d.water && { water: d.water }),
    },
  };
}

/** Looser words for each action: enough that the model's call matches what Nikita plainly said. */
const LOOSE: Record<string, RegExp[]> = {
  "wet.open": [/\bopen\b/i, /\b(?:wet|tray|feeder|lid|bowl)\b/i],
  "wet.close": [/\b(?:close|shut)\b/i, /\b(?:wet|tray|feeder|lid|bowl)\b/i],
  "wet.rotate": [/\b(?:rotate|turn|switch|spin|next|advance)\b/i, /\b(?:bowl|tray|plate)\b/i],
  "feeder.feed": [/\b(?:feed|portions?|kibble|dry food|scoops?)\b/i],
  "vacuum.start": [/\b(?:vacuum|robot|roomba|hoover|clean|mop)\b/i],
  "vacuum.rooms": [/\b(?:vacuum|robot|roomba|hoover|clean|mop)\b/i],
  "vacuum.pause": [/\b(?:pause|stop|hold)\b/i, /\b(?:vacuum|robot|roomba|cleaning)\b/i],
  "vacuum.dock": [/\b(?:dock|home|back|charge|base)\b/i, /\b(?:vacuum|robot|roomba)\b/i],
  "litter.clean": [/\blitter\b/i, /\b(?:clean|cycle|run|scoop|empty|start)\b/i],
};

/**
 * Whether Nikita's own words asked for exactly this home device action: the rules' own reading of them, or, for a
 * phrasing they miss, the action's plain words in what he said. A question about a device is never an ask to run it.
 */
export function spokenAsked(said: string | undefined, input: Record<string, unknown>): boolean {
  if (!said) return false;
  if (infoQuestion(said)) return false;
  const t = smooth(said).replace(FILLER, "").trim();
  const ruled = directAsk(t);
  if (ruled?.tool === "home_device") return ruled.input.action === input.action;
  const words = LOOSE[String(input.action)];
  return !!words && words.every((w) => w.test(t));
}

/** The lights' words (#931, #1011): a light, a lamp, the lights, or the projector's remote. */
const LIGHT_THING = /\b(?:lights?|lamps?|bulbs?|lighting|leds?|projector|beamer)\b/i;
const ON_WORD = /\bon\b/i;
const OFF_WORD = /\b(?:off|out)\b/i;
const KILL_WORD = /\b(?:kill|shut)\b/i;

/** The name lights_set takes for every light at once (#1011): "turn on the lights". */
export const ALL_LIGHTS = "all";
const EVERY = /^(?:(?:all|every|each)(?: of)?(?: the| my| our)? )?(?:the |my |our )?(?:lights?|lamps?|lighting|everything|all)$/i;

/** Whether a light's name means every light: "all", "the lights", "all the lamps", "everything". */
export function allLightsName(name: string): boolean {
  return EVERY.test(name.replace(/\s+/g, " ").trim());
}

/**
 * A plain order to switch lights (#1011), or null: "turn on the lights", "switch the study lamp off", "lights off",
 * "kill the lights". The name is what he called them ("study lamp"), or `ALL_LIGHTS` for the lights as a whole. Never
 * a question; that is checked by the caller.
 */
export function lightsAsk(text: string): { name: string; on: boolean } | null {
  const t = smooth(text)
    .replace(FILLER, "")
    .replace(/[.!?]+$/, "")
    .replace(/^(?:please|can you|could you|would you|will you|go and|go)\s+/i, "")
    .replace(/[,\s]+please$/i, "")
    .trim();
  if (!t || t.length > 60) return null;
  const lead = /^(?:turn|switch|flip|put|shut|kill|cut)\s+(on|off|out)\s+(.+)$/i.exec(t);
  const tail = /^(?:turn|switch|flip|put|shut|kill|cut)\s+(.+?)\s+(on|off|out)$/i.exec(t) ?? /^(.+?)\s+(on|off)$/i.exec(t);
  const kill = /^(?:kill|cut)\s+(.+)$/i.exec(t);
  const on = lead ? lead[1]!.toLowerCase() === "on" : tail ? tail[2]!.toLowerCase() === "on" : false;
  let thing = lead?.[2] ?? tail?.[1] ?? kill?.[1];
  if (!thing) return null;
  if (on && /^shut|^kill|^cut/i.test(t)) return null;
  thing = thing.replace(/^(?:the|my|our)\s+/i, "").trim();
  if (!thing || !LIGHT_THING.test(thing) || thing.split(" ").length > 5) return null;
  return { name: allLightsName(thing) ? ALL_LIGHTS : thing, on };
}

/** A light's or scene's name in what he said: its own words (not "the", "lights" or "turn"), every one of them. */
function nameSaid(t: string, name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !/^(?:the|a|an|of|and|my|turn|switch|lights?|lamps?|scene|all)$/.test(w));
  if (!words.length) return LIGHT_THING.test(t);
  return words.every((w) => new RegExp(`\\b${w}\\b`, "i").test(t));
}

/**
 * Whether Nikita's own words asked for this switch or scene (#1011), the lights' `spokenAsked`: never a question; a
 * switch needs its direction (on or off) and the lights or the light's name in what he said; a scene needs its name's
 * own words ("all off" for "turn everything off").
 */
export function spokenLights(said: string | undefined, tool: string, input: Record<string, unknown>): boolean {
  if (!said || infoQuestion(said)) return false;
  const t = smooth(said).replace(FILLER, "").trim();
  const name = typeof input.name === "string" ? input.name : "";
  if (tool === "lights_scene") return nameSaid(t, name);
  if (tool !== "lights_set") return false;
  const way = input.on === true ? ON_WORD.test(t) && !OFF_WORD.test(t) && !KILL_WORD.test(t) : (OFF_WORD.test(t) || KILL_WORD.test(t)) && !ON_WORD.test(t);
  return way && (LIGHT_THING.test(t) || (!allLightsName(name) && nameSaid(t, name)));
}

/** An ask to put food in the DoorDash cart (#1207): add, order, get, grab, put, want, repeat. */
const ADD_WORD = /\b(?:add|adding|order|get|grab|put|throw|toss|want|bring|reorder|repeat|queue)\b/i;
const ASKS_INFO = /^(?:is|are|was|were|what(?! if\b)|what's|whats|which|when|where|why|how(?! about\b)|did|does|do|has|have|had|any)\b|\b(?:tell me|let me know|do you know|any idea|wondering|i wonder)\b/i;
const NO_ADD = /\b(?:don't|dont|do not|never|not|no|stop|cancel|remove|take off|take out)\b/i;

/**
 * Whether Nikita's own words asked to add something to the DoorDash cart (#1207), doordash_add_to_cart's `spokenAsked`:
 * "add the empanadas from the usual spot", "get me my usual from La Esquina", "can you add…". A question for
 * information ("what's in my cart?", "what did I get last time?") or a "don't" never counts.
 */
export function spokenAdd(said: string | undefined): boolean {
  if (!said) return false;
  const t = smooth(undouble(said)).replace(FILLER, "").trim();
  // A question for information, but not a request put as one ("can you add…", "would you get…", "add what I got last time").
  if (!t || ASKS_INFO.test(t) || NO_ADD.test(t)) return false;
  return ADD_WORD.test(t);
}

/**
 * A transcript said twice over (#1210): speech-to-text sometimes hands back the whole phrase repeated ("I want the
 * empanadas I want the empanadas"). One copy, or the words as they were.
 */
export function undouble(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  if (words.length < 4 || words.length % 2) return t;
  const half = words.length / 2;
  const a = words.slice(0, half).join(" ");
  const flat = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
  return flat(a) === flat(words.slice(half).join(" ")) ? a.replace(/[,.;!?]+$/, "") : t;
}

/** A reminder to order later is a to-do, never an add. */
const REMINDER = /^(?:remind me|reminder|set a reminder|to-?do|don'?t let me forget)\b/i;
/** An order to place now, not an add: doordash_prepare_order's, left to the model. */
const PLACE_NOW = /\b(?:now|place|placed|check ?out|confirm|asap|deliver(?:ed)?)\b/i;
/** Where the item's words stop: what follows it ("that we had recently", "from the usual spot", "again"). */
const ITEM_END = /\s+(?:that|which|we|i|you|from|at|again|on|to|in|into|please|for|tonight|recently|like|same as|off|out of)\b.*$/i;
/** Words before the item: "some of the usual", "those", "a couple of". */
const ITEM_LEAD = /^(?:some|of|the|a|an|those|these|that|this|my|our|usual|same|more|few|couple|bunch|order|orders|again)\s+/i;
/** No item named: the order itself ("my usual", "it", "what we had"). */
const NO_ITEM = /^(?:usual|what|it|them|that|those|this|these|same|same thing|what we had|what i had|what we got|what i got|last order|everything|all)$/i;
/** A store said vaguely ("that one spot", "there"): his usual spot, from his history. */
const VAGUE_STORE = /^(?:(?:that|the|this|our|my)\s+(?:one\s+)?(?:spot|place|restaurant|joint|store)|there)$/i;

/**
 * A plain ask to put food in the DoorDash cart (#1210), read from Nikita's own words with no model, or null: "re-order
 * those empanadas that we had recently", "can we order some of the usual empanadas from that one spot", "add the
 * empanadas from the usual spot", "get my usual from La Esquina". Only when the words say add (spokenAdd) and point at
 * DoorDash (the usual spot, a re-order, something had before), never at a list, and never an order to place now. The
 * item is what was named ("empanadas"; none means his last order there), the store only when one was named. This is
 * the chat's own check that such an ask ends with doordash_add_to_cart run, whatever the model did.
 */
export function doordashAddAsk(said: string | undefined): { items?: string[]; store?: string } | null {
  if (!said) return null;
  const t = smooth(undouble(said)).replace(FILLER, "").replace(/[.!?]+$/, "").trim();
  if (!t || t.length > DIRECT_MAX * 2 || REMINDER.test(t) || !spokenAdd(t) || !DD_CUE.test(t) || LIST_CUE.test(t) || PLACE_NOW.test(t)) return null;
  const verb = /\b(?:re\s?order|add|order|get|grab|bring|repeat|queue|put|throw|toss)\b(?:\s+(?:me|us))?\s+(.+)$/i.exec(t);
  if (!verb) return null;
  const rest = verb[1]!;
  const from = /\bfrom\s+(.+?)(?:\s+(?:again|please|that|which|we|i)\b.*)?$/i.exec(rest);
  const place = from?.[1]?.trim() ?? "";
  const store = place && !VAGUE_STORE.test(place) && !/^(?:(?:my|the|our)\s+)?(?:usual|regular|normal|go to)\b/i.test(place) && place.split(" ").length <= 4 ? place : undefined;
  let phrase = rest.replace(ITEM_END, "").trim();
  for (let i = 0; i < 6 && ITEM_LEAD.test(phrase); i++) phrase = phrase.replace(ITEM_LEAD, "").trim();
  const items = [
    ...new Set(
      phrase
        .split(/\s*,\s*|\s+and\s+/i)
        .map((s) => s.replace(ITEM_LEAD, "").trim())
        .filter(Boolean),
    ),
  ];
  if (items.length === 1 && NO_ITEM.test(items[0]!)) items.length = 0;
  // A long or odd phrase isn't a plain item: the model's to read.
  if (items.length > 4 || items.some((i) => i.length > 40 || i.split(" ").length > 5 || NO_ITEM.test(i))) return null;
  return { ...(items.length && { items }), ...(store && { store }) };
}
