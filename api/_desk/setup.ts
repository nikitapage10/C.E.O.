/**
 * The setup list on Today (#164): the few things only Nikita can do, and whether each is done yet. Each item ticks
 * itself off once the site can see it:
 *
 *   pings      the Desk's ping keys (#135): DESK_VAPID_PUBLIC_KEY, DESK_VAPID_PRIVATE_KEY and DESK_PINGS_SECRET in
 *              the site's settings (Key Vault references on Azure, #313), and the pings workflow reaching the Desk
 *              with that secret (it reads it from the vault). The workflow's half can't be read from here, so it
 *              counts as set once its scan has reached the Desk with the right secret recently (`scanned` in the
 *              ping state, api/desk-pings.ts). The field names (`vercel`, `actions`) are kept for the Desk.
 *   app        the crew's GitHub App (#138): FOUNDRY_APP_ID and FOUNDRY_APP_PRIVATE_KEY in the site's settings (api/_github.ts).
 *   devices    sign-in on more than one device (#132): at least two passkeys enrolled, so the phone and the PC can
 *              both sign in, and losing one device doesn't lock the Desk.
 *   ruleset    a ruleset on `main` (#60, .github/rulesets/main-now.json): the branch's active rules, from GitHub's
 *              read-only "rules for a branch" endpoint, include blocking deletion and force pushes. The gated
 *              ruleset (main-gated.json) has both too, so either counts.
 *   automerge  "Allow auto-merge" in the repo's settings (docs/DELIVERY.md, Decision 1): the repo's
 *              `allow_auto_merge`. GitHub shows it only to a token with enough access; without it the item is
 *              "unknown" and the Desk says it can't check yet.
 *
 * Only states go out, never a value: no key, no length, no prefix, no hash, no device name, no count. The answer is
 * public (GET /api/foundry?setup), and every field is one of three words.
 */

import { githubIdentity } from "../_github.js";
import type { AuthStore } from "./store.js";

/** done: the site can see it's set up. todo: it can see it isn't. unknown: it can't tell (yet). */
export type SetupState = "done" | "todo" | "unknown";

export const SETUP_ITEMS = ["pings", "app", "devices", "ruleset", "automerge"] as const;
export type SetupItem = (typeof SETUP_ITEMS)[number];

export interface SetupStatus {
  items: Record<SetupItem, SetupState>;
  /** The two halves of the ping keys, so the Desk can tick the one that's done: the site's keys, and the workflow's. */
  pings: { vercel: SetupState; actions: SetupState };
}

type Env = Record<string, string | undefined>;

/** The pings workflow runs hourly; a scan this recent means its secret matches the site's. A missed hour or two is fine. */
export const SCAN_FRESH_MS = 3 * 3_600_000;

/** At least this many enrolled devices: the PC and the phone. */
export const DEVICES_WANTED = 2;

const has = (env: Env, name: string) => Boolean(env[name]?.trim());

/** The ping keys in the site's settings: all three. */
export function pingsVercel(env: Env): SetupState {
  return has(env, "DESK_VAPID_PUBLIC_KEY") && has(env, "DESK_VAPID_PRIVATE_KEY") && has(env, "DESK_PINGS_SECRET") ? "done" : "todo";
}

/**
 * The Actions secret, seen through its effect: a scan with the right secret within SCAN_FRESH_MS. Before the site's
 * half is in, no scan can get through, so there's nothing to see yet.
 */
export function pingsActions(vercel: SetupState, scanned: number | null | undefined, now: number): SetupState {
  if (vercel !== "done") return "unknown";
  if (scanned === undefined) return "unknown";
  return typeof scanned === "number" && now - scanned >= 0 && now - scanned < SCAN_FRESH_MS ? "done" : "todo";
}

/** Two halves to one: done when both are, to do when either is, else unknown. */
export function both(a: SetupState, b: SetupState): SetupState {
  if (a === "done" && b === "done") return "done";
  return a === "todo" || b === "todo" ? "todo" : "unknown";
}

/** The crew's App: its ID and key in the site's settings. */
export const appState = (env: Env): SetupState => (githubIdentity(env) === "app" ? "done" : "todo");

/** Devices: null when sign-in isn't set up at all (nothing can be enrolled yet, so it's still to do). */
export function devicesState(count: number | null | undefined): SetupState {
  if (count === undefined) return "unknown";
  return (count ?? 0) >= DEVICES_WANTED ? "done" : "todo";
}

/** The active rules on `main` (GET /repos/{o}/{r}/rules/branches/main): a list, or anything else when unreadable. */
export function rulesetState(rules: unknown): SetupState {
  if (!Array.isArray(rules)) return "unknown";
  const types = new Set(rules.map((r) => (r && typeof r === "object" ? (r as { type?: unknown }).type : null)));
  return types.has("deletion") && types.has("non_fast_forward") ? "done" : "todo";
}

/** The repo (GET /repos/{o}/{r}): `allow_auto_merge` when GitHub shows it to this token. */
export function autoMergeState(repo: unknown): SetupState {
  const flag = repo && typeof repo === "object" ? (repo as { allow_auto_merge?: unknown }).allow_auto_merge : undefined;
  return typeof flag === "boolean" ? (flag ? "done" : "todo") : "unknown";
}

/** What the list is made from: plain facts, already read. `undefined` means it couldn't be read. */
export interface SetupFacts {
  env: Env;
  /** When the pings workflow last scanned with the right secret; null if never; undefined if unreadable. */
  scanned: number | null | undefined;
  /** How many devices are enrolled; null when sign-in isn't set up; undefined if unreadable. */
  devices: number | null | undefined;
  rules: unknown;
  repo: unknown;
  now: number;
}

export function setupStatus(f: SetupFacts): SetupStatus {
  const vercel = pingsVercel(f.env);
  const actions = pingsActions(vercel, f.scanned, f.now);
  return {
    items: {
      pings: both(vercel, actions),
      app: appState(f.env),
      devices: devicesState(f.devices),
      ruleset: rulesetState(f.rules),
      automerge: autoMergeState(f.repo),
    },
    pings: { vercel, actions },
  };
}

const REPO_API = "https://api.github.com/repos/nikitapage10/C.E.O.";
/** A slow GitHub never holds the Desk up: past this, the item says it can't check. */
const GITHUB_WAIT_MS = 4_000;

export interface SetupDeps {
  env: Env;
  store: AuthStore | null;
  now: number;
  fetch: typeof fetch;
  /** A read-only GitHub token ("" for anonymous reads; the repo is public). */
  token: () => Promise<string>;
}

async function readGithub(deps: SetupDeps, path: string): Promise<unknown> {
  try {
    const token = await deps.token();
    const res = await deps.fetch(`${REPO_API}${path}`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(GITHUB_WAIT_MS),
    });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the facts (the Blob store and two GitHub reads, side by side) and makes the list. Never throws. */
export async function loadSetup(deps: SetupDeps): Promise<SetupStatus> {
  const store = deps.store;
  const signInReady = Boolean(deps.env.FOUNDRY_DESK_KEY && store);
  const [devices, scanned, rules, repo] = await Promise.all([
    signInReady ? store!.passkeys().then((l) => l.length, () => undefined) : Promise.resolve(null),
    store ? store.pings().then((s) => s.scanned ?? null, () => undefined) : Promise.resolve(undefined),
    readGithub(deps, "/rules/branches/main"),
    readGithub(deps, ""),
  ]);
  return setupStatus({ env: deps.env, scanned, devices, rules, repo, now: deps.now });
}
