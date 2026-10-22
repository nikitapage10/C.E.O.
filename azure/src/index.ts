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
import * as securityfeed from "../../api/security-feed.js";
import * as sitelogin from "../../api/_site/login.js";
import * as sitepassword from "../../api/_site/control.js";
import * as skippy from "../../api/skippy.js";
import * as visualqafeed from "../../api/visual-qa-feed.js";
import * as worldstep from "../../api/world-step.js";
import * as world from "../../api/world.js";
import { withGate } from "../../api/_site/gate.js";
import { pickSiteStore } from "../../api/_site/state.js";
import { adapt, type AdaptOptions, type WebHandler } from "./adapter.js";
import { azureBlobFromEnv } from "./blob.js";

// WORLD_STORE=azureblob: the world, stories, Desk sign-ins and pictures in the `ceo-state` container.
registerAzureBlob(azureBlobFromEnv);

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
  ["foundry-image", foundryimage],
  ["foundry-usage", foundryusage],
  ["foundry", foundry],
  ["security-feed", securityfeed],
  ["site-login", sitelogin],
  ["site-password", sitepassword],
  ["skippy", skippy],
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
      // App's own files aren't behind it (docs/AZURE.md, "The site lock on Azure").
      return adapt(withGate(handler, gateDeps), opts)(req, context);
    },
  });
}

// The email agent's minute (#263, docs/GMAIL.md): Gmail's history every minute, Claude only for new inbox mail.
// Logs only what happened, by kind ("checked", "busy", "waiting"…), never anything from a mail.
app.timer("email_tick", {
  schedule: "0 * * * * *",
  runOnStartup: false,
  useMonitor: false,
  handler: async (_timer, context) => {
    const result = await runEmailTick().catch(() => "error" as const);
    if (result === "error") context.warn("email tick: error");
  },
});
