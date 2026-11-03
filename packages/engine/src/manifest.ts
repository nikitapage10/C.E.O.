import { z } from "zod";
import { LINEAGE_IDS, ROOM_IDS } from "@ceo/core";

/**
 * The room manifest (#617, docs/ROOMS.md): what every room under `rooms/<id>/room.ts` declares about itself, so the
 * engine, the tests and lint can hold it to the room contract. Data only: a manifest names things (its path, its keys,
 * its submind, its purpose, its lore hook) and never carries a room's code, lore text or live data.
 *
 * Step 1 of #617 adds the schema and the manifests; nothing imports them yet, so the site is unchanged. Later steps
 * build the nav, the routes, LIVE_ROOMS and the Compliance page from them.
 */

// Zod 4 probes `new Function("")` unless told not to; the site's CSP forbids eval (packages/core/src/zodConfig.ts).
z.config({ jitless: true });

/** How an endpoint lets a caller in, past the site lock every function sits behind (api/_site/gate.ts). */
export const AUTH_MODES = [
  /** Open even when the site is locked (the gate lets it through on its own, e.g. Relay's public counts). */
  "public",
  /** Anyone signed in to the site (the site session cookie): read-only feeds and public counts. */
  "site",
  /** The Desk's passkey session: anything personal, and every button that acts. */
  "passkey",
  /** A machine caller's own key: a room key, a hub token, a pings secret or a live call's tool token. */
  "token",
] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

/** The Lattice room id a submind or a flavour pool belongs to, or "skippy" for the Kernel (Today has no Lattice room). */
export const LORE_POOLS = [...ROOM_IDS, "skippy"] as const;

/** The Kernel's lead: Skippy himself, who runs Today from the Kernel's seat rather than through a submind. */
export const KERNEL_LEAD = "skippy";

const id = z.string().regex(/^[a-z][a-z0-9-]{1,23}$/, "lowercase letters, digits and dashes");
/** A Key Vault-backed app setting (azure/src/env.ts, SECRET_SETTINGS), read through the engine, never process.env. */
const keyName = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, "an app setting's name, in capitals");
/** A threat-model id (docs/THREAT-MODEL.md): a trust boundary (TB1) or a roadmap item (R5). */
const threatId = z.string().regex(/^(TB|R)\d{1,2}$/, "a THREAT-MODEL.md id such as TB1 or R5");

/** A real integration the room's agents use: a service outside C.E.O., by the name the threat model knows it by. */
export const IntegrationSchema = z.strictObject({
  /** The service, e.g. "Polymarket". Short, and the same spelling as THREAT-MODEL.md. */
  name: z.string().min(2).max(40),
  /** What the room's agents do with it, in a few words. */
  use: z.string().min(3).max(120),
});
export type Integration = z.infer<typeof IntegrationSchema>;

/** Why the room exists (Nikita, 2026-11-03, #617): how it moves their AI and agent-integration goals. */
export const PurposeSchema = z.strictObject({
  /** One plain sentence, at most 200 characters. */
  goal: z.string().min(20).max(200),
  /** Its real integrations. Empty only while the room is not live. */
  agents: z.array(IntegrationSchema),
  /** The real count from its feed that says whether it is working, e.g. "open invoices: open, paid, overdue". */
  measure: z.string().min(3).max(120),
});
export type Purpose = z.infer<typeof PurposeSchema>;

/**
 * The room's lore hook. Ids and headings only: the text lives in the lore modules and lore/syntherion.md, and a room
 * reaches it through `@ceo/engine/lore`. Lore stays subtle: at most one flavour line on a room's page (docs/ROOMS.md).
 */
export const RoomLoreSchema = z.strictObject({
  /** Its lead: a submind id from SUBMINDS, or KERNEL_LEAD for Today. */
  submind: id,
  /** The agents who work there (SAMPLE_AGENTS ids), the submind not included. */
  agents: z.array(id),
  /** The Great Houses its agents come from (HOUSES). */
  house: z.array(z.enum(LINEAGE_IDS)),
  /** The heading of its section in lore/syntherion.md, without the hashes. */
  section: z.string().min(3).max(80),
  /** The pool its one flavour line is drawn from: a ROOM_QUIPS room, or "skippy" for SKIPPY_QUIPS. */
  lines: z.enum(LORE_POOLS).optional(),
});
export type RoomLore = z.infer<typeof RoomLoreSchema>;

