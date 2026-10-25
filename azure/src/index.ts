/**
 * C.E.O.'s API as Azure Functions (Node, v4 programming model), beside Vercel (docs/AZURE.md). Every api/*.ts
 * endpoint is registered at the same route it has on Vercel, /api/<name>, and runs the very same handler through
 * the adapter (./adapter.ts). Vercel doesn't read this folder; nothing here changes the live site.
 */

// First: unresolved Key Vault references count as unset before any handler module reads a setting.
import "./env.js";

import { app, type HttpMethod } from "@azure/functions";
import { registerAzureBlob } from "../../api/_blob.js";
import * as daystory from "../../api/day-story.js";
import * as deskauth from "../../api/desk-auth.js";
import * as deskpings from "../../api/desk-pings.js";
import * as email from "../../api/_email/route.js";
import { runEmailTick } from "../../api/_email/live.js";
import * as foundryfeed from "../../api/foundry-feed.js";
import * as foundryimage from "../../api/foundry-image.js";
import * as foundryusage from "../../api/foundry-usage.js";
import * as foundry from "../../api/foundry.js";
import * as exchangemarkets from "../../api/_exchange/route.js";
import * as exchangepositions from "../../api/_exchange/positions.js";
import * as greenleague from "../../api/_green/route.js";
import * as invoices from "../../api/_paypal/route.js";
import * as latticetiming from "../../api/_boot/timing.js";
import * as keys from "../../api/_keys/route.js";
import { registerKeyWriter } from "../../api/_keys/vault.js";
import * as greenanalysis from "../../api/_green/analysis.js";
import * as roomfeed from "../../api/_room/feed.js";
import * as setupasks from "../../api/_room/setup.js";
import * as securityfeed from "../../api/security-feed.js";
import * as sitelogin from "../../api/_site/login.js";
import * as sitepassword from "../../api/_site/control.js";
import * as skippy from "../../api/skippy.js";
import * as skippyvoice from "../../api/skippy-voice.js";
import * as visualqafeed from "../../api/visual-qa-feed.js";
import * as worldstep from "../../api/world-step.js";
import * as world from "../../api/world.js";
import { withGate } from "../../api/_site/gate.js";
import { pickSiteStore } from "../../api/_site/state.js";
import { adapt, type AdaptOptions, type WebHandler } from "./adapter.js";
import { azureBlobFromEnv } from "./blob.js";
import { KeyRefresh } from "./keys.js";
import { keyWriter, readSecret, secretDates, vaultFromEnv } from "./vault.js";
import { tick, TICK_SCHEDULE } from "./tick.js";

// WORLD_STORE=azureblob: the world, stories, Desk sign-ins and pictures in the `ceo-state` container.
registerAzureBlob(azureBlobFromEnv);

// The Key Vault (#330): the Keys form's write-only face, and the refresh that brings keys set from the Desk into this
// instance without a restart (./keys.ts). Both off until the template has set KEY_VAULT_URI.
const vault = vaultFromEnv(process.env);
const keyRefresh = vault ? new KeyRefresh({ dates: () => secretDates(vault), read: (name) => readSecret(vault, name) }, process.env, (line) => console.log(line)) : null;
registerKeyWriter(() => (vault ? keyWriter(vault, (name, value, updated) => keyRefresh?.noteSet(name, value, updated)) : null));
const keysFresh = () => (keyRefresh ? keyRefresh.fresh() : Promise.resolve());

const gateDeps = () => ({ env: process.env, store: pickSiteStore(), now: Date.now() });

type Module = Partial<Record<"GET" | "POST", WebHandler>>;

