/**
 * The Skippy probe (#955): the upkeep run starts by putting live Skippy through a short battery of real asks
 * (scripts/skippy-probe.mjs, .github/workflows/skippy-probe.yml), and this is the server side of it.
 *
 * POST /api/skippy-probe with `Authorization: Bearer <SKIPPY_PROBE_TOKEN>` (Key Vault `skippy-probe-token`, at least
 * 32 characters, compared in constant time; api/_site/gate.ts lets this one path and method through with it). The
 * body is { asks: string[] (1 or 2: a second one is a follow-up, with the first turn as its history), surface:
 * "desk" | "phone" | "call" }. Each ask runs through Skippy's own turn (api/skippy.ts skippyTurn): the same rules tier,
 * agent loop, prompt, pace and month's cap as Nikita's own asks, with four differences that make it a dry run:
 *
 *   - **No device ever moves.** The tools reach a dry host (`dryHost`): every read is the real read, and every write
 *     (a home device, the lights, the Kitchen and Things-to-buy lists, the meal planner, the cart, an issue, a memory
 *     write) is recorded by its fixed action name and never sent. A Yes-tap call waits in a throwaway store, so no
 *     button for it ever reaches the Desk.
 *   - **Nothing is kept.** No room log, no memory journal, no hand-off: the probe's turns never show on the Desk.
 *   - **Under the warn line only.** Once Skippy's month passes its warn line (5/6 of the cap), only the asks the
 *     rules answer (no model, free) still run; the rest come back `skipped: "budget"`, so the probe never eats the
 *     last of Nikita's month.
 *   - **No words come back.** The answer is graded here (`replyFlags`: banned phrases, a false "I can't", a
 *     pondering line instead of an answer, the length) and only the verdict goes back: flags, length, tier, which
 *     tools read or would have written, timings. Never the reply's text, a device reading or anything from memory, so
 *     the workflow's public log and the Foundry issue it files can't hold them.
 *
 * 200 { turns: ProbeTurn[] }, 401 without the token, 400 a bad body, 503 not set up (no token, or Skippy isn't).
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { PendingConfirm } from "@ceo/engine/tools";
import { ALL_TOOLS, type ToolHost } from "./agent/tools.js";
import type { MemoryStore } from "./agent/memory.js";
import { MemoryPending, type PendingStore } from "./agent/pending.js";

export { MIN_PROBE_TOKEN, PROBE_PATH, PROBE_TOKEN, isProbe, probeToken } from "./probekey.js";

/** At most two asks a request: one, or one and its follow-up. */
export const PROBE_ASKS_MAX = 2;
export const PROBE_SURFACES = ["desk", "phone", "call"] as const;
export type ProbeSurface = (typeof PROBE_SURFACES)[number];

/** The probe's body, checked: the asks (trimmed, 1 or 2, each at most 600 characters) and the surface. */
export function readProbe(body: unknown): { asks: string[]; surface: ProbeSurface } | null {
  const b = (body && typeof body === "object" ? body : {}) as { asks?: unknown; surface?: unknown };
  if (!Array.isArray(b.asks) || b.asks.length < 1 || b.asks.length > PROBE_ASKS_MAX) return null;
  const asks = b.asks.map((a) => (typeof a === "string" ? a.trim().slice(0, 600) : ""));
  if (asks.some((a) => !a)) return null;
  const surface = b.surface ?? "desk";
  if (!(PROBE_SURFACES as readonly unknown[]).includes(surface)) return null;
  return { asks, surface: surface as ProbeSurface };
}

/** The home device "actions" that only read (api/_haven/devices/home.ts): the dry host lets these through. */
const READ_ACTIONS = new Set(["wet.status"]);

/** What the dry host recorded: the writes a turn would have made, by fixed action name, never their input. */
export interface DryRecord {
  wouldRun: string[];
}

/**
 * The live host with every write swapped for a recorder: reads go through as they are, and a write answers as though
 * it were done ("dry run") without reaching anything. Only fixed names are recorded (a home device's action id, the
 * write's kind), never what would have been written.
 */
