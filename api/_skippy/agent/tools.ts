/**
 * The rooms' tools, server side (#646): the one registry (each room's `rooms/<id>/tools.ts`, `@ceo/engine/tools`) and
 * the one executor per name. Desk Skippy's agent loop and a room's voice hook (`POST /api/skippy-act`) both call
 * `callTool`, so every call passes the same checks whichever side asks:
 *
 *   - the input is checked against the tool's schema in code (`checkInput`), never trusted as the model gave it;
 *   - once anything fetched from the web is in the turn, only reads run (`tainted`): fetched content never triggers
 *     an action, even one that would still wait for a tap;
 *   - a tool that sends, spends or deletes, or asks for it, is kept as a pending call with exactly its input
 *     (./pending.ts) and runs only on Nikita's Yes tap (`confirmTool`). The spoken surfaces (a room's mic, hold Space,
 *     the phone, a call), which can't show a button, get every tool too (#926: Skippy never says he can't do what a
 *     tool does), and anything else that waits for the tap says so, by name. A home device, a light or a lights
 *     scene (`WORDS_RUN`) runs at once on every surface, typed in the Desk's chat too (#1015), when Nikita's own words
 *     ordered that very action (`spokenAsked`, the phone's rule since #632; `spokenLights` since #1011); typed words
 *     that didn't order it get the Yes card, said ones run nothing;
 *   - what a tool writes goes through the privacy check (and the memory's own rules) first.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { checkInput, needsConfirm, type PendingConfirm, type RoomTool, type ToolOutcome } from "@ceo/engine/tools";
import { TOOLS as BOILER } from "../../../rooms/boiler/tools.js";
import { TOOLS as EXCHANGE } from "../../../rooms/exchange/tools.js";
import { TOOLS as FOUNDRY } from "../../../rooms/foundry/tools.js";
import { TOOLS as GREEN } from "../../../rooms/green/tools.js";
import { TOOLS as HAVEN } from "../../../rooms/haven/tools.js";
import { TOOLS as RELAY } from "../../../rooms/relay/tools.js";
import { TOOLS as TODAY } from "../../../rooms/today/tools.js";
import { PRIVATE_LABEL, privateParts } from "../../_privacy.js";
import { cleanGist, cleanWho } from "../../_relay/compose.js";
import { plainLine } from "../../foundry.js";
import type { ReadName } from "../voicereads.js";
import { climateOf, deviceOf } from "../../_haven/devices/homeread.js";
import type { Lights } from "../../_haven/lights/lights.js";
import { LIGHT_WHERE, type LightWhere } from "../../_haven/planShape.js";
import { REFUSAL_SAY, isMemoryId, memoryRefusal, readOne, search, type MemoryStore } from "./memory.js";
import type { PendingStore } from "./pending.js";
import { allLightsName, spokenAsked, spokenLights } from "./words.js";
import { componentFor, DAY_NAME, DAYS, findMeal, mealNamed, readEdit, ROLES, weekWords, type Day, type EditResult, type MealEdit, type MealsFile, type Role, type SkipReason, type Spice } from "../../_haven/mealShape.js";

/** Every room's tools, in one fixed order (the prompt cache needs the same bytes every time). */
export const ALL_TOOLS: readonly RoomTool[] = [...TODAY, ...FOUNDRY, ...RELAY, ...GREEN, ...EXCHANGE, ...BOILER, ...HAVEN];
const BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));
export const toolNamed = (name: string): RoomTool | undefined => BY_NAME.get(name);

/** What the executors reach, handed in so tests stub each piece. */
export interface ToolHost {
  /** A room's live lines (api/_skippy/toolroute.ts readText: the same reads the Desk's room pages and Talk use). */
  read: (name: ReadName) => Promise<string>;
  memory: MemoryStore | null;
  kitchenAdd: ((items: string[]) => Promise<{ added: string[]; already: string[] }>) | null;
  /** The Things to buy list (#735, api/_haven/list.ts); absent or null where there's no private store. */
  buyAdd?: ((items: string[]) => Promise<{ added: string[]; already: string[] }>) | null;
  /** The Kitchen's meal planner (#678, api/_haven/meals.ts): the same store and edits as the Kitchen's buttons. */
  meals?: {
    read: () => Promise<MealsFile | null>;
    edit: (edit: MealEdit) => Promise<EditResult | { ok: false; error: "not-seeded" }>;
    send: () => Promise<{ added: number; already: number } | null>;
  } | null;
  /**
   * The Kitchen's King Soopers rail (api/_haven/kroger/route.ts): what a send would add now, and the send itself, which
   * adds exactly those picks to the cart. Only meals_cart reaches it, and only on Nikita's Yes tap.
   */
  cart?: {
    now: () => Promise<{ picks: { key: string; productId: string }[]; unmatched: number; connected: boolean; store: boolean } | null>;
    send: (picks: { key: string; productId: string }[]) => Promise<{ result: string; items?: number }>;
  } | null;
  /**
   * The home devices' rails (api/_haven/devices/home.ts). `via` and `said` are for the Council: where the ask came from
   * and the words as said (a spoken ask), else the button's label.
   */
  homeAct: ((req: HomeAsk) => Promise<{ ok: boolean; say: string; warned?: boolean }>) | null;
  /** The lights (#931, api/_haven/lights): SwitchBot and Govee; absent or null where their keys aren't set. */
  lights?: Pick<Lights, "view" | "byName" | "set" | "scene"> | null;
  /**
   * A light's spot on the private floor plan (#974, api/_haven/plan.ts): in a room by its name and a place in it, at x
   * and y, or off the map (null). Absent or null without the private store.
   */
  placeLight?: ((name: string, at: LightAt | null) => Promise<{ ok: boolean; say: string }>) | null;
  /** Files an issue labelled foundry and foundry:chat; its number, or null. */
  fileIssue: ((title: string, body: string) => Promise<number | null>) | null;
  /** The skip list's terms (EMAIL_SKIP_TERMS), which never go in memory. */
  skipTerms: readonly string[];
  now: number;
}