/** Each endpoint, by its Vercel name (the file name in api/), with how long its waitUntil work may hold the answer. */
export const ENDPOINTS: Array<[name: string, module: Module, opts?: AdaptOptions]> = [
  ["day-story", daystory],
  ["desk-auth", deskauth],
  ["desk-pings", deskpings],
  // The email agent (#263): Gmail, read-only, sorted by Claude. Azure only: its keys live only in this Function App.
  // GET ?view=status is the public counts; the rest needs the Desk's passkey session (api/_email/route.ts).
  ["email", email],
  // Where Google sends the browser back after Connect Gmail (the OAuth client's redirect URI).
  ["gmail-callback", email],
  // The Exchange's Polymarket board (#240): its own endpoint here; on Vercel a rewrite into api/world.ts.
  ["exchange-markets", exchangemarkets],
  // Nikita's Polymarket US positions (#253): Desk session only; the key lives only in this Function App's settings.
  ["exchange-positions", exchangepositions],
  ["foundry-feed", foundryfeed],
  // The Green's Sleeper board (#252): its own endpoint here, where the FANTASYPROS key is set; on Vercel a rewrite into api/world.ts.
  ["green-league", greenleague],
  // The Commentator's call (#276): the Green's weekly analysis, Desk session only. GET the latest, POST { action: "refresh" }.
  ["green-analysis", greenanalysis],
  ["foundry-image", foundryimage],
  // The Spire's invoices (#279, docs/PAYPAL.md): PayPal drafts made from the Desk, sent only on Nikita's confirmed tap.
  // Azure only (the PayPal keys live only here). ?view=status is the public counts; the rest needs the passkey session.
  ["invoices", invoices],
  // The Desk's Keys form (#330): sets an allowlisted key in the Key Vault, behind the passkey and a fresh step-up.
  // Write-only: GET shows names and dates, POST sets one. Azure only (the vault is only here).
  ["keys", keys],
  // The Lattice's boot-timing beacon (#373): timings and counts from the browser, shown in the Boiler Room.
  ["lattice-timing", latticetiming],
  ["foundry-usage", foundryusage],
  ["foundry", foundry],
  // The subminds' room events (#281, docs/SKIPPY.md "Room keys"): POST with the feed key only; GET full for a Desk
  // session or the read key, scrubbed titles for the Lattice. Azure only: both keys live only in this Key Vault.
  ["room-feed", roomfeed],
  ["security-feed", securityfeed],
  // Setup asks (#324, docs/SKIPPY.md "Setup asks"): a thread posts one with the feed key; Nikita approves or declines it
  // in the Desk's passkey session; the thread reads the answer with the read key and closes it with a Trail line.
  ["setup-asks", setupasks],
  ["site-login", sitelogin],
  ["site-password", sitepassword],
  ["skippy", skippy],
  // What Nikita asked Skippy, by room (#273): Desk session only; on Vercel a rewrite into api/skippy.ts.
  ["skippy-log", skippy],
  // A hand-off's answer coming back from Skippy's or a submind's thread (#312): SUBMIND_FEED_TOKEN only.
  ["skippy-answer", skippy],
  // Talk to Skippy (#434): a live voice call on ElevenLabs Agents. Desk session only; mints one-session tokens under
  // the talk's share of ElevenLabs' $10 cap (api/_skippy/voice.ts). The key never leaves this Function App.
  ["skippy-voice", skippyvoice],
  ["visual-qa-feed", visualqafeed],
  // Called on the Function App's own URL (no proxy cut), so the step waits for its day and week stories.
  ["world-step", worldstep, { settleMs: Infinity }],
  ["world", world],
];

for (const [name, mod, opts] of ENDPOINTS) {
  const methods = (["GET", "POST"] as const).filter((m) => typeof mod[m] === "function");
  app.http(name.replace(/-/g, "_"), {
    route: name,
    methods: methods as HttpMethod[],
    authLevel: "anonymous",
    handler: (req, context) => {
      const handler = mod[req.method.toUpperCase() as "GET" | "POST"];
      if (!handler) return Promise.resolve({ status: 405, headers: { Allow: methods.join(", ") } });
      // The site lock (#236, #238): the same gate as Vercel's middleware, in front of every function. The Static Web
      // App's own files aren't behind it (docs/AZURE.md, "The site lock on Azure"). Keys set from the Desk first (#330).
      return keysFresh().then(() => adapt(withGate(handler, gateDeps), opts)(req, context));
    },
  });
}

// The world's steady clock (#271, ./tick.ts): steps the world in-process at :05 and :35 (the Vercel knock is off, #313),
// so the world no longer waits on GitHub's best-effort hourly schedule.
app.timer("world_tick", {
  schedule: TICK_SCHEDULE,
  handler: async (_timer, context) => {
    await keysFresh();
    await tick({ step: () => worldstep.POST(), fetch, env: process.env, log: { log: (m: string) => context.log(m), error: (m: string) => context.error(m) } });
  },
});

// The email agent's minute (#263, docs/GMAIL.md): Gmail's history every minute, Claude only for new inbox mail.
// Logs only what happened, by kind ("checked", "busy", "waiting"…), never anything from a mail.
app.timer("email_tick", {
  schedule: "0 * * * * *",
  runOnStartup: false,
  useMonitor: false,
  handler: async (_timer, context) => {
    await keysFresh();
    const result = await runEmailTick().catch(() => "error" as const);
    if (result === "error") context.warn("email tick: error");
  },
});

// The Commentator's weekly call (#276): Tuesday 5:39pm Mountain, before Wednesday's waivers. Azure's timers run on UTC,
// so this fires at :39 past 23:00 and 00:00 UTC on Tuesdays and Wednesdays and the run itself checks it is Tuesday's 5pm
// hour in Denver (daylight saving or not); it never writes more than once in six hours. Logs only what happened.
app.timer("green_weekly", {
  schedule: "0 39 23,0 * * 2,3",
  runOnStartup: false,
  useMonitor: false,
  handler: async (_timer, context) => {
    await keysFresh();
    const result = await greenanalysis.runGreenWeekly();
    if (result === "failed") context.warn("green weekly: failed");
    else if (result === "written") context.log("green weekly: written");
  },
});
