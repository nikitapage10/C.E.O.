/**
 * C.E.O.'s API as Azure Functions (Node, v4 programming model), beside Vercel (docs/AZURE.md). Every api/*.ts
 * endpoint is registered at the same route it has on Vercel, /api/<name>, and runs the very same handler through
 * the adapter (./adapter.ts). Vercel doesn't read this folder; nothing here changes the live site.
 */

// First: unresolved Key Vault references count as unset before any handler module reads a setting.
import "./env.js";

import { app, type HttpMethod } from "@azure/functions";
import { registerAzureBlob } from "../../api/_blob.js";
import * as annex from "../../api/_annex/route.js";
import { JOBS_SCHEDULE } from "../../api/_annex/jobs.js";
import * as daystory from "../../api/day-story.js";
import * as deskauth from "../../api/desk-auth.js";
import * as deskpings from "../../api/desk-pings.js";
import * as email from "../../api/_email/route.js";
import { runEmailTick } from "../../api/_email/live.js";
import * as foundryfeed from "../../api/foundry-feed.js";
import * as foundryimage from "../../api/foundry-image.js";
import * as foundryshot from "../../api/foundry-shot.js";
import * as foundryusage from "../../api/foundry-usage.js";
import * as foundry from "../../api/foundry.js";
import * as exchangemarkets from "../../api/_exchange/route.js";
import * as exchangepositions from "../../api/_exchange/positions.js";
import * as greenleague from "../../api/_green/route.js";
import * as invoices from "../../api/_paypal/route.js";
import * as latticetiming from "../../api/_boot/timing.js";
import * as talktiming from "../../api/_boot/talkTiming.js";
import * as desktiming from "../../api/_boot/deskTiming.js";
import * as haven from "../../api/_haven/route.js";
import * as havenphotos from "../../api/_haven/photos.js";
import * as homedevices from "../../api/_haven/devices/live.js";
import * as havenlights from "../../api/_haven/lights/live.js";
import * as havengoogle from "../../api/_haven/google/live.js";
import * as havenkroger from "../../api/_haven/kroger/live.js";
import * as havenplan from "../../api/_haven/plan.js";
import * as havenmeals from "../../api/_haven/meals.js";
import * as keys from "../../api/_keys/route.js";
import { registerKeyWriter } from "../../api/_keys/vault.js";
import * as greenanalysis from "../../api/_green/analysis.js";
import * as relay from "../../api/_relay/route.js";
import * as roomfeed from "../../api/_room/feed.js";
import * as setupasks from "../../api/_room/setup.js";
import * as securityfeed from "../../api/security-feed.js";
import * as sitelogin from "../../api/_site/login.js";
import * as sitepassword from "../../api/_site/control.js";
import * as skippy from "../../api/skippy.js";
import * as todaytodos from "../../api/_today/route.js";
import * as skippyvoice from "../../api/skippy-voice.js";
import * as skippyroom from "../../api/_skippy/roomroute.js";
import * as skippytools from "../../api/_skippy/toolroute.js";
import * as kernelroute from "../../api/_skippy/kernelroute.js";
import * as skippyagent from "../../api/_skippy/agent/routes.js";
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

// A hand-off to Skippy that is kept starts the always-on responder (#501, api/_skippy/kernelroute.ts). Off with
// KERNEL_AGENT_ENABLED=off; over its own $10 a month it does nothing and the thread's watcher takes the hand-off.
kernelroute.registerKernelAgent();

// The Key Vault (#330): the Keys form's write-only face, and the refresh that brings keys set from the Desk into this
// instance without a restart (./keys.ts). Both off until the template has set KEY_VAULT_URI.
const vault = vaultFromEnv(process.env);
const keyRefresh = vault ? new KeyRefresh({ dates: () => secretDates(vault), read: (name) => readSecret(vault, name) }, process.env, (line) => console.log(line)) : null;
registerKeyWriter(() => (vault ? keyWriter(vault, (name, value, updated) => keyRefresh?.noteSet(name, value, updated)) : null));
const keysFresh = () => (keyRefresh ? keyRefresh.fresh() : Promise.resolve());

const gateDeps = () => ({ env: process.env, store: pickSiteStore(), now: Date.now() });

type Module = Partial<Record<"GET" | "POST" | "PUT", WebHandler>>;