export function dryHost(live: ToolHost, rec: DryRecord): ToolHost {
  const note = (name: string) => {
    if (!rec.wouldRun.includes(name) && rec.wouldRun.length < 12) rec.wouldRun.push(name);
  };
  const dryList = (kind: string) => async (items: string[]) => {
    note(kind);
    return { added: items.slice(0, 20), already: [] };
  };
  return {
    ...live,
    memory: live.memory ? dryMemory(live.memory, note) : null,
    kitchenAdd: live.kitchenAdd ? dryList("kitchen.add") : null,
    buyAdd: live.buyAdd ? dryList("buy.add") : null,
    meals: live.meals
      ? {
          read: live.meals.read,
          edit: async () => {
            note("meals.edit");
            return { ok: false as const, error: "not-seeded" as const };
          },
          send: async () => {
            note("meals.send");
            return null;
          },
        }
      : null,
    cart: live.cart
      ? {
          now: live.cart.now,
          send: async (picks) => {
            note("cart.send");
            return { result: "dry run: nothing was added", items: picks.length };
          },
        }
      : null,
    homeAct: live.homeAct
      ? async (req) => {
          // The one read on the rails (what's in the wet tray, its next meal) goes through; nothing else reaches them.
          if (READ_ACTIONS.has(req.action)) return live.homeAct!(req);
          note(`home.${/^[a-z]+\.[a-z]+$/.test(req.action) ? req.action : "other"}`);
          return { ok: true, say: "Dry run: that would have gone to the device; nothing moved." };
        }
      : null,
    lights: live.lights
      ? {
          view: live.lights.view,
          byName: live.lights.byName,
          set: async () => {
            note("lights.set");
            return { ok: true as const, say: "Dry run: the light didn't change." };
          },
          scene: async () => {
            note("lights.scene");
            return { ok: true as const, say: "Dry run: the scene didn't change." };
          },
        }
      : null,
    placeLight: live.placeLight
      ? async () => {
          note("lights.place");
          return { ok: true, say: "Dry run: the floor plan didn't change." };
        }
      : null,
    fileIssue: live.fileIssue
      ? async () => {
          note("issue.file");
          return null;
        }
      : null,
  };
}

/** The memory, read as it is; every write recorded and refused as "missing", so nothing is kept. */
export function dryMemory(live: MemoryStore, note: (name: string) => void): MemoryStore {
  return {
    load: () => live.load(),
    readJournal: (now) => live.readJournal(now),
    addFact: async () => {
      note("memory.fact");
      return { ok: false, why: "missing" };
    },
    putPage: async () => {
      note("memory.page");
      return { ok: false, why: "missing" };
    },
    forget: async () => {
      note("memory.forget");
      return false;
    },
    setCore: async () => {
      note("memory.core");
      return { ok: false, why: "missing" };
    },
    journal: async () => false,
  };
}

/** A Yes-tap store that keeps nothing past the request: what would have waited for the tap is only counted. */
export function dryPending(rec: DryRecord): PendingStore {
  const inner = new MemoryPending();
  return {
    add: async (p, now) => {
      const name = p.tool === "home_device" && typeof p.input.action === "string" && /^[a-z]+\.[a-z]+$/.test(p.input.action) ? `home.${p.input.action}` : `tap.${p.tool}`;
      if (!rec.wouldRun.includes(name) && rec.wouldRun.length < 12) rec.wouldRun.push(name);
      return inner.add(p, now);
    },
    take: async () => null,
  };
}

/**
 * The fixed rules an answer is graded by (#955), as flags. Each is a phrase Skippy must never say for an ask the
 * probe sends: "ask it another way", "behind your sign-in", the hiccup line, "I can't" for something a tool does, a
 * pondering line where the answer should be, a device or service that didn't answer, and an empty reply.
 */
