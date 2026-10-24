/**
 * Rate limits on the Desk's sign-in (#132): failed tries slow down, then lock out for a while.
 *
 * Two kinds of try are counted, each in two buckets. Per address (a keyed hash of it, never the address itself):
 * the first two failures cost nothing, the third makes that address wait 30 seconds, the fourth two minutes, and the
 * fifth locks it out for 15 minutes. Across every address together, so a guesser can't get round it by changing
 * address: enrolment (the only place the Desk key is typed) slows after 5 failures and locks for an hour from the 8th;
 * passkey sign-in slows after 20 and locks for 15 minutes from the 22nd. A bucket forgets after an hour without a
 * failure, and a success clears that address's bucket.
 *
 * The trade-off: a flood of bad tries from many addresses can hold sign-in or enrolment shut for a while. A session
 * already open is never touched by a lockout, enrolment is rare, and a passkey can't be guessed, so the shared
 * buckets only bound the noise. Function memory isn't shared between instances, so the counters live in the private
 * Blob store (api/_desk/store.ts); two tries landing at the same instant may count as one, which only ever errs by a
 * single try.
 *
 * The same record remembers each answered sign-in or enrolment challenge (by hash) until it would have expired, so
 * one passkey answer opens one session, never two.
 */

import { createHash, createHmac } from "node:crypto";
import type { AuthStore } from "./store.js";

export interface Bucket {
  /** Failures in a row, since the bucket last forgot. */
  fails: number;
  /** When the last failure was (ms). */
  last: number;
  /** No try is taken before this (ms). */
  until: number;
}
export type Limits = Record<string, Bucket>;

export interface Rule {
  /** Failures that cost nothing. */
  free: number;
  /** The waits after the next failures, in order (ms). */
  waits: number[];
  /** The lockout after that (ms). */
  lock: number;
}

const MIN = 60_000;
/** A bucket forgets after this long without a failure. */
export const FORGET_MS = 60 * MIN;
/** Kept buckets at most: the oldest go first. */
const MAX_BUCKETS = 300;

export const RULES = {
  /** One address, enrolling or signing in: 30 s, then 2 min, then locked 15 min. */
  address: { free: 2, waits: [30_000, 2 * MIN], lock: 15 * MIN },
  /** Every address together, enrolling (typing the Desk key): 1 min, 5 min, then locked an hour. */
  enrolAll: { free: 5, waits: [MIN, 5 * MIN], lock: 60 * MIN },
  /** Every address together, signing in with a passkey: 1 min, then locked 15 min. */
  signinAll: { free: 20, waits: [MIN], lock: 15 * MIN },
  /**
   * The Keys form (#330, api/_keys/route.ts): not failures but writes. Every key set counts, from any address; six in
   * a row are free, the seventh waits a minute, and after that the form is shut for 15 minutes. It forgets after an
   * hour without a write, like the rest.
   */
  keysAll: { free: 6, waits: [MIN], lock: 15 * MIN },
} satisfies Record<string, Rule>;

export type Attempt = "enrol" | "signin" | "keys";

/** How long this bucket must still wait before a try (ms; 0 when a try is allowed). */
export function waitOf(bucket: Bucket | undefined, now: number): number {
  if (!bucket || now - bucket.last > FORGET_MS) return 0;
  return Math.max(0, bucket.until - now);
}

/** The bucket after one more failure. */
export function failed(bucket: Bucket | undefined, rule: Rule, now: number): Bucket {
  const fails = (bucket && now - bucket.last <= FORGET_MS ? bucket.fails : 0) + 1;
  const over = fails - rule.free;
  const wait = over <= 0 ? 0 : over <= rule.waits.length ? rule.waits[over - 1]! : rule.lock;
  return { fails, last: now, until: now + wait };
}

/** Drops buckets that have forgotten, and the oldest past the cap. */
export function prune(limits: Limits, now: number): Limits {
  const live = Object.entries(limits).filter(([, b]) => b && typeof b.last === "number" && (now - b.last <= FORGET_MS || b.until > now));
  live.sort((a, b) => b[1].last - a[1].last);
  return Object.fromEntries(live.slice(0, MAX_BUCKETS));
}

/** The address a request came from, as Vercel reports it. */
export function addressOf(request: Request): string {
  return request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** The buckets one try touches: its address's (hashed with a key derived from the Desk key) and everyone's. */
export function bucketsFor(attempt: Attempt, address: string, clientKey: Buffer): { mine: string; all: string; mineRule: Rule; allRule: Rule } {
  const tag = createHmac("sha256", clientKey).update(address).digest("hex").slice(0, 20);
  const allRule = attempt === "enrol" ? RULES.enrolAll : attempt === "keys" ? RULES.keysAll : RULES.signinAll;
  return { mine: `${attempt}:a:${tag}`, all: `${attempt}:all`, mineRule: attempt === "keys" ? RULES.keysAll : RULES.address, allRule };
}

/** The counters for one kind of try from one address, read from and written to the store. */
export class Gate {
  private constructor(
    private readonly store: AuthStore,
    private readonly keys: ReturnType<typeof bucketsFor>,
    private limits: Limits,
    private readonly now: number,
  ) {}

  static async open(store: AuthStore, attempt: Attempt, address: string, clientKey: Buffer, now: number): Promise<Gate> {
    return new Gate(store, bucketsFor(attempt, address, clientKey), await store.limits(), now);
  }

  /** How long until a try is taken (ms; 0 when it is). */
  wait(): number {
    return Math.max(waitOf(this.limits[this.keys.mine], this.now), waitOf(this.limits[this.keys.all], this.now));
  }

  /** A failed try: both buckets count it. */
  async fail(): Promise<void> {
    this.limits = prune(
      { ...this.limits, [this.keys.mine]: failed(this.limits[this.keys.mine], this.keys.mineRule, this.now), [this.keys.all]: failed(this.limits[this.keys.all], this.keys.allRule, this.now) },
      this.now,
    );
    await this.store.saveLimits(this.limits);
  }

  /** One write counted (the Keys form, #330): both buckets take it, as they would a failure. */
  count(): Promise<void> {
    return this.fail();
  }

  /** Whether this challenge has already been answered once (a challenge opens one session, never two). */
  spent(challenge: string): boolean {
    return waitOf(this.limits[spentKey(challenge)], this.now) > 0;
  }

  /**
   * Spends a challenge for good, atomically (#330): true for the first caller only, however many race. The counters'
   * record above is read-then-written, so two requests landing together could both see a challenge unspent; this is
   * the store's own create-if-absent write, so only one of them gets true. Call it before acting on the answer.
   */
  claim(challenge: string, expires: number): Promise<boolean> {
    return this.store.claim(claimId(challenge), expires);
  }

  /** A good try: the challenge is spent until it would have expired, and this address starts again. */
  async pass(challenge: string, expires: number): Promise<void> {
    const rest: Limits = { ...this.limits, [spentKey(challenge)]: { fails: 0, last: this.now, until: expires } };
    delete rest[this.keys.mine];
    this.limits = prune(rest, this.now);
    await this.store.saveLimits(this.limits);
  }
}

/** A spent challenge's id in the store's claim files: a hash, never the challenge. */
const claimId = (challenge: string) => createHash("sha256").update(`claim:${challenge}`).digest("hex").slice(0, 32);

/** Where a spent challenge is remembered (by hash), next to the counters, until it expires. */
const spentKey = (challenge: string) => `spent:${createHash("sha256").update(challenge).digest("hex").slice(0, 24)}`;
