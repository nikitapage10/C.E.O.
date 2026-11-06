/**
 * Skippy's quick tier, by rules (#926): the asks that need no model to understand, sorted in microseconds, the same on
 * every surface (typed on the Desk, a room's mic, hold Space on any page, the phone's "Skippy" shortcut, a Talk call).
 *
 *   climate   "what's the temperature in the apartment?", "is the heat on?", "how warm is it in here?": the Haven's
 *             home_status read, the thermostat's line. Never "set the thermostat to 70" (no tool sets it) and never the
 *             weather outside or a city's (those go to the model and the web).
 *   devices   the Hey Skippy rules for the home devices (api/_haven/classify.ts deviceAsk, #632 and #713): "open the wet
 *             food feeder", "feed the cat two portions", "vacuum the kitchen", "run the litter box", "what's in the wet
 *             feeder?". Hyphens and a possessive are smoothed first ("wet-food", "the cat's wet food feeder").
 *
 * `spokenAsked` is the words check a spoken surface runs before a home device acts on the model's call: Nikita's own
 * words must ask for that very action (the phone's rule), so a model's guess or a page's text never runs one.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { deviceAsk } from "../../_haven/classify.js";

/** A tool call the rules settled, with exactly the input the tool's schema takes. */
export interface DirectAsk {
  tool: "home_status" | "home_device";
  input: Record<string, unknown>;
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

/** The ask the rules settle at once, or null for the model. Never calls anything. */
export function directAsk(text: string): DirectAsk | null {
  const t = smooth(text).replace(/[.!?]+$/, "");
  if (!t || t.length > DIRECT_MAX) return null;
  if (climateAsk(t)) return { tool: "home_status", input: { about: "climate" } };
  const d = deviceAsk(t);
  if (!d) return null;
  if (d.action === "wet.status") return { tool: "home_status", input: { about: "wet-feeder" } };
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
  const t = smooth(said);
  const ruled = directAsk(t);
  if (ruled?.tool === "home_device") return ruled.input.action === input.action;
  if (/^(?:is|are|what|which|when|how|did|does|has)\b/i.test(t)) return false;
  const words = LOOSE[String(input.action)];
  return !!words && words.every((w) => w.test(t));
}
