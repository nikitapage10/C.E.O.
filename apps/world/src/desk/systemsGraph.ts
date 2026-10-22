import type { WorldFeed } from "../chronicle.ts";
import type { LinkState } from "../systems.ts";
import { CONNECTIONS } from "./connections.ts";
import type { GraphEdge, GraphNode } from "./foundryGraph.ts";

/**
 * The whole system as threads, for the Weave's Systems page (desk-concepts round five, 85-graph.js): every part and
 * connection C.E.O. runs on, coloured by the room that owns it, and each room's full flow one click away. The parts and
 * the way they connect are the ones connections.ts and foundryGraph.ts describe; every state is read live (GitHub, the
 * Foundry function, the world clock, the world's ledger and the hub), so a thread is dashed until it really runs. Pure,
 * so it can be tested; SystemsGraph.tsx draws it.
 */

export type GState = "ok" | "run" | "wait" | "bad";
export type GKind = "person" | "service" | "agent" | "store" | "room";
export type FlowId = "foundry" | "boiler" | "archive" | "relay";

export interface GNode {
  id: string;
  l: string;
  s: string;
  k: GKind;
  room?: string;
  pf?: string;
  state: GState;
}

export interface GEdge {
  a: string;
  b: string;
  room: string;
  state: GState;
  label?: string;
  kinds?: string[];
  how?: string;
  auth?: string;
  when?: string;
}

export interface Flow {
  id: FlowId;
  t: string;
  sub: string;
  room: string;
  p: string;
  st: string;
  stc: GState;
  edges: GEdge[];
}

export interface SystemsInput {
  links: Record<string, LinkState>;
  /** The Foundry's graph (foundryGraph.ts): its parts' live states and the edges between them. */
  foundry: { nodes: GraphNode[]; edges: GraphEdge[] };
  connected: boolean;
  /** Who is building right now, if anyone. */
  building: string | null;
  clock: { state: LinkState; headline: string };
  world: WorldFeed | null;
  /** Whether pings to the phone are set up (both halves). */
  pings: boolean;
  /** The latest Visual QA run: ok, failed, or none yet. */
  vqa: LinkState;
}

export const G_STATE: Record<LinkState, GState> = { ok: "ok", slow: "run", off: "wait", down: "bad" };

const KEY = "A server-side key in Vercel's environment. It never reaches the browser.";
const VBLOB = "Vercel's own sign-in. No key in the code.";

const conn = (id: string) => CONNECTIONS.find((c) => c.id === id);
const fromConn = (id: string): Pick<GEdge, "kinds" | "auth" | "when"> => {
  const c = conn(id);
  return c ? { kinds: [...c.kinds], auth: c.auth, when: c.when } : {};
};

/** Where each Foundry edge's sign-in and timing come from: its connection, or plain words for the rest. */
const FOUNDRY_EDGE: Record<string, Pick<GEdge, "kinds" | "auth" | "when">> = {
  "nikita-desk": { kinds: [], auth: "Your passkey on the Desk.", when: "Whenever you like." },
  "desk-shaping": { kinds: ["REST API"], auth: "Your passkey session, short and signed.", when: "Each idea, answer or pick." },
  "shaping-issues": { kinds: ["SDK", "REST API"], auth: conn("github-api")?.auth ?? KEY, when: conn("claude-api")?.when ?? "Whenever an idea comes in." },
  "issues-queue": fromConn("doorbell"),
  "queue-builder": fromConn("claude-code"),
  "builder-rivet": { kinds: ["Agent"], auth: "Runs inside the Builder's thread, in its own worktree.", when: "When a small fix is waiting." },
  "builder-rusty": { kinds: ["Agent"], auth: "Runs inside the Builder's thread, in its own worktree.", when: "Up to four jobs at once." },
  "builder-rocky": { kinds: ["Agent"], auth: "Runs inside the Builder's thread, in its own worktree.", when: "When something big is approved." },
  "rivet-checks": fromConn("github-builder"),
  "rusty-checks": fromConn("github-builder"),
  "rocky-checks": fromConn("github-builder"),
  "checks-main": { kinds: [], auth: "GitHub's own merge, with the gated ruleset.", when: "When the checks pass." },
  "main-deploy": { kinds: ["Webhook"], auth: "Vercel's link to the repo.", when: "Each merge." },
  "desk-blob": fromConn("blob"),
  "checks-vqa": fromConn("gemini-visual-qa"),
  "desk-pings": fromConn("desk-pings"),
};

