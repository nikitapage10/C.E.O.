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

/** The members' answers to Nikita on the floor, in kind (#910); null when they can't come live. */
export async function fetchFloorReply(said: string, seated: string[], topic: { motion: string; lines: { by: string; text: string }[] } | null, doFetch: typeof fetch = fetch): Promise<{ by: string; text: string }[] | null> {
  try {
    const res = await doFetch("/api/skippy-room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ room: "today", senate: "reply", said: said.slice(0, 300), seated, ...(topic && { motion: topic.motion, lines: topic.lines.slice(-6) }) }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { lines?: unknown };
    const lines = (Array.isArray(body.lines) ? body.lines : [])
      .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
      .map((l) => ({ by: str(l.by, 20), text: str(l.text, 300) }))
      .filter((l) => l.by && l.text)
      .slice(0, 2);
    return lines.length ? lines : null;
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
      const p = (next ??= resolve());
      const d = await p;
      // Nothing to say: asked again next time.
      if (!d && next === p) next = null;
      return d && !taken.has(d.key) ? d : null;
    },
    take(d) {
      taken.add(d.key);
      if (!d.key.startsWith("live-")) o.hear(debateMark(d.key));
      for (const m of d.murmurs ?? []) if (!murmurs.includes(m)) murmurs.push(m);
      // The next one is asked for while this one is said.
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
