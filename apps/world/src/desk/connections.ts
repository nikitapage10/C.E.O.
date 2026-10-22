import type { DeskRoom } from "./deskData.ts";

/**
 * How C.E.O.'s notable connections work: what kind each one is (a REST API, an MCP server, a CLI, a scheduled job…),
 * who calls whom, how it signs in and how often. Only the distinct ones (Nikita, 2026-10-13: "call out the big ones…
 * not the obvious ones"), so nothing like the site loading its own files. Every line is backed by the code or the
 * docs (api/, docs/FOUNDRY.md, docs/WORLD.md, the Relay setup notes); Relay's are planned until the hub exists.
 *
 * Each one is explained where it belongs (issue #99): in the pop-over of the part it serves in its room's system
 * diagram on the Systems page, or in the world clock's for the Boiler Room's hourly step. The two the Foundry and the
 * world clock both lean on (the Claude API, Vercel Blob) show in both.
 *
 * The page is public: name env vars at most, never a value (connections.test.ts checks for anything key-like).
 */

export type ConnectionKind = "REST API" | "SDK" | "MCP server" | "CLI" | "Scheduled" | "Webhook" | "Polling" | "Storage" | "WebSocket" | "Agent";

/** Where a connection is explained: a part of Relay's or the Foundry's diagram, the world clock, or the Exchange's page. */
export type ConnectionPlace = { system: "relay" | "foundry"; part: string } | { system: "world" } | { system: "exchange" };

export interface Connection {
  id: string;
  name: string;
  /** The room it belongs to: the world clock's belong to the Boiler Room. */
  room: DeskRoom;
  /** Where it's explained on the Systems page. */
  at: ConnectionPlace[];
  /** What it serves, in a couple of words. */
  serves: string;
  kinds: ConnectionKind[];
  status: "live" | "planned";
  /** Who calls whom, and what over. */
  how: string;
  /** How it signs in, in plain words. */
  auth: string;
  /** How often it's called. */
  when: string;
}

