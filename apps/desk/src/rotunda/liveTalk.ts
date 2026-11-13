import { DEBATES, type Debate, type Stance } from "./debates.ts";

/**
 * The Senate talks live (#910), browser side. Nikita, 2026-11-05: "nothing loops, ever ... always a new topic ... AI
 * based, not a preset script, generated live in real time when the Senate loads", and when he chips in the members
 * answer him in kind.
 *
 * The recess asks the function for a new argument as the chamber opens and again as each one starts, so the next is
 * ready when it's wanted (POST /api/skippy-room `{ room: "today", senate: "debate" }`, api/_skippy/senatetalk.ts: Claude
 * Haiku under the Senate's own $10 inside Skippy's month, a new motion every time). Only public-safe facts go: the seated
 * members, who is at work, how many items wait. When it can't (signed out, past the cap, the model down or a line held
 * back), the chamber takes a written argument this viewer hasn't heard yet (debates.ts), each once ever; with none left
 * it stays quiet and asks again later. Nothing is ever said twice.
 *
 * Each live argument brings a few new gallery murmurs too, said once each.
 */

export interface ChamberFacts {
  /** The seated members, by id. */
  seated: string[];
  /** Those at work now. */
  working: string[];
  /** How many items wait on the docket. */
  docket: number;
}

export interface RecessSource {
  /** The next argument, without taking it; null when there is nothing new to say right now (quiet). */
  peek: () => Promise<Debate | null>;
  /** It is being said now: never offered again, and the next one is asked for. */
  take: (d: Debate) => void;
  /** A new murmur from the live arguments, said once; null when none is waiting. */
  murmur: () => string | null;
  dispose: () => void;
}

export interface RecessOpts {
  facts: () => ChamberFacts;
  /** A written argument's key in this viewer's memory: heard yet? */
  heard: (key: string) => boolean;
  hear: (key: string) => void;
  /** "in", "out" or still checking: signed out, nothing is asked. */
  auth?: () => string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** After the cap, how long before asking again (a new month comes to whoever waits). */
export const CAPPED_WAIT_MS = 15 * 60_000;
/** After any other quiet answer. */
export const QUIET_WAIT_MS = 45_000;

/** A written argument's mark in the viewer's memory (heard.ts). */
export const debateMark = (key: string) => `~debate:${key}`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const STANCES: readonly Stance[] = ["open", "aye", "nay"];

/** The function's argument, as the chamber takes it; null when it isn't well formed. */
export function readLiveDebate(v: unknown): Debate | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const key = str(o.key, 40);
  const motion = str(o.motion, 200);
  const close = str(o.close, 300);
  if (!key || !motion || !close || !Array.isArray(o.lines)) return null;
  const lines = o.lines
    .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
    .map((l) => ({ by: str(l.by, 20), stance: (STANCES as readonly unknown[]).includes(l.stance) ? (l.stance as Stance) : "aye", text: str(l.text, 300) }))
    .filter((l) => l.by && l.text);
  if (lines.length < 2) return null;
  const murmurs = (Array.isArray(o.murmurs) ? o.murmurs : []).map((m) => str(m, 60)).filter(Boolean);
  return { key, motion, lines, close, murmurs };
}

type Answer = { debate: Debate } | { quiet: string } | { gone: true };

/** One ask for a new argument. */
export async function fetchDebate(facts: ChamberFacts, doFetch: typeof fetch = fetch): Promise<Answer> {
  try {
    const res = await doFetch("/api/skippy-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ room: "today", senate: "debate", seated: facts.seated, working: facts.working, docket: facts.docket }),
    });
    if (res.status === 401 || res.status === 403 || res.status === 503) return { gone: true };
    const body = (await res.json().catch(() => ({}))) as { debate?: unknown; quiet?: unknown };
    const d = res.ok ? readLiveDebate(body.debate) : null;
    return d ? { debate: d } : { quiet: typeof body.quiet === "string" ? body.quiet : "model" };
  } catch {
    return { quiet: "model" };
  }
}

/** The argument on the floor, as the chamber hands it to the floor (#910, #925). */
export interface FloorTopic {
  motion: string;
  /** The lines said so far, Nikita's own from the floor as `by: "floor"`. */
  lines: { by: string; text: string }[];
  /** The members arguing it. */
  cast?: string[];
}

/** Nikita's words joined to the argument on the floor (#925). */
export interface Joined {
  /** The members who were speaking answer him first, then perhaps one more. */
  answers: { by: string; text: string }[];
  /** The rest of the argument, from there, with his point in it. */
  rest: { by: string; stance: Stance; text: string }[];
  /** The chair's new ruling. */
  close: string;
}

/** The function's join, as the chamber takes it; null when it isn't well formed. */
export function readJoined(v: unknown): Joined | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const rows = (x: unknown) => (Array.isArray(x) ? x : []).map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}));
  const answers = rows(o.answers)
    .map((l) => ({ by: str(l.by, 20), text: str(l.text, 300) }))
    .filter((l) => l.by && l.text)
    .slice(0, 3);
  const rest = rows(o.rest)
    .map((l) => ({ by: str(l.by, 20), stance: (l.stance === "nay" ? "nay" : "aye") as Stance, text: str(l.text, 300) }))
    .filter((l) => l.by && l.text)
    .slice(0, 4);
  const close = str(o.close, 300);
  return answers.length && close ? { answers, rest, close } : null;
}

