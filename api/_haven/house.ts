/**
 * "How's the house?" (#1067): one short spoken line from the Haven's own state, for every Skippy surface (the one
 * brain's `house_check` tool, rooms/haven/tools.ts, and its quick tier, agent/words.ts `houseAsk`; the call's
 * `read_house`; the Kernel responder's `house`).
 *
 *   "All quiet: 72 inside, heat set to 70, two lights on, three to-dos, and it's chicken tikka tonight."
 *
 * Built only from what the Haven already reads, no new device calls:
 *   - the thermostat's line out of the home's lines (devices/homeread.ts homeNow: the live view inside its wait, else
 *     the kept lines), so a Nest that is offline or not answering simply drops the temperature;
 *   - the lights' own view (lights/lights.ts, its 20-second kept states), placed into the private floor plan's rooms
 *     when every light that is on has a spot there, else just counted;
 *   - Today's to-dos (the Haven's To-dos panel), counted, with the first one's words when they are short and plain;
 *   - tonight's dinner from the Kitchen's meal plan.
 * The vacuum and the cat's devices come in only when one needs attention (an alert, or offline).
 *
 * Private: said only to Nikita on his own signed-in call or chat (the tools behind his sign-in and the call's token).
 * Never on a public endpoint, the Lattice or a log. Nothing about the home is in this code.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { privateParts } from "../_privacy.js";
import { isOpen, type TodoState } from "../_today/todos.js";
import type { LightsView } from "./lights/lights.js";
import { allWeeks, DAYS, dinnerSkipped, mealNamed, type Day, type MealsFile } from "./mealShape.js";
import { lightKey, type HavenPlan } from "./planShape.js";

/** How long each piece may take before the line goes without it (the call's tool has five seconds in all). */
export const HOUSE_WAIT_MS = 2_500;
/** A to-do's words are said only when they are this short. */
export const TODO_SAID_MAX = 40;
/** Said when nothing about the house answered. */
export const NO_HOUSE = "I can't see the house right now: none of its readings came back.";

const TZ = "America/Denver";
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** A small count in words ("three"), a bigger one in digits. */
export const count = (n: number): string => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/* ── The thermostat ── */

/**
 * The thermostat's part, from the home's lines (homeread.ts climateLine): "72 inside, heat set to 70". Null when the
 * thermostat is offline, not answering or not connected, or the lines are hours old.
 */
export function climateBit(homeLines: string): string | null {
  const lines = homeLines.split("\n");
  if (/^As of .*hour/.test(lines[0] ?? "")) return null;
  const line = lines.find((l) => /^It's -?\d+°F inside/.test(l));
  if (!line) return null;
  const inside = /^It's (-?\d+)°F inside/.exec(line)![1];
  let set = "";
  let m: RegExpExecArray | null;
  if (/the thermostat is in eco/.test(line)) set = "thermostat on eco";
  else if (/heating and cooling are off/.test(line)) set = "heat and AC off";
  else if ((m = /keeps it between (\d+) and (\d+)°F/.exec(line))) set = `held between ${m[1]} and ${m[2]}`;
  else if ((m = /the heat is set to (\d+)°F/.exec(line))) set = `heat set to ${m[1]}`;
  else if ((m = /the AC is set to (\d+)°F/.exec(line))) set = `AC set to ${m[1]}`;
  return set ? `${inside} inside, ${set}` : `${inside} inside`;
}

/* ── The cat's devices and the vacuum: only what needs attention ── */

const KINDS: [RegExp, string][] = [
  [/^The vacuum/, "the vacuum"],
  [/^The dry food feeder/, "the dry feeder"],
  [/^The wet food feeder/, "the wet feeder"],
  [/^The fountain/, "the fountain"],
  [/^The Litter-Robot/, "the Litter-Robot"],
];

/** What needs attention, from the home's lines: "the fountain says water low", "the vacuum is offline". At most two. */
export function attentionOf(homeLines: string): string[] {
  const out: string[] = [];
  for (const line of homeLines.split("\n")) {
    const kind = KINDS.find(([re]) => re.test(line))?.[1];
    if (!kind) continue;
    if (/ is offline\.$/.test(line)) {
      out.push(`${kind} is offline`);
      continue;
    }
    const alerts = /\(([^)]{2,80})\)\./.exec(line)?.[1];
    if (alerts) out.push(`${kind} says ${alerts}`);
    else if (kind === "the vacuum" && /^The vacuum is error\b/.test(line)) out.push("the vacuum needs a look");
    else if (kind === "the dry feeder" && /, food low/.test(line)) out.push("the dry feeder says food low");
  }
  return out.slice(0, 2);
}

/* ── The lights ── */

/** The room of the plan a spot stands in, or null. */
function roomAt(plan: HavenPlan, x: number, y: number): string | null {
  const room = plan.rooms.find((r) => r.parts.some(([rx, ry, w, h]) => x >= rx && x <= rx + w && y >= ry && y <= ry + h));
  return room?.name.trim() || null;
}

const the = (name: string) => (/^the\b/i.test(name) ? name.toLowerCase() : `the ${name.toLowerCase()}`);

/**
 * The lights' part: "lights all off", "two lights on in the library", "four lights on". The rooms come from the
 * private plan only when every light that is on has a spot in a room there, and at most two rooms. Null when no
 * light answered.
 */