/** The Foundry graph's ids, as the Weave's layout names them. */
const FOUNDRY_ID: Record<string, string> = { nikita: "you", blob: "pictures" };
const fid = (id: string) => FOUNDRY_ID[id] ?? id;

export function systemsModel(input: SystemsInput): { nodes: Record<string, GNode>; over: GEdge[]; flows: Record<FlowId, Flow> } {
  const { links, foundry, connected, building, clock, world, pings, vqa } = input;
  const L = (id: string): GState => G_STATE[links[id] ?? "off"];
  const hub = L("hub");
  const relayLive = hub !== "wait";
  const story = world?.story ?? null;
  const fnode = (id: string) => foundry.nodes.find((n) => n.id === id);
  const fstate = (id: string): GState => {
    const n = fnode(id);
    if (!n) return "wait";
    const s = G_STATE[n.state];
    return s === "ok" && n.load > 0 ? "run" : s;
  };
  const foundryRoom: GState = !connected ? "wait" : building ? "run" : L("checks") === "bad" ? "bad" : "ok";

  const nodes: Record<string, GNode> = {
    you: { id: "you", l: "Nikita", s: "you", k: "person", state: "ok" },
    desk: { id: "desk", l: "Desk", s: "this page", k: "service", state: "ok" },
    phone: { id: "phone", l: "Your phone", s: "Web Push pings", k: "service", state: pings ? "ok" : "wait" },
    mac: { id: "mac", l: "MacBook", s: L("mac") === "wait" ? "not connected" : L("mac") === "ok" ? "awake" : "asleep", k: "store", state: L("mac") },
    foundry: { id: "foundry", l: "Foundry", s: building ? `${building} is building` : "the coding crew", k: "room", room: "foundry", state: foundryRoom },
    boiler: { id: "boiler", l: "Boiler Room", s: "the world clock", k: "room", room: "boiler", state: G_STATE[clock.state] },
    archive: { id: "archive", l: "Archive", s: "the day's story", k: "room", room: "archive", state: story ? (story.gemini ? "ok" : "wait") : "wait" },
    relay: { id: "relay", l: "Relay", s: relayLive ? "the hub is up" : "waiting on the Mac", k: "room", room: "relay", state: relayLive ? hub : "wait" },
    github: { id: "github", l: "GitHub", s: "issues, checks, Actions", k: "service", state: connected ? "ok" : "wait" },
    claudecode: { id: "claudecode", l: "Claude Code", s: "the Builder's thread", k: "agent", state: building ? "run" : connected ? "ok" : "wait" },
    claude: { id: "claude", l: "Claude API", s: "Haiku", k: "service", state: world?.claude || fnode("shaping")?.state === "ok" ? "ok" : "wait" },
    gemini: { id: "gemini", l: "Gemini", s: "speech, Visual QA", k: "service", state: story?.gemini || vqa === "ok" ? "ok" : "wait" },
    vercel: { id: "vercel", l: "Vercel", s: "site and functions", k: "service", state: "ok" },
    blob: { id: "blob", l: "Vercel Blob", s: "private store", k: "store", state: world || fnode("blob")?.state === "ok" ? "ok" : "wait" },
    lattice: { id: "lattice", l: "The Lattice", s: "public", k: "service", state: "ok" },
    bluebubbles: { id: "bluebubbles", l: "BlueBubbles", s: "iMessage and SMS", k: "service", state: L("bluebubbles") },
    openai: { id: "openai", l: "OpenAI", s: "sorting, drafts", k: "service", state: L("openai") },
    cron: { id: "cron", l: "GitHub Actions", s: "at :05 hourly", k: "service", state: "ok" },
    doorbell: { id: "doorbell", l: "The doorbell", s: "every 10 min", k: "service", state: connected ? "ok" : "wait" },
    step: { id: "step", l: "World step", s: "/api/world-step", k: "service", state: G_STATE[clock.state] },
    worldstate: { id: "worldstate", l: "World state", s: "Vercel Blob", k: "store", state: world ? "ok" : "wait" },
    clock: { id: "clock", l: "World clock", s: clock.headline.toLowerCase(), k: "service", state: G_STATE[clock.state] },
    midnight: { id: "midnight", l: "Midnight", s: "just after 12", k: "service", state: "ok" },
    history: { id: "history", l: "World history", s: "the public Chronicle", k: "store", state: world ? "ok" : "wait" },
    script: { id: "script", l: "Story script", s: "scrubbed", k: "service", state: story ? "ok" : "wait" },
    speech: { id: "speech", l: "Gemini speech", s: story?.gemini ? "a friendly voice" : "no key yet", k: "service", state: story?.gemini ? "ok" : "wait" },
    audio: { id: "audio", l: "Audio", s: "Vercel Blob", k: "store", state: story?.stories ? "ok" : "wait" },
    chron: { id: "chron", l: "Chronicle", s: "on the Desk", k: "service", state: "ok" },
    hub: { id: "hub", l: "Hub", s: "on the MacBook", k: "service", state: hub },
    messages: { id: "messages", l: "Messages", s: "on the Mac", k: "service", state: L("messages") },
    dialtone: { id: "dialtone", l: "Dialtone", s: "who you owe", k: "agent", pf: "dialtone", state: L("dialtone") },
    blasto: { id: "blasto", l: "Blasto", s: "drafts replies", k: "agent", pf: "postmaster", state: L("postmaster") },
    vqa: { id: "vqa", l: "Visual QA", s: "Gemini", k: "service", state: G_STATE[vqa] },
    pings: { id: "pings", l: "Pings", s: "to your phone", k: "service", state: pings ? "ok" : "wait" },
    // The Exchange's first real connection (#240): Polymarket's public odds, read-only.
    exchange: { id: "exchange", l: "Exchange", s: L("polymarket") === "wait" ? "odds not connected" : "Polymarket odds", k: "room", room: "exchange", state: L("polymarket") === "wait" ? "wait" : L("polymarket") },
    polymarket: { id: "polymarket", l: "Polymarket", s: "public odds", k: "service", state: L("polymarket") },
    // The Green's real connections (#252): Sleeper's public league data, and FantasyPros where its key is set.
    green: { id: "green", l: "Green", s: L("sleeper") === "wait" ? "Sleeper not read yet" : "your Sleeper league", k: "room", room: "green", state: L("sleeper") },
    sleeper: { id: "sleeper", l: "Sleeper", s: "league, read-only", k: "service", state: L("sleeper") },
    fantasypros: { id: "fantasypros", l: "FantasyPros", s: L("fantasypros") === "wait" ? "key on Azure only" : "projections", k: "service", state: L("fantasypros") },
  };
  // The Foundry's own parts, with their live readings.
  for (const n of foundry.nodes) {
    const id = fid(n.id);
    const pf = n.id === "builder" ? "ember" : n.id === "rivet" ? "semicolon" : n.id === "rusty" ? "tessellate" : n.id === "rocky" ? "caret" : undefined;
    nodes[id] = { id, l: n.id === "nikita" ? "Nikita" : n.label, s: n.id === "nikita" ? "you" : n.id === "desk" ? "this page" : n.status || n.sub, k: n.kind, room: pf ? (n.id === "rivet" ? "exchange" : n.id === "rocky" ? "archive" : "foundry") : undefined, pf, state: fstate(n.id) };
  }

  const e = (a: string, b: string, room: string, state: GState): GEdge => ({ a, b, room, state: nodes[a]?.state === "wait" || nodes[b]?.state === "wait" ? (state === "ok" ? "wait" : state) : state });
  const over: GEdge[] = [
    e("you", "desk", "foundry", "ok"),
    e("desk", "foundry", "foundry", "ok"),
    e("foundry", "github", "foundry", nodes.github!.state),
    e("foundry", "claudecode", "foundry", nodes.claudecode!.state),
    e("foundry", "claude", "foundry", nodes.claude!.state),
    e("foundry", "blob", "foundry", nodes.blob!.state),
    e("foundry", "gemini", "foundry", G_STATE[vqa] === "wait" ? "wait" : "ok"),
    e("foundry", "vercel", "foundry", "ok"),
    e("foundry", "phone", "foundry", nodes.phone!.state),
    e("github", "boiler", "boiler", nodes.boiler!.state),
    e("boiler", "claude", "boiler", nodes.boiler!.state === "wait" ? "wait" : world?.claude ? "ok" : "wait"),
    e("boiler", "blob", "boiler", nodes.worldstate!.state),
    e("boiler", "lattice", "boiler", nodes.worldstate!.state),
    e("boiler", "desk", "boiler", nodes.boiler!.state),
    e("blob", "archive", "archive", nodes.archive!.state),
    e("archive", "gemini", "archive", nodes.speech!.state),
    e("archive", "desk", "archive", nodes.archive!.state),
    e("mac", "relay", "relay", nodes.relay!.state),
    e("relay", "bluebubbles", "relay", nodes.bluebubbles!.state),
    e("relay", "openai", "relay", nodes.openai!.state),
    e("relay", "lattice", "relay", nodes.relay!.state),
    e("desk", "exchange", "exchange", nodes.exchange!.state),
    { ...e("exchange", "polymarket", "exchange", nodes.polymarket!.state), label: "Live odds", how: conn("polymarket")?.how, ...fromConn("polymarket") },
    e("desk", "green", "green", nodes.green!.state),
    { ...e("green", "sleeper", "green", nodes.sleeper!.state), label: "Your league", how: conn("sleeper")?.how, ...fromConn("sleeper") },
    { ...e("green", "fantasypros", "green", nodes.fantasypros!.state), label: "Projections", how: conn("fantasypros")?.how, ...fromConn("fantasypros") },
  ];

  // The Foundry's flow: foundryGraph's edges, with their connections' kinds, sign-in and timing.
  const fe: GEdge[] = foundry.edges.map((x) => {
    const a = fid(x.from);
    const b = fid(x.to);
    const meta = FOUNDRY_EDGE[`${x.from}-${x.to}`] ?? {};
    let state = G_STATE[x.state];
    if (state === "ok" && (nodes[b]?.state === "run" || (a !== "builder" && nodes[a]?.state === "run" && b === "checks"))) state = "run";
    return { a, b, room: "foundry", state, label: x.label, how: x.what, ...meta };
  });
  fe.push({ a: "checks", b: "vqa", room: "foundry", state: nodes.vqa!.state, label: "After each push", how: conn("gemini-visual-qa")?.how ?? "A run records each room and asks Gemini what looks wrong.", ...fromConn("gemini-visual-qa") });
  fe.push({ a: "issues", b: "pings", room: "foundry", state: nodes.pings!.state, label: "A ping when you're needed", how: conn("desk-pings")?.how ?? "One Web Push ping when something needs your call.", ...fromConn("desk-pings") });

  const clockLine = clock.state === "ok" ? `Live, ${clock.headline.toLowerCase()}` : clock.headline;
  const flows: Record<FlowId, Flow> = {
    foundry: {
      id: "foundry",
      t: "The Foundry",
      sub: "idea to the live site",
      room: "foundry",
      p: `Every part an idea passes through on its way to the Lattice. ${building ? `${building} is building right now, so that thread runs hot.` : "Nobody is building right now."} Tap a step for how it signs in and how often it runs.`,
      st: !connected ? "Not connected yet" : building ? "Live, building now" : "Live",
      stc: foundryRoom,
      edges: fe,
    },
    boiler: {
      id: "boiler",
      t: "The world clock",
      sub: "one step every hour",
      room: "boiler",
      p: "How Ilyr moves forward. A schedule knocks, Claude writes the hour, the Blob store keeps it, and the Lattice and this Desk read it back.",
      st: clockLine,
      stc: G_STATE[clock.state],
      edges: [
        { a: "cron", b: "step", room: "boiler", state: nodes.step!.state, label: "POST /api/world-step", how: "A GitHub Actions cron calls the world step on Vercel.", ...fromConn("world-trigger") },
        { a: "doorbell", b: "step", room: "boiler", state: nodes.doorbell!.state === "wait" ? "wait" : nodes.step!.state, label: "A backup knock", kinds: ["Webhook"], how: "The Foundry's doorbell knocks too, in case GitHub's schedule runs late.", auth: "None needed: a step within 55 minutes of the last one does nothing.", when: "Every ten minutes." },
        { a: "step", b: "claude", room: "boiler", state: world?.claude ? nodes.step!.state : "wait", label: "Writes the hour", how: "Claude Haiku writes the next hour of Ilyr in a fixed shape, and every answer is checked again.", ...fromConn("claude-api") },
        { a: "step", b: "worldstate", room: "boiler", state: nodes.worldstate!.state, label: "Saves it", how: "The new hour is saved with an ETag check, so two steps can't both land.", ...fromConn("blob") },
        { a: "worldstate", b: "lattice", room: "boiler", state: nodes.worldstate!.state, label: "The Lattice reads it", kinds: ["REST API"], how: "The public Lattice draws the rooms from the saved world. Titles and counts only.", auth: "Read only, public.", when: "Every visit." },
        { a: "step", b: "clock", room: "boiler", state: nodes.clock!.state, label: "The world clock", kinds: ["Polling"], how: "The Desk reads the same address to draw the world clock.", auth: "Read only.", when: "Every minute." },
      ],
    },
    archive: {
      id: "archive",
      t: "The day's story",
      sub: "written, then read aloud",
      room: "archive",
      p: "After midnight the day is filed as a story. It's written from the public Chronicle only, scrubbed, read aloud, and kept for the Chronicle page.",
      st: story ? (story.gemini ? `Live, ${story.stories} ${story.stories === 1 ? "story" : "stories"} this month` : "No Gemini key yet, so no audio") : "Waiting for the world's ledger",
      stc: nodes.archive!.state,
      edges: [
        { a: "midnight", b: "script", room: "archive", state: nodes.script!.state, label: "Files the day", kinds: ["Scheduled"], how: "Once the day's recap is filed, a Vercel function writes the story script.", auth: "A scheduled run; Make it now needs your passkey.", when: "Once a day, just after midnight." },
        { a: "history", b: "script", room: "archive", state: nodes.script!.state, label: "The day's hours", kinds: ["Storage"], how: "The script is written from the public Chronicle only, then scrubbed.", auth: VBLOB, when: "Once a day." },
        { a: "script", b: "speech", room: "archive", state: nodes.speech!.state, label: "Read it aloud", how: conn("gemini-speech")?.how ?? "The script goes to Gemini's text to speech.", ...fromConn("gemini-speech") },
        { a: "speech", b: "audio", room: "archive", state: nodes.audio!.state, label: "Keeps the audio", kinds: ["Storage"], how: "The audio is kept in the private Blob store and served from our own site.", auth: VBLOB, when: "Once a day." },
        { a: "audio", b: "chron", room: "archive", state: nodes.audio!.state, label: "Play", kinds: ["REST API"], how: "The Chronicle on the Desk plays it, with the words alongside.", auth: "Your Desk session.", when: "Whenever you press play." },
      ],
    },
    relay: {
      id: "relay",
      t: "The Relay",
      sub: relayLive ? "the hub on the MacBook" : "planned, waiting on the Mac",
      room: "relay",
      p: relayLive
        ? "The hub on the MacBook is up. Messages stay on the Mac; only counts and states ever reach the site."
        : "Nothing here runs yet. Every thread is dashed until the hub on the MacBook comes online. Messages stay on the Mac; only counts and states ever reach the site.",
      st: relayLive ? (hub === "bad" ? "The hub is down" : "Live") : "Not connected yet",
      stc: relayLive ? hub : "wait",
      edges: [
        { a: "mac", b: "hub", room: "relay", state: nodes.hub!.state, label: "Runs the hub", kinds: [], how: "The hub is an always-on service on the MacBook.", auth: "Local to the Mac.", when: "Whenever the Mac is awake and on power." },
        { a: "hub", b: "bluebubbles", room: "relay", state: nodes.bluebubbles!.state, label: "Reads and sends", how: conn("bluebubbles")?.how ?? "", ...fromConn("bluebubbles") },
        { a: "hub", b: "messages", room: "relay", state: nodes.messages!.state, label: "Signed in", kinds: [], how: "Messages stays signed in on the Mac. Nothing leaves it.", auth: "Your Apple account, on the Mac only.", when: "Always." },
        { a: "hub", b: "openai", room: "relay", state: nodes.openai!.state, label: "Sort and draft", how: conn("openai")?.how ?? "", ...fromConn("openai") },
        { a: "bluebubbles", b: "dialtone", room: "relay", state: nodes.dialtone!.state, label: "Who you owe", kinds: ["Agent"], how: "Dialtone keeps track of who is waiting on you, and how long.", auth: "Local to the hub.", when: "Every message in." },
        { a: "messages", b: "dialtone", room: "relay", state: nodes.dialtone!.state, label: "Threads", kinds: ["Agent"], how: "Dialtone reads thread state, never sends.", auth: "Local to the hub.", when: "Every message in." },
        { a: "openai", b: "blasto", room: "relay", state: nodes.blasto!.state, label: "Drafts in your voice", kinds: ["Agent"], how: "Blasto writes a reply in your voice and waits for your tap.", auth: "Local to the hub.", when: "Only for replies you owe." },
        { a: "blasto", b: "you", room: "relay", state: nodes.blasto!.state, label: "A tap to send", kinds: [], how: "Nothing is ever sent without you.", auth: "You.", when: "When you say so." },
        { a: "hub", b: "lattice", room: "relay", state: nodes.hub!.state, label: "Live events", how: conn("hub-socket")?.how ?? "", ...fromConn("hub-socket") },
      ],
    },
  };
  return { nodes, over, flows };
}