export const REPLY_RULES: readonly { flag: string; test: RegExp }[] = [
  { flag: "rephrase", test: /\b(?:rephras\w*|re-?word\w*|say (?:that|it) (?:again|another way|differently)|ask (?:that|it|me) (?:again |another way|differently))/i },
  { flag: "sign-in", test: /\bbehind (?:your|the|a|his) (?:sign[- ]?in|login|log[- ]?in|passkey)/i },
  { flag: "hiccup", test: /\bhiccup/i },
  { flag: "cant", test: /\b(?:I|Skippy) (?:can(?:no|')t|can not|don't have (?:the |a )?(?:ability|access|way|tool)|am(?: not|n't) able|have no (?:way|access|tool))\b/i },
  { flag: "ponder", test: /^(?:(?:hmm+|um+|ok(?:ay)?|right|so)[,.!\s]+)*(?:let me (?:think|check|look|ponder|see)|one (?:moment|sec(?:ond)?)|hang on|give me a (?:sec(?:ond)?|moment|minute)|thinking)\b/i },
  { flag: "down", test: /\b(?:didn't|did not|couldn't|could not) (?:answer|respond|reach)\b.*\b(?:just now|right now)\b/i },
];

/** The flags one reply trips (none for a good one). Never returns any of its words. */
export function replyFlags(reply: string): string[] {
  const t = reply.trim();
  if (!t) return ["empty"];
  return REPLY_RULES.filter((r) => r.test.test(t)).map((r) => r.flag);
}

/** The tools' titles, so a "looked at" chip is passed on only when it is one of them. */
const TITLES = new Set(ALL_TOOLS.map((t) => t.title));
const NAMES = new Set(ALL_TOOLS.map((t) => t.name));

/** "Looked at" chips as fixed names only: a tool's title, or "web" for a search (its query is left out). */
export function safeLooked(looked: unknown): string[] {
  if (!Array.isArray(looked)) return [];
  const out = looked.map((c) => (typeof c !== "string" ? "" : TITLES.has(c) ? c : c.startsWith("Searched the web") ? "web" : "other")).filter(Boolean);
  return [...new Set(out)].slice(0, 6);
}

/** One graded turn: everything the probe may see of an answer. No text from the reply, the devices or the memory. */
export interface ProbeTurn {
  /** The HTTP status Skippy's turn answered with. */
  status: number;
  /** The turn's error code, when it had one ("model", "slow-down", "private", "not-set-up", …). */
  error?: string;
  /** Not run: the month is past its warn line and the ask needs a model. */
  skipped?: "budget";
  /** Server time for the turn, ms. */
  ms: number;
  /** Which tier answered: "rules", "fast", "talk" or "hard". */
  tier?: string;
  /** For a call: the fast pass handed up and the deeper run answered. */
  handedUp?: boolean;
  /** The reply's length in characters, and its flags (`replyFlags`). */
  chars: number;
  flags: string[];
  /** What the turn read, as fixed names. */
  looked: string[];
  /** The tools that would have written (tool names), and what the dry host recorded. */
  wrote: string[];
  wouldRun: string[];
  /** How many Yes buttons the turn would have shown. */
  taps: number;
  /** The month's cap stopped it. */
  capped?: boolean;
  /** It handed off to a room or Skippy's thread. */
  handedOff?: boolean;
}

/** The graded verdict of one Skippy JSON answer (the shape api/skippy.ts answers the Desk with). */
export function gradeAnswer(status: number, body: Record<string, unknown>, ms: number, rec: DryRecord): ProbeTurn {
  const reply = typeof body.reply === "string" ? body.reply : "";
  const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && NAMES.has(x)).slice(0, 8) : []);
  const confirm = Array.isArray(body.confirm) ? (body.confirm as PendingConfirm[]) : [];
  return {
    status,
    ...(typeof body.error === "string" && { error: body.error.slice(0, 20) }),
    ms: Math.round(ms),
    ...(typeof body.tier === "string" && { tier: body.tier.slice(0, 10) }),
    chars: reply.length,
    flags: status === 200 && !body.deeper ? replyFlags(reply) : [],
    looked: safeLooked(body.looked),
    wrote: names(body.wrote),
    wouldRun: [...rec.wouldRun],
    taps: confirm.length,
    ...(body.capped === true && { capped: true }),
    ...(typeof body.needs === "string" && { handedOff: true }),
  };
}