export function lightsBit(view: LightsView | null, plan: HavenPlan | null): string | null {
  if (!view) return null;
  const known = view.lights.filter((l) => l.online && l.on !== null);
  if (!known.length) return null;
  const on = known.filter((l) => l.on === true);
  if (!on.length) return "lights all off";
  const spots = new Map((plan?.lights ?? []).map((s) => [lightKey(s.name), s]));
  const rooms = plan
    ? on.map((l) => {
        const s = spots.get(lightKey(l.name));
        return s ? roomAt(plan, s.x, s.y) : null;
      })
    : [];
  const placed = rooms.length === on.length && rooms.every((r): r is string => !!r);
  const named = placed ? [...new Set(rooms as string[])] : [];
  const where = named.length && named.length <= 2 ? ` in ${named.map(the).join(" and ")}` : "";
  return `${plural(on.length, "light")} on${where}`;
}

/* ── The to-dos ── */

/** The to-dos' part: "no to-dos", "one to-do: call the vet", "three to-dos, first up call the vet". */
export function todosBit(state: TodoState | null, now: number): string | null {
  if (!state) return null;
  const due = (t: { due?: string }) => (t.due ? Date.parse(t.due) : Infinity);
  // The Haven's own order (apps/desk/src/todos/todos.ts openTodos): due ones first, then newest.
  const open = state.todos.filter((t) => isOpen(t, now)).sort((a, b) => due(a) - due(b) || Date.parse(b.at) - Date.parse(a.at));
  if (!open.length) return "no to-dos";
  // Mid-sentence: "Call the vet" is said "call the vet" (an acronym or a name with a second capital stays).
  const first = open[0]!.text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase());
  const sayable = first.length <= TODO_SAID_MAX && !privateParts(first).length && !/[<>{}]/.test(first);
  const head = plural(open.length, "to-do");
  if (!sayable) return head;
  return open.length === 1 ? `${head}: ${first}` : `${head}, first up ${first}`;
}

/* ── Tonight's dinner ── */

/** Today on Nikita's clock: the weekday and the week's Monday as YYYY-MM-DD. */
export function homeDay(now: number): { day: Day; monday: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = get("weekday").toLowerCase().slice(0, 3) as Day;
  const index = DAYS.indexOf(day);
  const date = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")));
  const monday = new Date(date - Math.max(0, index) * 86_400_000).toISOString().slice(0, 10);
  return { day: index < 0 ? "mon" : day, monday };
}

/** Tonight's dinner from the Kitchen's plan: "it's chicken tikka tonight", "eating out tonight". Null with no plan for today. */
export function dinnerBit(file: MealsFile | null, now: number): string | null {
  if (!file) return null;
  const { day, monday } = homeDay(now);
  const slot = allWeeks(file)
    .find((w) => w.start === monday)
    ?.slots.find((s) => s.day === day);
  if (!slot) return null;
  if (dinnerSkipped(slot)) return slot.skip?.dinner === "out" ? "eating out tonight" : slot.skip?.dinner === "leftovers" ? "leftovers tonight" : "no dinner planned tonight";
  if (slot.helloFresh) return "HelloFresh tonight";
  const name = (mealNamed(file, slot.meal)?.name ?? "").replace(/\s+/g, " ").trim();
  return name ? `it's ${name.toLowerCase()} tonight` : null;
}

/* ── The line ── */

export interface HouseParts {
  climate: string | null;
  lights: string | null;
  todos: string | null;
  dinner: string | null;
  attention: string[];
}

/** "a, b, c and d". */
function list(items: string[]): string {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")}${items.length > 2 ? "," : ""} and ${items[items.length - 1]}`;
}

/** The one spoken line (at most two sentences): what's fine first, then what needs him, if anything. */
export function houseLine(p: HouseParts): string {
  const fine = [p.climate, p.lights, p.todos, p.dinner].filter((x): x is string => !!x);
  const needs = p.attention.slice(0, 2);
  if (!fine.length && !needs.length) return NO_HOUSE;
  const lead = needs.length ? "Mostly fine" : "All quiet";
  const first = fine.length ? `${lead}: ${list(fine)}.` : "";
  const heads = needs.length ? `${fine.length ? "One thing: " : "Heads up: "}${list(needs)}.` : "";
  const line = [first, heads].filter(Boolean).join(" ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/* ── The read ── */

/** The Haven's reads, each optional (a copy without a piece's keys or store goes without it). */
export interface HouseSources {
  /** The home's lines (devices/homeread.ts homeNow). */
  home?: () => Promise<string>;
  lights?: () => Promise<LightsView | null>;
  plan?: () => Promise<HavenPlan | null>;
  todos?: () => Promise<TodoState | null>;
  meals?: () => Promise<MealsFile | null>;
}

/** One piece, or null when it's missing, fails or is late. */
async function piece<T>(get: (() => Promise<T>) | undefined, waitMs: number): Promise<T | null> {
  if (!get) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  return Promise.race([get().catch(() => null), late]).finally(() => clearTimeout(timer));
}

/** The house in one line, every piece read at once, each inside `waitMs`. Never throws. */
export async function houseText(s: HouseSources, now: number, waitMs = HOUSE_WAIT_MS): Promise<string> {
  const [home, lights, plan, todos, meals] = await Promise.all([piece(s.home, waitMs), piece(s.lights, waitMs), piece(s.plan, waitMs), piece(s.todos, waitMs), piece(s.meals, waitMs)]);
  return houseLine({
    climate: home ? climateBit(home) : null,
    lights: lightsBit(lights, plan),
    todos: todosBit(todos, now),
    dinner: dinnerBit(meals, now),
    attention: home ? attentionOf(home) : [],
  });
}