/** Each endpoint, by its Vercel name (the file name in api/), with how long its waitUntil work may hold the answer. */
export const ENDPOINTS: Array<[name: string, module: Module, opts?: AdaptOptions]> = [
  // The Annex (#618): the pop-ups' statuses and follows, and Election night's results from civicAPI, read on request
  // and shared by every viewer (api/_annex/route.ts). annex-elections GET is public, like the results themselves.
  ["annex", annex],
  ["annex-elections", annex],
  // The Job search (#1000, api/_annex/jobs.ts): a Desk session only; Google Jobs through SerpApi.
  ["annex-jobs", annex],
  // Hey Skippy from the iPhone (#627, docs/HEY-SKIPPY.md): POST with a phone key (hashed in the private store, paced
  // 30 an hour), and GET a signed, single-use link to the spoken answer. The Desk's Phones panel and Kitchen list read
  // and write through /api/haven (passkey session; ?view=status is counts only); /api/hey-skippy is the greeting clips.
  ["capture", haven.captureRoute, { settleMs: 2_500 }],
  ["haven", haven.havenRoute],
  ["hey-skippy", haven.greetRoute],
  // The Kitchen's meal photo library (#687, docs/HOME-DEVICES.md): photos in the private `haven-meals` container, served
  // and made only for a passkey session (confirm-week queues the customized meals' photos, made after the answer on
  // OpenAI under the $10 a month images cap); the feed key may PUT one upload, answered with counts only.
  ["haven-photos", havenphotos.photosRoute, { settleMs: 2_500 }],
  // Nikita's home devices (#632, docs/HOME-DEVICES.md): the Roborock vacuum, the Petlibro feeders and fountain and the
  // Litter-Robot, read and run from here with their logins in this Key Vault (or sealed in the private store). A
  // passkey session or a phone key; ?view=status is the public counts and states; connect is Connect Roborock, Desk only.
  ["haven/devices", homedevices.devicesRoute],
  ["haven/devices/action", homedevices.actionRoute, { settleMs: 2_500 }],
  ["haven/devices/connect", homedevices.connectRoute],
  // The vacuum's live run on the Hall's map (#814): the home's floor plan, passkey session only, never stored.
  ["haven/devices/map", homedevices.mapRoute],
  // The Haven's lights (#931): SwitchBot and Govee's cloud APIs, read and switched with their keys from this Key Vault.
  // A passkey session only, for the list and every switch.
  ["haven/lights", havenlights.lightsRoute, { settleMs: 2_500 }],
  // The Haven's connections (#637, docs/HOME-DEVICES.md): Connect Nest and Connect Google Tasks (passkey session
  // only; ?view=status is the public states), and where Google sends the browser back. The thermostat itself reads and
  // acts through haven/devices.
  ["haven/google", havengoogle.googleRoute],
  ["haven/google-callback", havengoogle.googleCallbackRoute],
  // Send to King Soopers (#664, docs/HOME-DEVICES.md): the Kitchen list matched at the home store through Kroger's
  // public API and the confirmed picks added to the cart (passkey session only; ?view=status is the public state and a
  // count), and where Kroger sends the browser back after Connect King Soopers. Checkout stays in the King Soopers app.
  ["haven/kroger", havenkroger.krogerRoute],
  ["haven/kroger-callback", havenkroger.krogerCallbackRoute],
  // The Haven's floor plan (#616): the home's shape for the Desk's 3D house, kept only in the private store and served
  // only to a passkey session (api/_haven/plan.ts). Signed out, the Haven shows counts and states, never a map.
  ["haven-plan", havenplan.planRoute],
  // The Kitchen's meal planner (#678): profile, catalog and week, read and changed only by a passkey session;
  // the feed key may PUT a seed (api/_haven/meals.ts). Signed out, /api/haven?view=status has its counts. Finalize
  // queues the week's cook-step pictures (#1016) and makes them after the answer, so it answers within 2.5 s.
  ["haven-meals", havenmeals.mealsRoute, { settleMs: 2_500 }],
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
  // Screenshots Skippy took of the page for a Foundry issue (#1027, api/_skippy/shots.ts): POST from a passkey session
  // when he asks to look at the screen; GET for a passkey session or the Builder read key. Private store only.
  ["foundry-shot", foundryshot],
  // The Spire's invoices (#279, docs/PAYPAL.md): PayPal drafts made from the Desk, sent only on Nikita's confirmed tap.
  // Azure only (the PayPal keys live only here). ?view=status is the public counts; the rest needs the passkey session.
  ["invoices", invoices],
  // The Desk's Keys form (#330): sets an allowlisted key in the Key Vault, behind the passkey and a fresh step-up.
  // Write-only: GET shows names and dates, POST sets one. Azure only (the vault is only here).
  ["keys", keys],
  // The Lattice's boot-timing beacon (#373): timings and counts from the browser, shown in the Boiler Room.
  ["lattice-timing", latticetiming],
  // The Talk calls' start timings (#512): stage names and milliseconds from the browser, shown in the Boiler Room.
  ["talk-timing", talktiming],
  // The Desk's load timings (#561): first paint and live data ready, in milliseconds, shown in the Boiler Room.
  ["desk-timing", desktiming],
  ["foundry-usage", foundryusage],
  ["foundry", foundry],
  // The subminds' room events (#281, docs/SKIPPY.md "Room keys"): POST with the feed key only; GET full for a Desk
  // session or the read key, scrubbed titles for the Lattice. Azure only: both keys live only in this Key Vault.
  // Relay's texts line (#535, docs/RELAY-PRIVACY.md): relay ?view=status is the public counts; the rest of relay is
  // the Desk's Texts panel (passkey session: the sealed list, send requests with the device's unlock). relay-pair is
  // the installer's one-time code trade. relay-hub is the Mac hub's own calls on its paired token: its counts, its
  // sealed list, its model snippets (Claude with this Key Vault's key), its poll for requests, and the wipe's unpair.
  // The hub only calls out; nothing here calls the Mac.
  ["relay", relay],
  ["relay-pair", relay],
  ["relay-hub", relay],
  ["room-feed", roomfeed],
  ["security-feed", securityfeed],
  // Setup asks (#324, docs/SKIPPY.md "Setup asks"): a thread posts one with the feed key; Nikita approves or declines it
  // in the Desk's passkey session; the thread reads the answer with the read key and closes it with a Trail line.
  ["setup-asks", setupasks],
  ["site-login", sitelogin],
  ["site-password", sitepassword],
  // A new hand-off to Skippy starts the always-on responder (#501) through a request the chat doesn't wait for, so
  // its answer is held for a moment at most.
  ["skippy", skippy, { settleMs: 2_500 }],
  // What Nikita asked Skippy, by room (#273): Desk session only; on Vercel a rewrite into api/skippy.ts.
  ["skippy-log", skippy],
  // A hand-off's answer coming back from Skippy's or a submind's thread (#312): SUBMIND_FEED_TOKEN only.
  ["skippy-answer", skippy],
  // The upkeep run's Skippy probe (#955, api/_skippy/probe.ts): SKIPPY_PROBE_TOKEN only, a dry run (no device moves,
  // nothing kept), answering with verdicts only.
  ["skippy-probe", skippy],
  // The mic on each Desk room's page (#638): Nikita's words to the room's submind, the answer in Skippy's voice.
  // Passkey session only; the chat's own pace and caps, and ElevenLabs' one cap (api/_skippy/roomroute.ts).
  ["skippy-room", skippyroom.route, { settleMs: 2_500 }],
  // Talk to Skippy (#434): a live voice call on ElevenLabs Agents. Desk session only; mints one-session tokens under
  // the talk's share of ElevenLabs' $10 cap (api/_skippy/voice.ts). The key never leaves this Function App.
  ["skippy-voice", skippyvoice],
  // A Talk call's live lookups (#479): ElevenLabs calls them mid-call with the call's own tool token only (signed,
  // unexpired, kept with the call; api/_skippy/voicetoken.ts). Azure only; money leaves only to that call.
  ["skippy-tools", skippytools, { settleMs: 2_500 }],
  // Desk Skippy's agent (#646, api/_skippy/agent): Nikita's Yes tap on a tool call that waits for it (and a room's voice
  // hook running one of the rooms' tools), his private memory of Nikita, and the month's spend meter. Passkey session only.
  ["skippy-act", skippyagent.actRoute],
  ["skippy-memory", skippyagent.memoryRoute],
  ["skippy-spend", skippyagent.spendRoute],
  // The always-on Kernel responder (#501, docs/AZURE.md, "The Kernel responder"): the private brief it reads, and the
  // run itself, called by the Function App on its own address when a hand-off is kept. SUBMIND_FEED_TOKEN only.
  ["kernel-brief", kernelroute.brief],
  ["kernel-agent", kernelroute.agent],
  // Today's own to-dos and talk-back (#622): ?view=status is three public counts; the rest is the passkey session.
  ["today-todos", todaytodos],
  ["visual-qa-feed", visualqafeed],
  // Called on the Function App's own URL (no proxy cut), so the step waits for its day and week stories.
  ["world-step", worldstep, { settleMs: Infinity }],
  ["world", world],
];