/** A lazy page loader. Optional at step 1: the Desk still loads its pages itself until step 3. */
const pageLoader = z.custom<() => Promise<unknown>>((v) => typeof v === "function", "a function that imports the page");

export const RoomManifestSchema = z.strictObject({
  id,
  /** What the Desk's bar calls it. */
  name: z.string().min(2).max(24),
  /** Its address on the site. */
  path: z.string().regex(/^\/[a-z-]*$/, "a path such as /green"),
  /** The number key that opens it: 1 to 9, then 0 for the tenth. */
  navKey: z.enum(["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]),
  /** The CSS custom property that colours it, defined in apps/world/src/desk/desk.css (e.g. "--room-green"). */
  accent: z.string().regex(/^--[a-z][a-z-]+$/),
  /** Its lead's id (the same as lore.submind; kept at the top level because the feed and the Council read it). */
  submind: id,
  /** Whether its agents are played by real work, not the demo (LIVE_ROOMS). */
  live: z.boolean(),
  /** Each of its endpoints (an `azure/src/index.ts` ENDPOINTS name) and the ways a caller gets in. */
  auth: z.record(z.string().regex(/^[a-z][a-z-]+$/), z.array(z.enum(AUTH_MODES)).min(1)),
  /** The secret settings only this room reads. Shared ones (Claude, ElevenLabs, the Desk key) are the engine's. */
  keys: z.array(keyName),
  /** Whether any of its endpoints calls the Claude API (so it owes the security evals injection fixtures). */
  usesClaude: z.boolean(),
  /** Its threat-model ids (docs/THREAT-MODEL.md). */
  threat: z.array(threatId),
  /** Its lazy-loaded JS budget, in raw KB, beside the Desk's 1 MB first-load budget. */
  budgetKb: z.number().int().positive().max(1024),
  page: pageLoader.optional(),
  purpose: PurposeSchema,
  lore: RoomLoreSchema,
});
export type RoomManifest = z.infer<typeof RoomManifestSchema>;

/** Declares a room. Parses on load, so a manifest that breaks the schema fails wherever it is first imported. */
export function defineRoom(manifest: RoomManifest): RoomManifest {
  return RoomManifestSchema.parse(manifest);
}

/**
 * Secret settings the engine owns: sign-in, the site lock, pings, the room keys, and the shared model and voice keys.
 * Every name in SECRET_SETTINGS belongs to exactly one room or to this list (the contract test checks it).
 */
export const ENGINE_KEYS: readonly string[] = [
  "FOUNDRY_DESK_KEY",
  "SITE_BYPASS_TOKEN",
  "DESK_VAPID_PUBLIC_KEY",
  "DESK_VAPID_PRIVATE_KEY",
  "DESK_VAPID_SUBJECT",
  "DESK_PINGS_SECRET",
  "SUBMIND_LOG_TOKEN",
  "SUBMIND_FEED_TOKEN",
  "CLAUDE_API_KEY",
  "ELEVENLABS_API_KEY",
];

/**
 * Endpoints the engine owns: sign-in and the lock, the Keys form, pings, the room feed and setup asks, Skippy and the
 * Kernel, and the Lattice's world. Every ENDPOINTS name belongs to exactly one room or to this list.
 */
export const ENGINE_ENDPOINTS: readonly string[] = [
  "desk-auth",
  "site-login",
  "site-password",
  "keys",
  "desk-pings",
  "room-feed",
  "setup-asks",
  "skippy",
  "skippy-log",
  "skippy-answer",
  "skippy-voice",
  "skippy-tools",
  "kernel-brief",
  "kernel-agent",
  "world",
  "world-step",
];