/** Where Skippy puts a light (#974): a room and a place in it, or plan units. */
export type LightAt = { room: string; where: LightWhere } | { x: number; y: number };

/** One home device ask, as the rails take it. */
export interface HomeAsk {
  action: string;
  rooms?: string[];
  portions?: number;
  plate?: number;
  suction?: "quiet" | "max";
  water?: "off" | "on";
  via?: "desk" | "phone";
  said?: string;
}

/** A text for Relay's Blasto (#536): the same action the chat's closed schema has, shown as Relay's card. */
export interface TextAction {
  kind: "text";
  label: string;
  who: string;
  text: string;
}

type Ran = { ok: boolean; text: string; did?: string; action?: TextAction; warned?: boolean };
type Prepared = { ok: true; label: string; summary: string } | { ok: false; text: string };

interface Executor {
  /** For a tool that waits for the tap: the Yes button and exactly what will happen, or why it can't. */
  prepare?: (input: Record<string, unknown>, host: ToolHost) => Promise<Prepared>;
  run: (input: Record<string, unknown>, host: ToolHost) => Promise<Ran>;
  /** Its own card on the Desk is the tap (draft_text: Relay's Send button), so it isn't kept as a pending call. */
  ownCard?: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const reader = (name: ReadName): Executor => ({ run: async (_i, host) => ({ ok: true, text: (await host.read(name).catch(() => "")) || "That room didn't answer just now." }) });
const held = (text: string) => {
  const kinds = privateParts(text);
  return kinds.length ? `That has ${[...new Set(kinds)].map((k) => PRIVATE_LABEL[k]).join(" and ")} in it, so it can't go out. Say it another way.` : "";
};

/** The words for a home device ask, for the Yes button's summary. */
const HOME_WORDS: Record<string, string> = {
  "vacuum.start": "Start the vacuum",
  "vacuum.rooms": "Vacuum",
  "vacuum.pause": "Pause the vacuum",
  "vacuum.dock": "Send the vacuum home",
  "feeder.feed": "Feed the cat",
  "wet.open": "Open the wet feeder for 2 hours",
  "wet.rotate": "Turn the wet feeder to the next bowl",
  "wet.close": "Close the wet feeder",
  "litter.clean": "Run the Litter-Robot",
};
const homeLine = (i: Record<string, unknown>) => {
  const rooms = Array.isArray(i.rooms) ? (i.rooms as string[]) : [];
  const base = HOME_WORDS[str(i.action)] ?? str(i.action);
  if (i.action === "vacuum.rooms" && rooms.length) return `${base} ${rooms.join(", ")}`;
  if (i.action === "feeder.feed" && typeof i.portions === "number") return `${base}: ${i.portions} portion${i.portions === 1 ? "" : "s"}`;
  return base;
};

/** The lights as Skippy hears them (#931): names and states only, never an id. */
async function lightsText(host: ToolHost): Promise<string> {
  if (!host.lights) return "The lights aren't set up on this copy yet.";
  const v = await host.lights.view();
  const down = (["switchbot", "govee"] as const).filter((x) => v.vendors[x] === "down").map((x) => (x === "govee" ? "Govee" : "SwitchBot"));
  const lines = [
    v.lights.length ? `Lights: ${v.lights.map((l) => `${l.name || "unnamed"} (${l.vendor === "govee" ? "Govee" : "SwitchBot"} ${l.type || "device"}) ${!l.online ? "offline" : l.on === null ? "state unknown" : l.on ? "on" : "off"}`).join("; ")}.` : "No lights found.",
    v.scenes.length ? `Scenes: ${v.scenes.map((s) => s.name).join("; ")}.` : "",
    v.groups?.length ? `Groups (on or off for all of them; never placed): ${v.groups.map((g) => g.name).join("; ")}.` : "",
    v.remotes.length ? `Remotes (power on or off, no state): ${v.remotes.map((r) => `${r.name} (${r.type || "IR remote"})`).join("; ")}.` : "",
    down.length ? `${down.join(" and ")} didn't answer just now.` : "",
  ];
  return lines.filter(Boolean).join(" ");
}

/** A light or remote (`scene` false) or a scene by name, or what to tell the model when there's no single match. */
async function lightNamed(host: ToolHost, i: Record<string, unknown>, scene: boolean): Promise<{ ok: true; id: string; name: string } | { ok: false; text: string }> {
  if (!host.lights) return { ok: false, text: "The lights aren't set up on this copy yet." };
  const got = await host.lights.byName(str(i.name));
  if (!got || (got.kind === "scene") !== scene) {
    // The names it does know, so a spoken answer (#1011) and the model alike can say which one he meant.
    const v = await host.lights.view().catch(() => null);
    const names = v ? (scene ? v.scenes : [...v.lights, ...(v.groups ?? []), ...v.remotes]).map((x) => x.name).filter(Boolean).slice(0, 12) : [];
    return { ok: false, text: `I don't know ${scene ? "a scene" : "a light"} called ${plainLine(str(i.name), 60)}.${names.length ? ` ${scene ? "The scenes are" : "The lights are"}: ${names.join(", ")}.` : ""}` };
  }
  return { ok: true, id: got.id, name: got.name };
}

/** Whether a lights_set call means every light (#1011): "all", "the lights", unless a light is called just that. */
async function everyLight(host: ToolHost, i: Record<string, unknown>): Promise<boolean> {
  if (!host.lights || !allLightsName(str(i.name))) return false;
  const got = await host.lights.byName(str(i.name)).catch(() => null);
  return !got || got.kind === "scene";
}

/** Every light that answers, on or off at once (#1011), each through the lights' own switch; says what didn't take. */
async function switchEvery(host: ToolHost, on: boolean): Promise<Ran> {
  const v = await host.lights!.view();
  const all = v.lights.length ? v.lights : (v.groups ?? []);
  const live = all.filter((l) => !("online" in l) || l.online !== false);
  if (!live.length) return { ok: false, text: all.length ? "None of the lights are online just now." : "No lights found to switch." };
  const got = await Promise.all(live.map(async (l) => ({ name: l.name || "a light", ok: (await host.lights!.set(l.id, on).catch(() => ({ ok: false }))).ok })));
  const done = got.filter((g) => g.ok).map((g) => g.name);
  const failed = got.filter((g) => !g.ok).map((g) => g.name);
  const way = on ? "on" : "off";
  if (!done.length) return { ok: false, text: `The lights didn't switch ${way}: ${failed.join(", ")} didn't answer.` };
  const offline = all.length - live.length;
  const rest = [failed.length ? `${failed.join(", ")} didn't take it` : "", offline ? `${offline} ${offline === 1 ? "is" : "are"} offline` : ""].filter(Boolean).join("; ");
  return { ok: true, text: rest ? `Lights ${way}: ${done.join(", ")}; ${rest}.` : `The lights are ${way}.`, did: `Lights ${way}`, ...(rest && { warned: true }) };
}

/** The issue "Implement it" files: the model's title and pitch, both through the privacy check and shown on the Yes button first. */
export function implementIssue(title: string, pitch: string, size: string): { title: string; body: string } {
  return {
    title: plainLine(title, 80),
    body: [
      `**Pitch:** ${plainLine(pitch, 500)}`,
      `**Size:** ${size}`,
      "**Short:** Building what Nikita asked",
      "**Builder:** Not picked yet (filed by Desk Skippy's Implement it, on Nikita's Yes tap)",
    ].join("\n"),
  };
}

/** What Skippy hears when a meal edit couldn't happen. */
const MEAL_NO: Record<string, string> = {
  "not-seeded": "The meal planner isn't loaded yet.",
  "no-week": "There's no week planned yet. Plan one first.",
  "not-found": "That isn't in the plan.",
  "no-backup": "Nothing else fits that night. Pick a meal by name.",
  "no-undo": "There's nothing to undo.",
  "bad-meal": "That meal or part doesn't fit there.",
  short: "The catalog is too small to plan a whole week.",
};
/** The same errors, said for the edit that hit them. */
const MEAL_NO_FOR: Partial<Record<MealEdit["op"], Record<string, string>>> = {
  unavoid: { "not-found": "That wasn't on the avoid list." },
  lunch: { "bad-meal": "That lunch doesn't fit there: it's passed on, or Monday, which has no leftovers yet." },
  like: { "not-found": "That wasn't on the likes." },
  swap: { "bad-meal": "That meal is passed on. Bring it back from the catalog first, or pick another." },
};

/**
 * Meal edits through the planner's store, in words. Each goes through `readEdit` first, the same check the Kitchen's
 * own requests pass, so a tool can only ever make an edit the closed set allows. Several run in order; the first that
 * fails stops the rest.
 */
const mealEdit = async (host: ToolHost, ...edits: Array<MealEdit | string>): Promise<Ran> => {
  if (!host.meals) return { ok: false, text: "The meal planner isn't set up on this copy." };
  const said: string[] = [];
  let last = "";
  for (const raw of edits) {
    if (typeof raw === "string") return { ok: false, text: raw };
    const edit = readEdit(raw);
    if (!edit) return { ok: false, text: "That isn't a change the planner can make." };
    const got = await host.meals.edit(edit);
    if (!got.ok) {
      const no = MEAL_NO_FOR[edit.op]?.[got.error] ?? MEAL_NO[got.error] ?? "That didn't work.";
      return said.length ? { ok: true, text: `${said.join(" ")} But: ${no}`, did: last } : { ok: false, text: no };
    }
    said.push(...got.changes);
    last = plainLine(got.changes[got.changes.length - 1] ?? "Changed the meal plan", 60);
  }
  return { ok: true, text: `${said.join(" ")} The Kitchen page shows it; Undo is there too.`, did: last };
};
const dayOf = (v: unknown): Day => (DAYS as readonly unknown[]).includes(v) ? (v as Day) : "mon";
const ROLE_WORD: Record<Role, string> = { protein: "protein", carb: "carb", side: "side" };

const EXECUTORS: Record<string, Executor> = {
  memory_lookup: {
    run: async (i, host) => {
      if (!host.memory) return { ok: false, text: "My memory isn't set up on this copy." };
      const hits = search(await host.memory.load(), str(i.query));
      return { ok: true, text: hits.length ? hits.map((h) => `[${h.id}] ${h.line}`).join("\n") : "Nothing in memory on that." };
    },
  },
  memory_read: {
    run: async (i, host) => {
      if (!host.memory) return { ok: false, text: "My memory isn't set up on this copy." };
      return { ok: true, text: (isMemoryId(i.id) && readOne(await host.memory.load(), i.id)) || "No memory with that id." };
    },
  },
  remember: {
    prepare: async (i, host) => {
      const fact = plainLine(str(i.fact), 300);
      const why = memoryRefusal(`${fact}\n${str(i.topic)}`, host.skipTerms);
      if (why) return { ok: false, text: REFUSAL_SAY[why] };
      return { ok: true, label: "Remember it", summary: `Remember: ${fact}` };
    },
    run: async (i, host) => {
      if (!host.memory) return { ok: false, text: "My memory isn't set up on this copy." };
      const saved = await host.memory.addFact(str(i.fact), str(i.topic), "desk", host.now);
      if (!saved.ok) return { ok: false, text: saved.why === "empty" || saved.why === "full" || saved.why === "missing" ? "Nothing to keep." : REFUSAL_SAY[saved.why] };
      return { ok: true, text: `Kept: ${saved.value.text}`, did: "Remembered it" };
    },
  },
  forget: {
    prepare: async (i, host) => {
      const one = host.memory && isMemoryId(i.id) ? readOne(await host.memory.load(), i.id) : null;
      return one ? { ok: true, label: "Forget it", summary: `Forget: ${plainLine(one.split("\n")[0] ?? "", 200)}` } : { ok: false, text: "No memory with that id." };
    },
    run: async (i, host) => {
      const gone = host.memory ? await host.memory.forget(str(i.id)) : false;
      return gone ? { ok: true, text: "Forgotten.", did: "Forgot it" } : { ok: false, text: "No memory with that id." };
    },
  },
  green_board: reader("green"),
  exchange_odds: reader("exchange"),
  exchange_book: reader("exchange_positions"),
  boiler_pipes: reader("boiler"),
  relay_counts: reader("relay"),
  foundry_board: reader("foundry"),
  draft_text: {
    ownCard: true,
    run: async (i) => {
      const who = cleanWho(i.who);
      const text = cleanGist(i.text);
      if (!who || !text || privateParts(`${who}\n${text}`).some((k) => k !== "name")) return { ok: false, text: "I can only have a text drafted to someone you name, with plain words; no numbers or addresses." };
      return { ok: true, text: "Relay's card is on the Desk with the draft; nothing goes until Nikita taps Send.", action: { kind: "text", label: "Draft the text", who, text } };
    },
  },
  implement_it: {
    prepare: async (i) => {
      const issue = implementIssue(str(i.title), str(i.pitch), str(i.size));
      const no = held(`${issue.title}\n${issue.body}`);
      if (no) return { ok: false, text: no };
      return { ok: true, label: "File it", summary: `File a ${str(i.size)} foundry issue for the Builder: ${issue.title}` };
    },
    run: async (i, host) => {
      if (!host.fileIssue) return { ok: false, text: "Filing issues isn't set up on this copy." };
      const issue = implementIssue(str(i.title), str(i.pitch), str(i.size));
      if (held(`${issue.title}\n${issue.body}`)) return { ok: false, text: "That had something private in it, so nothing was filed." };
      const n = await host.fileIssue(issue.title, issue.body).catch(() => null);
      return n ? { ok: true, text: `Filed as number ${n} for the Builder.`, did: `Filed #${n} for the Builder` } : { ok: false, text: "GitHub didn't take the issue just now." };
    },
  },
  kitchen_add: {
    run: async (i, host) => {
      if (!host.kitchenAdd) return { ok: false, text: "The Kitchen list isn't set up on this copy." };
      const items = (i.items as string[]).map((x) => plainLine(x, 60)).filter((x) => x && !privateParts(x).length);
      if (!items.length) return { ok: false, text: "Nothing plain enough to put on the list." };
      const { added, already } = await host.kitchenAdd(items);
      const text = `${added.length ? `Added ${added.join(", ")}.` : ""}${already.length ? ` Already on it: ${already.join(", ")}.` : ""}`.trim() || "Nothing new to add.";
      return { ok: true, text, ...(added.length && { did: `Added ${added.length === 1 ? added[0] : `${added.length} things`} to the Kitchen list` }) };
    },
  },
  buy_add: {
    run: async (i, host) => {
      if (!host.buyAdd) return { ok: false, text: "The Things to buy list isn't set up on this copy." };
      const items = (i.items as string[]).map((x) => plainLine(x, 60)).filter((x) => x && !privateParts(x).length);
      if (!items.length) return { ok: false, text: "Nothing plain enough to put on the list." };
      const { added, already } = await host.buyAdd(items);
      const text = `${added.length ? `Added ${added.join(", ")} to Things to buy.` : ""}${already.length ? ` Already on it: ${already.join(", ")}.` : ""}`.trim() || "Nothing new to add.";
      return { ok: true, text, ...(added.length && { did: `Added ${added.length === 1 ? added[0] : `${added.length} things`} to Things to buy` }) };
    },
  },
  meals_week: {
    run: async (_i, host) => {
      if (!host.meals) return { ok: false, text: "The meal planner isn't set up on this copy." };
      const f = await host.meals.read();
      return { ok: true, text: f ? weekWords(f) : "The meal planner isn't loaded yet." };
    },
  },
  meals_swap: {
    run: async (i, host) => {
      const day = dayOf(i.day);
      if (i.lunch === true) {
        if (/^\s*(?:the )?left ?overs?\b/i.test(str(i.meal))) return mealEdit(host, { op: "lunch", day, leftovers: true });
        if (!str(i.meal).trim()) return { ok: false, text: "Name the lunch, or say leftovers." };
        const f = host.meals ? await host.meals.read() : null;
        if (host.meals && !f) return { ok: false, text: MEAL_NO["not-seeded"]! };
        const lunch = f ? findMeal(f, str(i.meal), "lunch") : undefined;
        return mealEdit(host, lunch ? { op: "lunch", day, meal: lunch.id } : `There's no lunch called "${plainLine(str(i.meal), 40)}" in the catalog. Read the week for the lunches, or say leftovers.`);
      }
      if (i.not_for_me === true) return mealEdit(host, { op: "nope", day });
      if (!str(i.meal).trim()) return { ok: false, text: "Name the meal, or say not for me." };
      const f = host.meals ? await host.meals.read() : null;
      if (host.meals && !f) return { ok: false, text: MEAL_NO["not-seeded"]! };
      const meal = f ? findMeal(f, str(i.meal), "dinner") : undefined;
      return mealEdit(host, meal ? { op: "swap", day, meal: meal.id } : `There's no meal called "${plainLine(str(i.meal), 40)}" in the catalog. Read the week for the backups, or name another.`);
    },
  },
  meals_customize: {
    run: async (i, host) => {
      const day = dayOf(i.day);
      if (i.reset === true) return mealEdit(host, { op: "customize", day, reset: true });
      const portion = typeof i.portion === "string" ? Number(i.portion) : undefined;
      const spice = typeof i.spice === "string" ? (i.spice as Spice) : undefined;
      const role = (ROLES as readonly unknown[]).includes(i.role) ? (i.role as Role) : undefined;
      let part: { index: number; option: string } | undefined;
      if (role && !str(i.option).trim()) return { ok: false, text: `Say what the ${ROLE_WORD[role]} should be instead.` };
      if (str(i.option).trim()) {
        if (!host.meals) return mealEdit(host);
        const f = await host.meals.read();
        const slot = f?.week?.slots[DAYS.indexOf(day)];
        const meal = f && slot ? mealNamed(f, slot.meal) : undefined;
        if (!f || !meal) return { ok: false, text: f ? MEAL_NO["no-week"]! : MEAL_NO["not-seeded"]! };
        const comp = componentFor(f, str(i.option), role);
        if (!comp) return { ok: false, text: `The planner has no "${plainLine(str(i.option), 40)}"${role ? ` ${ROLE_WORD[role]}` : ""}. Say it another way (a protein, carb or side by name, or "no carb").` };
        const index = meal.parts.findIndex((p) => p.role === comp.role);
        if (index < 0) return { ok: false, text: `${DAY_NAME[day]}'s ${meal.name} has no ${ROLE_WORD[comp.role]} to change.` };
        part = { index, option: comp.id };
      }
      if (!part && portion === undefined && !spice) return { ok: false, text: "Say what to change: a part, the portion or the spice." };
      return mealEdit(host, { op: "customize", day, ...(part && { part }), ...(portion !== undefined && { portion }), ...(spice && { spice }) });
    },
  },
  meals_night: {
    run: async (i, host) => {
      // Skip (#788): the day's dinner, lunch or both, with the reason he gave; unskip has them again.
      const why: SkipReason | null = i.unskip === true ? null : i.reason === "out" || i.reason === "leftovers" ? i.reason : "skip";
      const skip = i.skip === "dinner" || i.skip === "lunch" || i.skip === "day" ? i.skip : null;
      const e = {
        op: "night" as const,
        day: dayOf(i.day),
        ...(typeof i.hellofresh === "boolean" && { helloFresh: i.hellofresh }),
        ...(typeof i.for_two === "boolean" && { forTwo: i.for_two }),
        ...(typeof i.in_cart === "boolean" && { inCart: i.in_cart }),
        ...((skip === "dinner" || skip === "day") && { skipDinner: why }),
        ...((skip === "lunch" || skip === "day") && { skipLunch: why }),
      };
      return mealEdit(host, Object.keys(e).length > 2 ? e : "Say what to change about the night.");
    },
  },
  meals_avoid: {
    run: async (i, host) => {
      const term = plainLine(str(i.ingredient), 40).toLowerCase();
      if (term.length < 2 || privateParts(term).length) return { ok: false, text: "Name the ingredient plainly." };
      if (i.allow === true) return mealEdit(host, { op: "unavoid", term });
      const unless = plainLine(str(i.unless), 40).toLowerCase();
      return mealEdit(host, { op: "avoid", term, ...(unless && { unless }) });
    },
  },
  meals_taste: {
    run: async (i, host) => {
      const edits: Array<MealEdit | string> = [];
      for (const [field, liked] of [["like", true], ["unlike", false]] as const) {
        const term = plainLine(str(i[field]), 40).toLowerCase();
        if (!str(i[field])) continue;
        edits.push(term.length >= 2 && !privateParts(term).length ? { op: "like", term, liked } : "Name what he likes plainly.");
      }
      if (typeof i.heat === "string") edits.push({ op: "heat", spice: i.heat === "as-written" ? null : (i.heat as Spice) });
      if (typeof i.protein_goal === "number") edits.push({ op: "goal", protein: i.protein_goal });
      return edits.length ? mealEdit(host, ...edits) : { ok: false, text: "Say what to note: a like, the heat or the protein goal." };
    },
  },
  meals_undo: { run: async (_i, host) => mealEdit(host, { op: "undo" }) },
  meals_send: {
    run: async (_i, host) => {
      if (!host.meals) return { ok: false, text: "The meal planner isn't set up on this copy." };
      const got = await host.meals.send();
      if (!got) return { ok: false, text: "There's no week to send, or nothing in it to buy." };
      return { ok: true, text: `Put ${got.added} thing${got.added === 1 ? "" : "s"} on the Kitchen list${got.already ? ` (${got.already} already there)` : ""}. The King Soopers picks are on the Kitchen page; meals_cart sends them to the cart once he taps Yes.`, did: "Sent the week to the Kitchen list" };
    },
  },
  meals_cart: {
    prepare: async (_i, host) => {
      const now = host.cart ? await host.cart.now().catch(() => null) : null;
      if (!now) return { ok: false, text: "King Soopers isn't set up on this copy." };
      if (!now.store) return { ok: false, text: "Pick a home store first: Boiler Room, Controls, Connections." };
      if (!now.connected) return { ok: false, text: "King Soopers isn't connected. Connect it once in Boiler Room, Controls, Connections." };
      if (!now.picks.length) return { ok: false, text: now.unmatched ? `Nothing is matched yet: tap Match on the Kitchen page for the ${now.unmatched} open item${now.unmatched === 1 ? "" : "s"} first.` : "The Kitchen list has nothing to send." };
      const wait = now.unmatched ? ` (${now.unmatched} more still need matching on the Kitchen page)` : "";
      return { ok: true, label: "Send to King Soopers", summary: `Add the ${now.picks.length} matched item${now.picks.length === 1 ? "" : "s"} on the Kitchen page to your King Soopers cart${wait}. Nothing is bought; you check out in the King Soopers app.` };
    },
    run: async (_i, host) => {
      const now = host.cart ? await host.cart.now() : null;
      if (!host.cart || !now?.picks.length) return { ok: false, text: "There's nothing matched to send to King Soopers now." };
      const got = await host.cart.send(now.picks);
      if (got.result === "sent") return { ok: true, text: `Added ${got.items} item${got.items === 1 ? "" : "s"} to the King Soopers cart. Check out in the King Soopers app.`, did: "Sent the picks to King Soopers" };
      const no: Record<string, string> = {
        "not-connected": "King Soopers isn't connected. Connect it once in Boiler Room, Controls, Connections.",
        changed: "The picks changed while you were deciding. Look at the Kitchen page and ask again.",
        refused: "King Soopers turned the sign-in down. Connect it again in Boiler Room, Controls.",
        "too-many": "That's more than one send takes. Send from the Kitchen page in parts.",
      };
      return { ok: false, text: no[got.result] ?? "King Soopers didn't take it just now. Try the Kitchen page's Send." };
    },
  },
  meals_next_week: { run: async (_i, host) => mealEdit(host, { op: "next-week" }) },
  home_status: {
    run: async (i, host) => {
      // What's in the wet tray is the rails' own summary (the next meal first, the bowls, today's serves, the schedule).
      if (i.about === "wet-feeder" && host.homeAct) {
        const r = await host.homeAct({ action: "wet.status" });
        if (r.ok) return { ok: true, text: r.say };
      }
      const text = (await host.read("haven").catch(() => "")) || "The home devices didn't answer just now.";
      if (i.about === "climate") return { ok: true, text: climateOf(text) };
      // One device's line (#952: its next meal or clean leads), from the same instant read.
      if (i.about === "wet-feeder" || i.about === "dry-feeder" || i.about === "vacuum" || i.about === "feeders") return { ok: true, text: deviceOf(text, i.about) };
      return { ok: true, text };
    },
  },
  home_device: {
    prepare: async (i) => ({ ok: true, label: "Do it", summary: `${homeLine(i)} (the Haven's rails still apply)` }),
    run: async (i, host) => {
      if (!host.homeAct) return { ok: false, text: "The home devices aren't set up on this copy." };
      const r = await host.homeAct({
        action: str(i.action),
        ...(Array.isArray(i.rooms) && { rooms: i.rooms as string[] }),
        ...(typeof i.portions === "number" && { portions: i.portions }),
        ...(typeof i.plate === "number" && { plate: i.plate }),
        ...((i.suction === "quiet" || i.suction === "max") && { suction: i.suction }),
        ...((i.water === "off" || i.water === "on") && { water: i.water }),
        ...((i.via === "desk" || i.via === "phone") && { via: i.via }),
        ...(typeof i.said === "string" && { said: i.said }),
      });
      return r.ok ? { ok: true, text: r.say, did: plainLine(homeLine(i), 40), ...(r.warned && { warned: true }) } : { ok: false, text: r.say };
    },
  },
  lights_list: { run: async (_i, host) => ({ ok: true, text: await lightsText(host) }) },
  lights_set: {
    prepare: async (i, host) => {
      if (await everyLight(host, i)) return { ok: true, label: i.on ? "Turn them on" : "Turn them off", summary: `Turn every light ${i.on ? "on" : "off"}` };
      const l = await lightNamed(host, i, false);
      return l.ok ? { ok: true, label: i.on ? "Turn it on" : "Turn it off", summary: `Turn ${l.name} ${i.on ? "on" : "off"}` } : l;
    },
    run: async (i, host) => {
      if (await everyLight(host, i)) return switchEvery(host, i.on === true);
      const l = await lightNamed(host, i, false);
      if (!l.ok) return l;
      const r = await host.lights!.set(l.id, i.on === true);
      return r.ok ? { ok: true, text: r.say, did: plainLine(`${l.name} ${i.on ? "on" : "off"}`, 40) } : { ok: false, text: r.say };
    },
  },
  lights_place: {
    run: async (i, host) => {
      if (!host.placeLight) return { ok: false, text: "The floor plan isn't kept on this copy." };
      // The light's own name from the apps, when they're set up: a spot is matched by it.
      let name = plainLine(str(i.name), 60);
      if (host.lights) {
        const got = await host.lights.byName(str(i.name));
        if (!got) return { ok: false, text: `I don't know a light called ${name}. Read lights_list for the names.` };
        if (got.kind !== "light") return { ok: false, text: `${got.name} is ${got.kind === "remote" ? "a remote" : got.kind === "group" ? "a group" : "a scene"}, not a light: only lights go on the map.` };
        name = got.name;
      }
      const where = LIGHT_WHERE.includes(i.where as LightWhere) ? (i.where as LightWhere) : "middle";
      const at: LightAt | null = i.clear === true ? null : typeof i.x === "number" && typeof i.y === "number" ? { x: i.x, y: i.y } : typeof i.room === "string" && i.room.trim() ? { room: i.room, where } : null;
      if (!at && i.clear !== true) return { ok: false, text: "Say which room it's in (and where in it), or its x and y." };
      const r = await host.placeLight(name, at);
      return r.ok ? { ok: true, text: r.say, did: plainLine(`${name} ${at ? "placed" : "off the map"}`, 40) } : { ok: false, text: r.say };
    },
  },
  lights_scene: {
    prepare: async (i, host) => {
      const s = await lightNamed(host, i, true);
      return s.ok ? { ok: true, label: "Run it", summary: `Run the scene ${s.name}` } : s;
    },
    run: async (i, host) => {
      const s = await lightNamed(host, i, true);
      if (!s.ok) return s;
      const r = await host.lights!.scene(s.id);
      return r.ok ? { ok: true, text: r.say, did: plainLine(s.name, 40) } : { ok: false, text: r.say };
    },
  },
};

/** Every declared tool has its executor and every executor its declaration (a test holds them together). */
export const EXECUTOR_NAMES = Object.keys(EXECUTORS);

/** Where a call comes from: the Desk's chat (buttons can show), or a spoken surface (the phone, a room's mic, a call). */
export type CallSurface = "desk" | "spoken";

/**
 * The tools a surface gets, in the registry's fixed order: every one, on every surface (#926). What a spoken surface
 * can't finish without a tap says so when called (`callTool`), instead of the tool being missing, which is how Skippy
 * came to say "I don't have that ability" for the wet feeder.
 */
export const toolsFor = (_surface: CallSurface): readonly RoomTool[] => ALL_TOOLS;


export interface CallOpts {
  pending: PendingStore | null;
  surface: CallSurface;
  /** Something fetched from the web is in this turn: only reads run. */
  tainted?: boolean;
  /** The voice hook, not the agent: it can't show Relay's card. */
  direct?: boolean;
  /** Nikita's own words this turn (a spoken surface), for the home devices' words check. */
  said?: string;
  /** Where a spoken ask came from, for the Council (the phone, else the Desk). */
  via?: "desk" | "phone";
}

export type CallResult = ToolOutcome & { action?: TextAction; tool?: RoomTool; warned?: boolean };

/** One tool call, from the agent or a room's voice hook, through every check. Never throws. */
export async function callTool(name: string, rawInput: unknown, host: ToolHost, opts: CallOpts): Promise<CallResult> {
  const tool = toolNamed(name);
  const ex = EXECUTORS[name];
  if (!tool || !ex) return { ok: false, text: `There is no tool called ${plainLine(String(name), 40)}.` };
  const checked = checkInput(tool.input, rawInput);
  if (!checked.ok) return { ok: false, text: `That call didn't fit: ${checked.why}.`, tool };
  if (opts.tainted && tool.effect !== "read") return { ok: false, text: "Not after reading the web: nothing fetched from a page can start an action. Tell Nikita what you'd do and let him ask for it himself.", tool };
  try {
    if (ex.ownCard) {
      if (opts.direct || opts.surface !== "desk") return { ok: false, text: "That needs its card on the Desk; ask from Skippy's chat there.", tool };
      const ran = await ex.run(checked.value, host);
      return ran.ok ? { ok: true, text: ran.text, ...(ran.action && { action: ran.action }), tool } : { ok: false, text: ran.text, tool };
    }
    if (needsConfirm(tool)) {
      // A home device or the lights, ordered in Nikita's own words, runs at once on every surface, typed in the Desk's
      // chat or said out loud (#632, #1011, #1015), through its rails; a question never counts as an order.
      if (!opts.direct && WORDS_RUN.has(name)) {
        const asked = name === "home_device" ? spokenAsked(opts.said, checked.value) : spokenLights(opts.said, name, checked.value);
        if (asked) {
          const ran = await ex.run(name === "home_device" ? { ...checked.value, via: opts.via ?? "desk", said: opts.said } : checked.value, host);
          return ran.ok ? { ok: true, text: ran.text, ...(ran.did && { did: ran.did }), ...(ran.warned && { warned: true }), tool } : { ok: false, text: ran.text, tool };
        }
        if (opts.surface !== "desk") {
          const plain = name === "home_device" ? homeLine(checked.value).toLowerCase() : name === "lights_scene" ? `run ${plainLine(str(checked.value.name), 40)}` : `turn ${checked.value.on ? "on" : "off"} the lights`;
          return { ok: false, text: `Nothing ran: ${name === "home_device" ? "the home devices act" : "the lights switch"} on Nikita's own words for them. Ask him to say it plainly ("${plain}") and it runs.`, tool };
        }
        // Typed, but his words didn't order it (a guess from a question or the page): the Yes card, so nothing runs unasked.
      } else if (opts.surface !== "desk" && !opts.direct) {
        return { ok: false, text: `Nothing ran: "${tool.title}" waits for Nikita's Yes tap, so it goes from Skippy's chat on the Desk. Say that in one line.`, tool };
      }
      if (!opts.pending) return { ok: false, text: "Taps aren't set up on this copy.", tool };
      const prep = ex.prepare ? await ex.prepare(checked.value, host) : { ok: true as const, label: "Yes, do it", summary: tool.title };
      if (!prep.ok) return { ok: false, text: prep.text, tool };
      const p = await opts.pending.add({ tool: name, input: checked.value, label: plainLine(prep.label, 40), summary: plainLine(prep.summary, 300) }, host.now);
      const confirm: PendingConfirm = { id: p.id, label: p.label, summary: p.summary };
      return { ok: true, confirm, tool };
    }
    const ran = await ex.run(checked.value, host);
    return ran.ok ? { ok: true, text: ran.text, ...(ran.did && { did: ran.did }), tool } : { ok: false, text: ran.text, tool };
  } catch {
    return { ok: false, text: `${tool.title} failed just now: its service didn't answer.`, tool };
  }
}

/** Nikita's tap on a waiting call: Yes runs it once with the input it was kept with; No drops it. Never throws. */
export async function confirmTool(id: string, yes: boolean, host: ToolHost, pending: PendingStore): Promise<CallResult> {
  const p = await pending.take(id, host.now).catch(() => null);
  if (!p) return { ok: false, text: "That button ran out or was already used. Ask again." };
  const tool = toolNamed(p.tool);
  const ex = EXECUTORS[p.tool];
  if (!tool || !ex) return { ok: false, text: "That tool is gone." };
  if (!yes) return { ok: true, text: "Cancelled; nothing happened.", tool };
  const checked = checkInput(tool.input, p.input);
  if (!checked.ok) return { ok: false, text: "That call no longer fits.", tool };
  try {
    const ran = await ex.run(checked.value, host);
    return ran.ok ? { ok: true, text: ran.text, ...(ran.did && { did: ran.did }), tool } : { ok: false, text: ran.text, tool };
  } catch {
    return { ok: false, text: "That didn't work just now.", tool };
  }
}

/**
 * One field as the Messages API takes it: the type, enum and description; the limits (lengths, ranges, counts) go into
 * the description, and `checkInput` enforces them in code.
 */
function apiProp(p: RoomTool["input"]["properties"][string]): Record<string, unknown> {
  const limits: string[] = [];
  if (p.type === "string" && p.maxLength) limits.push(`at most ${p.maxLength} characters`);
  if (p.type === "integer" && p.minimum !== undefined) limits.push(`at least ${p.minimum}`);
  if (p.type === "integer" && p.maximum !== undefined) limits.push(`at most ${p.maximum}`);
  if (p.type === "array" && p.maxItems) limits.push(`at most ${p.maxItems} items`);
  const description = [p.description, limits.length ? `(${limits.join(", ")})` : ""].filter(Boolean).join(" ");
  return {
    type: p.type,
    ...(p.type === "string" && p.enum && { enum: [...p.enum] }),
    ...(p.type === "array" && { items: { type: "string" } }),
    ...(description && { description }),
  };
}

/**
 * The tools as the Messages API takes them, in the registry's fixed order. Not `strict` (#976): strict tool use allows
 * at most 20 strict tools and 24 optional parameters in a request, counted with the answer's own JSON schema, and the
 * registry outgrew both (29 tools, 30 optional fields), so every model call came back 400 before it began. Every call's
 * input is checked in code instead (`checkInput` in `callTool`), and a bad one goes back to the model as a tool error.
 */
/**
 * The device tools that run at once on Nikita's own words for them, typed or said (#632, #1011, #1015): the home devices
 * and the lights. Every other tapped tool (remember, implement_it, the King Soopers cart) waits for the Yes.
 */
export const WORDS_RUN: ReadonlySet<string> = new Set(["home_device", "lights_set", "lights_scene"]);

export function apiTools(tools: readonly RoomTool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: needsConfirm(t) ? `${t.description} (${WORDS_RUN.has(t.name) ? "It runs at once when Nikita's own words order it, typed or said; a question never runs it." : "Waits for Nikita's Yes tap on the Desk."})` : t.description,
    input_schema: { type: "object" as const, properties: Object.fromEntries(Object.entries(t.input.properties).map(([k, p]) => [k, apiProp(p)])), required: [...t.input.required], additionalProperties: false },
  }));
}