for (const [name, mod, opts] of ENDPOINTS) {
  const methods = (["GET", "POST", "PUT"] as const).filter((m) => typeof mod[m] === "function");
  app.http(name.replace(/[-/]/g, "_"), {
    route: name,
    methods: methods as HttpMethod[],
    authLevel: "anonymous",
    handler: (req, context) => {
      const handler = mod[req.method.toUpperCase() as "GET" | "POST" | "PUT"];
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

// Google Tasks quick-add (#637, docs/HOME-DEVICES.md): every five minutes, the chosen Tasks list's open items onto
// the Kitchen list, then marked completed in Tasks. Does nothing until Connect Google Tasks; logs counts only.
// The same beat closes the wet food tray two hours after an opening from here (#713): one private-store read when
// nothing is due, and the close times are rounded to this beat so the time the Desk shows is the time it shuts.
app.timer("haven_tasks", {
  schedule: "0 */5 * * * *",
  runOnStartup: false,
  useMonitor: false,
  handler: async (_timer, context) => {
    await keysFresh();
    const closed = await homedevices.runWetClose().catch(() => "failed");
    if (closed === "closed") context.log("haven wet tray: closed");
    else if (closed === "failed" || closed === "retry") context.warn(`haven wet tray: ${closed}`);
    const result = await havengoogle.runTasksTick().catch(() => "failed" as const);
    if (result === "failed" || result === "refused") context.warn(`haven tasks: ${result}`);
  },
});

// The meal photo library's generator (#687), named apart from the haven-photos route (a shared name stops the host
// registering any function): every ten minutes, a run when a photo waits (a confirm's own run may have
// been cut short). One blob read when nothing waits; one run at a time under the catalog's lease; logs counts only.
app.timer("haven_photos_tick", {
  schedule: "0 */10 * * * *",
  runOnStartup: false,
  useMonitor: false,
  handler: async (_timer, context) => {
    await keysFresh();
    const result = await havenphotos.drainPhotos().catch(() => "failed" as const);
    if (result === "failed") context.warn("haven photos: failed");
  },
});

// The cook steps' pictures backfill (#1026, api/_haven/meals.ts `backfillStepPhotos`): hourly at :05, a finalized week's
// step pictures that were never queued (a week finalized before #1016) go into the photo library, then a run makes
// them under the steps' own $3 cap. Never finalize again, never on a cook mode read; a no-op once they are all there.
app.timer("haven_step_backfill", {
  schedule: "0 5 * * * *",
  runOnStartup: false,
  useMonitor: false,
  handler: async (_timer, context) => {
    await keysFresh();
    const queued = await havenmeals.runStepBackfill().catch(() => "failed" as const);
    if (queued === "failed") context.warn("haven step backfill: failed");
    else if (typeof queued === "number" && queued > 0) context.log(`haven step backfill: ${queued} step pictures queued`);
  },
});

// The Annex's Job search (#1000, api/_annex/jobs.ts): once a day at 13:00 UTC, the saved searches on SerpApi, inside
// the month's search budget (JOBS_MONTHLY_SEARCHES). Nothing while it is shelved or SERPAPI_KEY isn't set. Counts only.
app.timer("annex_jobs_daily", {
  schedule: JOBS_SCHEDULE,
  runOnStartup: false,
  useMonitor: false,
  handler: async (_timer, context) => {
    await keysFresh();
    const result = await annex.runJobsDaily().catch(() => "failed");
    if (result === "failed") context.warn("annex jobs: failed");
    else context.log(`annex jobs: ${result}`);
  },
});

// The Commentator's weekly call (#276): Tuesday 5:39pm Mountain, before Wednesday's waivers. Azure's timers run on UTC,
// so this fires at :39 past 23:00 and 00:00 UTC on Tuesdays and Wednesdays and the run itself checks it is Tuesday's 5pm
// hour in Denver (daylight saving or not); it never writes more than once a week (#261), and writes nothing while no
// league data is connected. Logs only what happened.
app.timer("green_weekly", {
  schedule: "0 39 23,0 * * 2,3",
  runOnStartup: false,
  useMonitor: false,
  handler: async (_timer, context) => {
    await keysFresh();
    const result = await greenanalysis.runGreenWeekly();
    if (result === "failed") context.warn("green weekly: failed");
    else if (result === "written") context.log("green weekly: written");
    else if (result === "waiting") context.log("green weekly: waiting for league data");
  },
});