/** Skippy's own answer on the floor (#926), said as the chair; `wrote` names the tools that changed something. */
export interface ChairAnswer {
  say: string;
  audio?: string;
  /** Members chiming in underneath with a quip (#1104), shown as text after his answer. */
  quips?: { by: string; text: string }[];
  wrote?: unknown;
  did?: unknown;
}

/** What the floor hears back: Skippy's own answer, his words joined to the argument, or the members' answer in kind. */
export type FloorHeard = { chair: ChairAnswer } | { join: Joined } | { lines: { by: string; text: string }[] };

/**
 * Nikita's words on the floor (#926), one call: Skippy's one brain hears them first, with the argument as context, and
 * judges them itself (no word lists). An ask or a question ("can you dispense one portion of dry food?") is his: the tool
 * runs and his answer comes back as the chair's. A remark on the debate goes on to the members: joined to the argument
 * on the floor (#925, `join`: the members who were speaking answer him, perhaps one more chimes in, and the argument
 * carries on with his point in it), or, with none on, answered in kind (#910). Null when nothing came (signed out, the
 * cap, the privacy check, the model); the chair then answers through Skippy's own route.
 */
export async function fetchFloor(said: string, seated: string[], topic: FloorTopic | null, join: boolean, doFetch: typeof fetch = fetch): Promise<FloorHeard | null> {
  try {
    const res = await doFetch("/api/skippy-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        room: "today",
        senate: join && topic ? "join" : "reply",
        said: said.slice(0, 300),
        // The floor's answers are text (#1104): the chair's comes back unspoken, with a member's quip or two.
        voice: false,
        seated,
        ...(topic && { motion: topic.motion, lines: topic.lines.slice(join ? -8 : -6), ...(join && topic.cast && { cast: topic.cast }) }),
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { lines?: unknown; join?: unknown; skippy?: unknown; audio?: unknown; quips?: unknown; wrote?: unknown; did?: unknown };
    const lines = (Array.isArray(body.lines) ? body.lines : [])
      .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
      .map((l) => ({ by: str(l.by, 20), text: str(l.text, 300) }))
      .filter((l) => l.by && l.text)
      .slice(0, 2);
    if (body.skippy === true) {
      const say = lines[0]?.text ?? "";
      if (!say) return null;
      const audio = typeof body.audio === "string" && /^[A-Za-z0-9+/=]{100,}$/.test(body.audio) ? body.audio : undefined;
      const quips = (Array.isArray(body.quips) ? body.quips : [])
        .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
        .map((l) => ({ by: str(l.by, 20), text: str(l.text, 200) }))
        .filter((l) => l.by && l.by !== "kernel" && l.text)
        .slice(0, 2);
      return { chair: { say, ...(audio && { audio }), ...(quips.length && { quips }), ...(body.wrote !== undefined && { wrote: body.wrote, did: body.did }) } };
    }
    const joined = readJoined(body.join);
    if (joined) return { join: joined };
    return lines.length ? { lines } : null;
  } catch {
    return null;
  }
}

export function createRecess(o: RecessOpts): RecessSource {
  const now = o.now ?? Date.now;
  let next: Promise<Debate | null> | null = null;
  let gone = false;
  let quietUntil = 0;
  let dead = false;
  /** Every argument taken this visit, so none is offered twice even if the memory can't be kept. */
  const taken = new Set<string>();
  const murmurs: string[] = [];
  /** Counts the asks a take starts, so a quiet answer only clears its own. */
  let asked = 0;

  const live = async (): Promise<Debate | null> => {
    if (gone || dead || now() < quietUntil || o.auth?.() === "out") return null;
    const got = await fetchDebate(o.facts(), o.fetch ?? fetch);
    if ("gone" in got) gone = true;
    else if ("quiet" in got) quietUntil = now() + (got.quiet === "capped" ? CAPPED_WAIT_MS : QUIET_WAIT_MS);
    else if (!taken.has(got.debate.key)) return got.debate;
    return null;
  };
  /** A written argument not heard yet, each once ever. */
  const written = (): Debate | null => DEBATES.find((d) => !taken.has(d.key) && !o.heard(debateMark(d.key))) ?? null;
  const resolve = async (): Promise<Debate | null> => (await live()) ?? written();

  const src: RecessSource = {
    async peek() {
      next ??= resolve();
      const gen = asked;
      const d = await next;
      // Nothing to say: asked again next time (unless a take has already asked for the next one).
      if (!d && gen === asked) next = null;
      return d && !taken.has(d.key) ? d : null;
    },
    take(d) {
      taken.add(d.key);
      if (!d.key.startsWith("live-")) o.hear(debateMark(d.key));
      for (const m of d.murmurs ?? []) if (!murmurs.includes(m)) murmurs.push(m);
      // The next one is asked for while this one is said.
      asked++;
      next = dead ? null : resolve();
    },
    murmur: () => murmurs.shift() ?? null,
    dispose() {
      dead = true;
      next = null;
    },
  };
  // Asked for as the chamber opens.
  next = resolve();
  return src;
}