export const CONNECTIONS: Connection[] = [
  {
    id: "claude-api",
    name: "Claude API",
    room: "boiler",
    at: [{ system: "foundry", part: "shaping" }, { system: "world" }],
    serves: "Rivet, the world step and Skippy's chat",
    kinds: ["REST API", "SDK"],
    status: "live",
    how: "Vercel functions call Claude Haiku through Anthropic's SDK (the Messages API over HTTPS) and get JSON back in a fixed shape: Rivet's idea cards, each hour of the Lattice and Skippy's answers on Today.",
    auth: "A server-side key in Vercel's environment (CLAUDE_API_KEY). It never reaches the browser.",
    when: "Once an hour for the world step, whenever Rivet shapes an idea, and each time you talk to Skippy. Capped at $10 a month between them.",
  },
  {
    id: "gemini-speech",
    name: "Gemini (speech)",
    room: "archive",
    at: [{ system: "world" }],
    serves: "The day's story",
    kinds: ["REST API"],
    status: "live",
    how: "Once a day's recap is filed, a Vercel function sends that day's script, written from the public Chronicle and scrubbed, to Gemini's text to speech (gemini-3.8-flash-tts, the plain, friendly Achird voice at a natural pace, a 30 to 45 second update) over plain HTTPS. The audio is kept in the private Blob store and served from our own site.",
    auth: "A server-side key in Vercel's environment (GEMINI_API_KEY). It never reaches the browser.",
    when: "Once a day after midnight, plus Make it now on the Chronicle (signed in with a passkey). Capped by GEMINI_BUDGET_USD, $5 a month by default.",
  },
  {
    id: "github-api",
    name: "GitHub REST API",
    room: "foundry",
    at: [{ system: "foundry", part: "desk" }],
    serves: "The Desk and the Lattice",
    kinds: ["REST API"],
    status: "live",
    how: "Vercel functions read the Foundry's issues, runs, pull requests and commits for the Desk, and add labels and comments when you press a Desk button. The world step reads Foundry titles from it too.",
    auth: "The crew's GitHub App (ceo-foundry): hour-long tokens for this repo only, minted from its key in Vercel; until it is set up, a fine-grained token (FOUNDRY_GITHUB_TOKEN). The buttons also need Nikita's passkey sign-in on the Desk.",
    when: "The Desk asks every 30 seconds, shared through a 5-second edge cache; usage every minute.",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    room: "foundry",
    at: [{ system: "foundry", part: "builder" }],
    serves: "The Builder's thread",
    kinds: ["Agent", "Scheduled"],
    status: "live",
    how: "The Builder's thread in your C.E.O. project writes the code, with Rivet, Rusty and Rocky as subagents in their own worktrees, and asks you on decision cards.",
    auth: "Your Claude Code plan. No API key, and none of the Claude API's budget.",
    when: "Four hourly routines check the queue every 15 minutes; the morning ideas at 9:00 Mountain; upkeep every six hours.",
  },
  {
    id: "github-builder",
    name: "GitHub, from the Builder",
    room: "foundry",
    at: [{ system: "foundry", part: "issues" }],
    serves: "Issues and pull requests",
    kinds: ["MCP server", "CLI"],
    status: "live",
    how: "Inside Claude Code the Builder uses the GitHub MCP server's tools and the gh CLI to label issues and open pull requests. It reads an issue only through scripts/foundry-issue.sh, which lets just your words through.",
    auth: "The Claude Code session's own GitHub access, not the Desk's token.",
    when: "Whenever the thread is working a job.",
  },
  {
    id: "doorbell",
    name: "The doorbell",
    room: "foundry",
    at: [{ system: "foundry", part: "queue" }],
    serves: "Waking the Builder",
    kinds: ["Polling", "CLI"],
    status: "live",
    how: "scripts/foundry-watch.sh runs in the Builder's thread and asks GitHub for the queue with gh. It ends the moment a new build, revise or fix appears, which gives the thread its turn.",
    auth: "The thread's GitHub access. Reads only, so it costs no plan usage.",
    when: "Every 30 seconds while the thread is up; the 15-minute checks cover the gaps.",
  },
  {
    id: "world-trigger",
    name: "World step trigger",
    room: "boiler",
    at: [{ system: "world" }],
    serves: "The hourly step",
    kinds: ["Scheduled", "Webhook"],
    status: "live",
    how: "A GitHub Actions cron POSTs to /api/world-step on Vercel; the doorbell POSTs too, as a backup for GitHub's late schedule. The Desk reads the same address to draw the world clock.",
    auth: "None needed: a step within 55 minutes of the last one does nothing.",
    when: "At :05 every hour, plus every ten minutes from the doorbell; the Desk reads it every minute.",
  },
  {
    id: "blob",
    name: "Vercel Blob",
    room: "boiler",
    at: [{ system: "foundry", part: "blob" }, { system: "world" }],
    serves: "The world, its stories and idea pictures",
    kinds: ["Storage", "SDK"],
    status: "live",
    how: "Vercel functions use the @vercel/blob SDK to keep the world's state and history, the day's stories (audio and script), and the pictures you add to ideas, in a private store, with the Desk's passkeys and the devices that turned pings on. Saves check an ETag, so two steps can't both land.",
    auth: "Vercel's own OIDC sign-in. No key in the code.",
    when: "Each world step, each day's story, and each picture you upload.",
  },
  {
    id: "skippy-chat",
    name: "Skippy's chat",
    room: "foundry",
    at: [{ system: "foundry", part: "desk" }],
    serves: "Talking to Skippy from Today",
    kinds: ["REST API", "SDK"],
    status: "live",
    how: "Today's Ask Skippy box (typed, or said with the browser's own speech input) posts your message and the last few turns to /api/skippy. The function adds the Desk's live state (titles and counts only), asks Claude Haiku, and sends back a short reply with up to three buttons: file an idea, answer Rivet, open a page or enter the Lattice. Nothing happens until you tap one, and then it goes through the Desk's usual buttons. Spoken replies use the browser's own voice.",
    auth: "Only in your passkey session on the Desk; the Claude key stays in Vercel's environment (CLAUDE_API_KEY). Text that looks private is held back before it is sent.",
    when: "Each message you send, at most 8 a minute and 60 an hour. Its own share of the Claude cap, $1 a month by default (SKIPPY_BUDGET_USD); nothing is stored.",
  },
  {
    id: "desk-pings",
    name: "Pings to your phone",
    room: "foundry",
    at: [{ system: "foundry", part: "desk" }],
    serves: "A ping when the Desk needs your call",
    kinds: ["Webhook", "Scheduled", "REST API"],
    status: "live",
    how: "When a Foundry issue is opened or relabelled, and every hour, a GitHub Actions run asks /api/desk-pings to look. The function reads the open issues itself and, for a new idea waiting for your pick, a question from Rivet, a blocker or the live site not loading, sends one Web Push ping through your phone's push service (Apple's or Google's), encrypted for the phone. It says only how many, never what.",
    auth: "The run sends a shared secret (DESK_PINGS_SECRET); pings are signed with the Desk's VAPID key in Vercel. A phone joins only from a passkey session, and signing out drops it.",
    when: "Within a couple of minutes of something new, once per item, a burst as one ping; never 10pm to 7am Mountain, with one summary at 7am.",
  },
  {
    id: "gemini-visual-qa",
    name: "Gemini API, Visual QA",
    room: "foundry",
    serves: "Visual QA",
    kinds: ["REST API", "Scheduled"],
    status: "live",
    // With the checks: the same push to main runs it, and its blockers come back as fix issues.
    at: [{ system: "foundry", part: "checks" }],
    how: "After every push to main, a GitHub Actions run records a few seconds of each Lattice room and uploads the clips to Gemini (gemini-3.8-flash) through the Files API, which answers in JSON with what looks wrong. Blockers open a fix issue. The site never calls it; the Desk reads the run from GitHub.",
    auth: "A key kept as a GitHub Actions secret (GEMINI_API_KEY), used only by that run and never printed.",
    when: "Once per push to main, at most eight a day, capped at $0.50 a run; a run is usually a few cents.",
  },
  {
    id: "polymarket",
    name: "Polymarket",
    room: "exchange",
    at: [{ system: "exchange" }],
    serves: "The Exchange's odds board and watchlist",
    kinds: ["REST API", "Polling"],
    status: "live",
    how: "A Vercel function (the world feed's, through a rewrite of /api/exchange-markets) reads Polymarket's public Gamma API for the busiest open markets and the pinned ones, and its CLOB API for a day of prices, then sends the Desk only the question, the odds, the day's move, the volume and a link. Read-only: no wallet, no orders.",
    auth: "None: public market data, no key. Pinning a market to the watchlist needs your passkey on the Desk, and the pins are kept in the private Blob store.",
    when: "The Desk asks every minute while the Exchange or Systems is open, through a one-minute edge cache, so Polymarket is read about once a minute at most.",
  },
  {
    id: "polymarket-us",
    name: "Polymarket US",
    room: "exchange",
    at: [{ system: "exchange" }],
    serves: "Your own positions and P&L on the Exchange",
    kinds: ["REST API", "Polling"],
    status: "live",
    how: "An Azure function (exchange-positions; on Vercel the world feed's, through a rewrite) reads your Polymarket US account's positions and recent fills from its Retail API and sends them only to a signed-in Desk. Read-only by code: it signs GET requests to the two portfolio paths and nothing else, so it never places, changes or cancels an order. Deposits, withdrawals and balances are never read.",
    auth: "Your Polymarket US API key (POLYMARKET_US_KEY_ID and POLYMARKET_US_SECRET_KEY), kept in Key Vault and read by the Function App; each request carries an Ed25519 signature. The Desk needs your passkey to see the answer, and the figures are hidden in Hide mode.",
    when: "Every two minutes while the Exchange is open and you're signed in; each warm function reads Polymarket US at most once a minute.",
  },
  {
    id: "bluebubbles",
    name: "BlueBubbles",
    room: "relay",
    at: [{ system: "relay", part: "bluebubbles" }],
    serves: "iMessage and SMS",
    kinds: ["Webhook", "REST API"],
    status: "planned",
    how: "BlueBubbles Server on the MacBook will send the hub a webhook for each new message, and the hub will call its REST API on the same Mac to read threads and send replies you approve.",
    auth: "BlueBubbles' server password, kept on the Mac in the hub's settings file.",
    when: "On every message in, and every reply you send.",
  },
  {
    id: "openai",
    name: "OpenAI API",
    room: "relay",
    at: [{ system: "relay", part: "openai" }],
    serves: "Dialtone and Blasto",
    kinds: ["REST API"],
    status: "planned",
    how: "The hub will call OpenAI for Dialtone's sorting (gpt-5.4-mini, JSON out), Blasto's drafts (gpt-6.1-sol) and speech to text for voice replies.",
    auth: "An OpenAI key kept only on the Mac, never in the repo or on Vercel.",
    when: "Sorting on every message; a draft only for replies you owe.",
  },
  {
    id: "hub-socket",
    name: "Hub to the Lattice",
    room: "relay",
    at: [{ system: "relay", part: "hub" }],
    serves: "Relay's live events",
    kinds: ["WebSocket"],
    status: "planned",
    how: "The hub on the MacBook will stream Relay's events (new message, sorted, draft ready) to the Lattice and the Desk over a WebSocket.",
    auth: "Listens on the Mac only (or your Tailscale network) and accepts only the Lattice's own origin.",
    when: "Live, as things happen.",
  },
];

/** The connections explained at one place on the Systems page: a part of a room's diagram, or the world clock. */
export function connectionsAt(system: ConnectionPlace["system"], part?: string): Connection[] {
  return CONNECTIONS.filter((c) => c.at.some((p) => p.system === system && (!("part" in p) || p.part === part)));
}