type Lay = Record<string, [number, number]>;
/** Where each part sits, as fractions of the graph, on a desk and on a phone; and how tall each view is. */
export const GL: Record<"d" | "p", Record<"overview" | FlowId, Lay>> = {
  d: {
    overview: { green: [0.3, 0.1], sleeper: [0.42, 0.04], fantasypros: [0.42, 0.18], exchange: [0.39, 0.55], polymarket: [0.47, 0.65], you: [0.05, 0.46], desk: [0.17, 0.3], phone: [0.17, 0.68], mac: [0.08, 0.88], foundry: [0.36, 0.3], relay: [0.32, 0.8], github: [0.55, 0.12], claudecode: [0.55, 0.34], claude: [0.6, 0.56], bluebubbles: [0.5, 0.76], openai: [0.62, 0.9], boiler: [0.76, 0.4], archive: [0.78, 0.72], vercel: [0.92, 0.14], blob: [0.91, 0.46], gemini: [0.93, 0.7], lattice: [0.9, 0.9] },
    foundry: { you: [0.04, 0.5], desk: [0.14, 0.5], shaping: [0.26, 0.24], pictures: [0.26, 0.8], issues: [0.37, 0.5], pings: [0.45, 0.84], queue: [0.48, 0.5], builder: [0.58, 0.5], rivet: [0.69, 0.2], rusty: [0.69, 0.5], rocky: [0.69, 0.8], checks: [0.8, 0.5], vqa: [0.82, 0.84], main: [0.88, 0.3], deploy: [0.96, 0.52] },
    boiler: { cron: [0.1, 0.3], doorbell: [0.1, 0.74], step: [0.34, 0.52], claude: [0.58, 0.24], worldstate: [0.58, 0.78], clock: [0.84, 0.3], lattice: [0.86, 0.78] },
    archive: { midnight: [0.1, 0.28], history: [0.1, 0.74], script: [0.34, 0.52], speech: [0.56, 0.28], audio: [0.74, 0.66], chron: [0.92, 0.42] },
    relay: { mac: [0.06, 0.5], hub: [0.24, 0.5], lattice: [0.26, 0.86], bluebubbles: [0.46, 0.2], messages: [0.46, 0.5], openai: [0.46, 0.8], dialtone: [0.68, 0.32], blasto: [0.7, 0.7], you: [0.92, 0.5] },
  },
  p: {
    overview: { green: [0.17, 0.28], sleeper: [0.17, 0.14], fantasypros: [0.62, 0.135], exchange: [0.42, 0.36], polymarket: [0.66, 0.58], you: [0.14, 0.05], desk: [0.5, 0.05], phone: [0.85, 0.07], foundry: [0.3, 0.21], github: [0.8, 0.2], claudecode: [0.64, 0.33], claude: [0.2, 0.38], vercel: [0.84, 0.45], boiler: [0.46, 0.5], blob: [0.16, 0.6], gemini: [0.82, 0.62], archive: [0.5, 0.7], lattice: [0.84, 0.78], mac: [0.14, 0.84], bluebubbles: [0.56, 0.84], relay: [0.32, 0.93], openai: [0.8, 0.94] },
    foundry: { you: [0.5, 0.03], desk: [0.5, 0.11], shaping: [0.2, 0.2], pictures: [0.8, 0.2], issues: [0.5, 0.29], pings: [0.84, 0.36], queue: [0.5, 0.39], builder: [0.5, 0.48], rivet: [0.16, 0.58], rusty: [0.5, 0.58], rocky: [0.84, 0.58], checks: [0.5, 0.68], vqa: [0.84, 0.76], main: [0.5, 0.8], deploy: [0.5, 0.92] },
    boiler: { cron: [0.25, 0.08], doorbell: [0.75, 0.08], step: [0.5, 0.3], claude: [0.22, 0.52], worldstate: [0.78, 0.52], clock: [0.22, 0.76], lattice: [0.78, 0.76] },
    archive: { midnight: [0.25, 0.08], history: [0.75, 0.08], script: [0.5, 0.3], speech: [0.5, 0.5], audio: [0.5, 0.7], chron: [0.5, 0.9] },
    relay: { mac: [0.5, 0.05], hub: [0.5, 0.19], lattice: [0.86, 0.2], bluebubbles: [0.16, 0.38], messages: [0.5, 0.38], openai: [0.84, 0.38], dialtone: [0.3, 0.6], blasto: [0.7, 0.6], you: [0.5, 0.84] },
  },
};
export const GH: Record<"d" | "p", Record<"overview" | FlowId, number>> = {
  d: { overview: 600, foundry: 600, boiler: 520, archive: 520, relay: 560 },
  p: { overview: 660, foundry: 1000, boiler: 640, archive: 640, relay: 760 },
};
