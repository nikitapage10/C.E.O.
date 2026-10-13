import type { DeskRoom } from "./deskData.ts";

/**
 * How C.E.O.'s notable connections work, for the Systems page's "How it connects" section (issue #69): what kind
 * each one is (a REST API, an MCP server, a CLI, a scheduled job…), who calls whom, how it signs in and how often.
 * Only the distinct ones (Nikita, 2026-10-13: "call out the big ones… not the obvious ones"), so nothing like the
 * site loading its own files. Every line is backed by the code or the docs (api/, docs/FOUNDRY.md, docs/WORLD.md,
 * the Relay setup notes); Relay's are planned until the hub exists.
 *
 * The page is public: name env vars at most, never a value (connections.test.ts checks for anything key-like).
 */

export type ConnectionKind = "REST API" | "SDK" | "MCP server" | "CLI" | "Scheduled" | "Webhook" | "Polling" | "Storage" | "WebSocket" | "Agent";

export interface Connection {
  id: string;
  name: string;
  /** The room whose tint it wears: the World clock's connections wear the Boiler Room's. */
  room: DeskRoom;
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
    serves: "Rivet and the world step",
    kinds: ["REST API", "SDK"],
    status: "live",
    how: "Vercel functions call Claude Haiku through Anthropic's SDK (the Messages API over HTTPS) and get JSON back in a fixed shape: Rivet's idea cards and each hour of the Lattice.",
    auth: "A server-side key in Vercel's environment (CLAUDE_API_KEY). It never reaches the browser.",
    when: "Once an hour for the world step, and whenever Rivet shapes an idea. Capped at $10 a month between them.",
  },
  {
    id: "github-api",
    name: "GitHub REST API",
    room: "foundry",
    serves: "The Desk and the Lattice",
    kinds: ["REST API"],
    status: "live",
    how: "Vercel functions read the Foundry's issues, runs, pull requests and commits for the Desk, and add labels and comments when you press a Desk button. The world step reads Foundry titles from it too.",
    auth: "A fine-grained token for this repo, kept in Vercel (FOUNDRY_GITHUB_TOKEN). The buttons also need the Desk passphrase.",
    when: "The Desk asks every 30 seconds, shared through a 5-second edge cache; usage every minute.",
  },
  {
    id: "claude-code",
    name: "Claude Code",
    room: "foundry",
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
    serves: "The world and idea pictures",
    kinds: ["Storage", "SDK"],
    status: "live",
    how: "Vercel functions use the @vercel/blob SDK to keep the world's state and history, and the pictures you add to ideas, in a private store. Saves check an ETag, so two steps can't both land.",
    auth: "Vercel's own OIDC sign-in. No key in the code.",
    when: "Each world step, and each picture you upload.",
  },
  {
    id: "gemini",
    name: "Gemini API",
    room: "foundry",
    serves: "Visual QA",
    kinds: ["REST API", "Scheduled"],
    status: "planned",
    how: "After every push to main, a GitHub Actions run records a few seconds of each Lattice room and uploads the clips to Gemini (gemini-3.8-flash) through the Files API, which answers in JSON with what looks wrong. Blockers open a fix issue. The site never calls it; the Desk reads the run from GitHub.",
    auth: "A key kept as a GitHub Actions secret (GEMINI_API_KEY), used only by that run and never printed. Planned until the secret is set.",
    when: "Once per push to main, at most eight a day, capped at $0.50 a run; a run is usually a few cents.",
  },
  {
    id: "bluebubbles",
    name: "BlueBubbles",
    room: "relay",
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
    serves: "Relay's live events",
    kinds: ["WebSocket"],
    status: "planned",
    how: "The hub on the MacBook will stream Relay's events (new message, sorted, draft ready) to the Lattice and the Desk over a WebSocket.",
    auth: "Listens on the Mac only (or your Tailscale network) and accepts only the Lattice's own origin.",
    when: "Live, as things happen.",
  },
];
