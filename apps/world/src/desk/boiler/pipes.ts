import type { LinkState } from "../../systems.ts";
import type { VisualQaRun } from "../visualqa/feed.ts";
import { LATE_MIN, type JobRow } from "../jobs.ts";
import { problemSay, type Vendor, type VendorProblem } from "../homeDevices.ts";
import type { GNode, GState } from "../systemsGraph.ts";

/**
 * The Boiler Room's pipe map (#732, the B4 schematic Nikita picked on 2026-11-04): every real integration as a station
 * on a brass pipe, the pipes laid out like a transit map around the boiler. This file is the map's data and its
 * reading of the real feeds, pure so it can be tested; boiler/pipeScene.ts draws it and BoilerMap.tsx walks the faults.
 *
 * A station is one integration in one of five states, read from data the Boiler Room already has (the links, the
 * scheduled jobs, Visual QA, the security feed, the world clock and the home devices):
 *   ok    flowing: subtle pulses run through its stretch of pipe
 *   late  slow amber flow: a job started late, Gemini didn't answer, alerts are open, a link is slow
 *   shut  a coral valve shut on a dry pipe: a job skipped or missed its slot, a review that didn't run
 *   leak  cracked, steaming and dripping coral, its gauge in the red: a link is down, a job failed
 *   dry   not connected yet: no flow, a dim gauge, and no fault (nothing broke; it was never laid on)
 * Everything shown here is a state or a count, never a key, an address or a message, so it reads the same signed out.
 */

export type StationState = "ok" | "late" | "shut" | "leak" | "dry";
export type FaultKind = "leak" | "shut" | "late";

/** A point on the round-1 schematic's 960 × 640 grid; the boiler sits at 480, 330. */
export type MapPt = readonly [number, number];

export interface LineDef {
  id: string;
  name: string;
  /** The line's colour band. */
  c: string;
  pts: readonly MapPt[];
  /** A branch off another line: no flange at its root, no valve at the boiler. */
  spur?: boolean;
  /** Draw its name on the map (the deploy branch shares the Foundry line's). */
  named?: boolean;
  /** The line's own valve at the boiler. */
  valve?: boolean;
  /** Where along the path its name sits (0..1). */
  nameAt?: number;
}

export interface StationDef {
  id: string;
  name: string;
  line: string;
  at: MapPt;
  /** The Boiler Room's `?room=` that opens this station's whole flow or room. */
  room: string;
}

export const MAP_LINES: readonly LineDef[] = [
  { id: "foundry", name: "Foundry line", c: "#ff7a3d", pts: [[480, 290], [480, 140], [110, 140]], named: true, valve: true },
  { id: "deploy", name: "Foundry line", c: "#ff7a3d", pts: [[480, 140], [860, 140]] },
  { id: "relay", name: "Relay line", c: "#4fa8ff", pts: [[530, 330], [870, 330]], named: true, valve: true },
  { id: "archive", name: "Archive line", c: "#a07aff", pts: [[480, 370], [480, 450], [870, 450]], named: true, valve: true },
  { id: "money", name: "Green · Exchange · Spire", c: "#4fd18b", pts: [[480, 450], [480, 590], [870, 590]], named: true },
  { id: "house", name: "House line", c: "#f0c987", pts: [[430, 330], [130, 330], [130, 590], [430, 590]], named: true, valve: true, nameAt: 0.3 },
  { id: "pet", name: "House line", c: "#f0c987", pts: [[220, 330], [220, 220]], spur: true },
  { id: "kitchen", name: "House line", c: "#f0c987", pts: [[325, 590], [325, 450]], spur: true },
];

export const STATIONS: readonly StationDef[] = [
  { id: "claudecode", name: "Claude Code", line: "foundry", at: [370, 140], room: "foundry" },
  { id: "github", name: "GitHub", line: "foundry", at: [250, 140], room: "foundry" },
  { id: "vqa", name: "Visual QA", line: "foundry", at: [120, 140], room: "foundry" },
  { id: "scans", name: "Scans", line: "deploy", at: [580, 140], room: "foundry" },
  { id: "deploy", name: "Azure deploy", line: "deploy", at: [710, 140], room: "foundry" },
  { id: "pings", name: "Phone pings", line: "deploy", at: [850, 140], room: "foundry" },
  { id: "gmail", name: "Gmail", line: "relay", at: [630, 330], room: "relay" },
  { id: "texts", name: "Texts", line: "relay", at: [745, 330], room: "relay" },
  { id: "claude", name: "Claude API", line: "relay", at: [860, 330], room: "relay" },
  { id: "clock", name: "World clock", line: "archive", at: [610, 450], room: "boiler" },
  { id: "voice", name: "ElevenLabs", line: "archive", at: [735, 450], room: "archive" },
  { id: "lattice", name: "Lattice", line: "archive", at: [860, 450], room: "boiler" },
  { id: "sleeper", name: "Sleeper", line: "money", at: [580, 590], room: "green" },
  { id: "fantasypros", name: "FantasyPros", line: "money", at: [675, 590], room: "green" },
  { id: "polymarket", name: "Polymarket", line: "money", at: [770, 590], room: "exchange" },
  { id: "paypal", name: "PayPal", line: "money", at: [865, 590], room: "spire" },
  { id: "blob", name: "Azure Blob", line: "house", at: [385, 330], room: "boiler" },
  { id: "backup", name: "Backups", line: "house", at: [300, 330], room: "boiler" },
  { id: "nest", name: "Nest", line: "house", at: [130, 460], room: "boiler" },
  { id: "whisker", name: "Whisker", line: "house", at: [230, 590], room: "boiler" },
  { id: "roborock", name: "Roborock", line: "house", at: [420, 590], room: "boiler" },
  { id: "petlibro", name: "Petlibro", line: "pet", at: [220, 220], room: "boiler" },
  { id: "tasks", name: "Google Tasks", line: "kitchen", at: [325, 530], room: "boiler" },
  { id: "kroger", name: "King Soopers", line: "kitchen", at: [325, 455], room: "boiler" },
];

/** Rooms with no real pipe yet: ghost outlines on the map. */
export const PLANNED_PIPES: readonly (readonly MapPt[])[] = [
  [[620, 220], [900, 220]],
  [[620, 220], [620, 262]],
];
export const PLANNED_LABEL = { text: "Planned · Workshop · Studio", at: [760, 220] as MapPt };

/** What the Fix button does: a real action the Desk already has, or none (then the panel shows the steps). */
export type Fix =
  | { kind: "url"; label: string; url: string }
  | { kind: "nav"; label: string; path: string; signedIn?: boolean }
  | { kind: "gmail"; label: string }
  | { kind: "google"; label: string; grant: "nest" | "tasks" }
  | { kind: "kroger"; label: string }
  | { kind: "clock"; label: string };

export interface Fault {
  id: string;
  station: string;
  kind: FaultKind;
  /** The line's name, for the panel's kicker. */
  line: string;
  /** When it started, in a few words, or "" when the feeds don't say. */
  since: string;
  title: string;
  body: string;
  route: [string, string, string];
  fix: Fix | null;
  steps: string[];
}

export interface StationRead {
  id: string;
  state: StationState;
  /** A few words on the reading, for a tap on a healthy station. */
  note: string;
}

export interface PipeMap {
  stations: Record<string, StationRead>;
  faults: Fault[];
  /** Stations holding pressure (ok), and the rest by state. */
  counts: Record<StationState, number> & { total: number };
}

export interface PipeInput {
  now: number;
  /** The systems model's parts (systemsGraph.ts), for the parts it already reads. */
  nodes: Record<string, GNode>;
  /** Every link's state (systems.ts, with the house's vendors and links merged in, as the Systems page does). */
  links: Record<string, LinkState>;
  /** The scheduled jobs (jobs.ts, jobRows). */
  jobs: JobRow[];
  /** The latest Visual QA run, or null before the first (or without its feed). */
  vqa: VisualQaRun | null;
  /** The security feed's scans and open alerts, or null before it answers. */
  security: { failing: { name: string; url: string | null }[]; reported: number; alerts: number | null } | null;
  /** The world clock: its state and when the last hour was written. */
  clock: { state: LinkState; at: number | null };
  /** Why each down vendor is down: signed in only (empty signed out). */
  problems?: Partial<Record<Vendor, VendorProblem>>;
}

const GITHUB_RUNS = "https://github.com/nikitapage10/C.E.O./actions";

/** "18 min ago", "3 h ago", "2 days ago"; "" without a time. */
export function sinceWords(at: number | null | undefined, now: number): string {
  if (at === null || at === undefined || !Number.isFinite(at)) return "";
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

const G_TO: Record<GState, StationState> = { ok: "ok", run: "ok", wait: "dry", bad: "leak" };
const L_TO: Record<LinkState, StationState> = { ok: "ok", slow: "late", off: "dry", down: "leak" };
const RANK: Record<StationState, number> = { leak: 4, shut: 3, late: 2, ok: 1, dry: 0 };

/** One job's state as a station's: failed leaks, skipped or missed shuts, late runs slow, no run yet is dry. */
export function jobState(r: JobRow | undefined): StationState {
  if (!r || r.state === "none") return "dry";
  if (r.state === "fail") return "leak";
  if (r.state === "other" || r.missed) return "shut";
  if (r.lateMin !== null && r.lateMin >= LATE_MIN && r.state !== "running") return "late";
  return "ok";
}

interface Cause {
  state: StationState;
  title: string;
  body: string;
  since?: string;
  fix?: Fix | null;
  steps?: string[];
  note?: string;
}

const worst = (cs: Cause[]): Cause => cs.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));

const VENDOR_FIX: Partial<Record<string, Fix>> = {
  nest: { kind: "google", label: "Reconnect Nest", grant: "nest" },
  tasks: { kind: "google", label: "Reconnect Google Tasks", grant: "tasks" },
  kroger: { kind: "kroger", label: "Reconnect King Soopers" },
  roborock: { kind: "nav", label: "Reconnect Roborock", path: "/boiler/controls#ct-house", signedIn: true },
};

const KEY_FIX = (what: string): Fix => ({ kind: "nav", label: `Replace the ${what} key`, path: "/boiler/controls#ct-keys", signedIn: true });

function jobCause(name: string, r: JobRow | undefined, now: number): Cause {
  const s = jobState(r);
  const url = r?.url ?? GITHUB_RUNS;
  const lower = name.replace(/^The /, "the ");
  const open: Fix = { kind: "url", label: s === "leak" ? `Re-run ${lower}` : `Open ${lower}'s run`, url };
  const since = sinceWords(r?.at, now);
  switch (s) {
    case "leak":
      return { state: s, since, title: `${name} failed.`, body: `Its last run on GitHub failed, so this stretch of pipe is cracked. The rest of the line holds; the next run tries again on its own.`, fix: open, steps: ["Re-run opens the run on GitHub, with its Re-run button", "Its log says which step broke", "A green run seals the pipe"] };
    case "shut":
      return { state: s, since, title: r?.missed ? `${name} didn't run when it was due.` : `${name} was skipped.`, body: r?.missed ? "GitHub didn't start it at its slot, so its valve stayed shut and the pipe past it is dry." : "Its last run was skipped or cancelled, so its valve stayed shut and the pipe past it is dry.", fix: open, steps: ["Open the run on GitHub", "Run the workflow by hand from there", "The valve opens when a run lands"] };
    case "late":
      return { state: s, since, title: `${name} started ${r?.lateMin ?? LATE_MIN} min late.`, body: "GitHub started it well after its slot. Nothing is lost; the flow just runs slow.", fix: open, steps: ["GitHub's schedule runs late at busy hours", "Nothing to do unless it keeps slipping", "The gauge settles when a run starts on time"] };
    case "dry":
      return { state: s, title: `${name} hasn't run yet.`, body: "", note: "no run seen yet" };
    default:
      return { state: "ok", title: "", body: "", note: `ran ${since || "recently"}` };
  }
}

function linkCause(id: string, name: string, state: LinkState, extra: { down?: Partial<Cause>; slow?: Partial<Cause>; fix?: Fix | null } = {}): Cause {
  const s = L_TO[state];
  if (s === "leak") return { state: s, title: `${name} is down.`, body: `${name} stopped answering, so its stretch of pipe is cracked. The rest of its line holds pressure.`, fix: extra.fix ?? null, steps: [`It tries again on the next read`, `If it stays down, reconnect it from Controls`, "The pipe seals when it answers"], ...extra.down };
  if (s === "late") return { state: s, title: `${name} is slow.`, body: `${name} is answering, but late. The flow runs slow and amber until it catches up.`, fix: extra.fix ?? null, steps: ["Nothing is lost; it catches up on its own", "The gauge settles back in the green"], ...extra.slow };
  if (s === "dry") return { state: s, title: "", body: "", note: "not connected yet" };
  return { state: s, title: "", body: "", note: id === "lattice" ? "public, open" : "holding pressure, reading normal" };
}

/** Read every station from the feeds, and list the faults worst first (leaks, then shut valves, then late flow). */
export function readPipes(input: PipeInput): PipeMap {
  const { now, nodes, links, jobs, vqa, security, clock, problems = {} } = input;
  const job = (file: string) => jobs.find((j) => j.file === file);
  const L = (id: string): LinkState => links[id] ?? "off";
  const node = (id: string): StationState => G_TO[nodes[id]?.state ?? "wait"];
  const ok = (note = "holding pressure, reading normal"): Cause => ({ state: "ok", title: "", body: "", note });
  const dry = (note = "not connected yet"): Cause => ({ state: "dry", title: "", body: "", note });

  const vendorDown = (v: Vendor, name: string): Partial<Cause> => {
    const why = problems[v];
    return {
      title: why === "signed-out" || why === "refused" ? `${name} can't sign in.` : `${name} is down.`,
      body: why ? problemSay(v, why) : `${name}'s cloud stopped answering, so its pipe is cracked. The devices keep their own schedules and the rest of the House line holds.`,
      steps: VENDOR_FIX[v] ? [`Reconnect opens ${name}'s sign-in, sealed with the house key`, "The Pessimist reads one device to prove it", "The pipe seals and this fault closes"] : ["Run the setup paste again (docs/HOME-DEVICES.md)", "Or share the devices to a second account and put that one in the Key Vault", "The pipe seals on the next read"],
    };
  };

  const causes: Record<string, Cause> = {
    claudecode: node("claudecode") === "dry" ? dry("not connected to GitHub") : ok(nodes.claudecode?.state === "run" ? "building right now" : "the Builder's thread, idle"),
    github: worst([
      L("checks") === "down" ? { state: "leak", title: "Checks are failing on main.", body: "Types, lint, tests or the build failed on main, so the GitHub stretch is cracked. Nothing new ships until they pass.", fix: { kind: "url", label: "Open the checks", url: GITHUB_RUNS }, steps: ["Open the failing run on GitHub", "The Builder picks up the fix", "A green run seals the pipe"] } : node("github") === "dry" ? dry("not connected") : ok("issues, checks and Actions"),
      ...[jobCause("The nightly checks", job("checks.yml"), now), jobCause("The browser tests", job("e2e.yml"), now)].filter((c) => c.state !== "dry" && c.state !== "ok"),
    ]),
    vqa: (() => {
      if (!vqa) return dry("no run yet");
      const since = sinceWords(Date.parse(vqa.at), now);
      const open: Fix = { kind: "url", label: "Run Visual QA again", url: vqa.url };
      if (vqa.run === "fail") return { state: "leak", since, title: "Visual QA's tour failed.", body: "The room tour didn't finish, so nothing was reviewed. Builds still ship; nobody has looked at them in a browser since.", fix: open, steps: ["Re-run opens the run on GitHub", "The tour records each room on a phone and a desktop", "Gemini looks; anything off lands in the Foundry"] };
      if (vqa.review === "skipped") return { state: "shut", since, title: "Visual QA didn't review.", body: "The clips were recorded but Gemini's review was skipped (no key yet, or the day's cap), so the valve to Visual QA stayed shut.", fix: open, steps: ["Re-run opens the run on GitHub", "Gemini looks at each room on a phone and a desktop", "Anything off lands in the Foundry as an issue"] };
      if (vqa.blockers > 0) return { state: "leak", since, title: `Visual QA found ${vqa.blockers} ${vqa.blockers === 1 ? "blocker" : "blockers"}.`, body: `Gemini found something broken in ${vqa.rooms} rooms. The blockers went to the fix lane.`, fix: { kind: "nav", label: "See them in the Foundry", path: "/foundry" }, steps: ["Each blocker is a fix issue in the Foundry", "Rivet picks them up", "The next clean run seals the pipe"] };
      if (vqa.review === "unavailable" || vqa.review === "partial") return { state: "late", since, title: "Visual QA only half looked.", body: "The clips were recorded, but Gemini didn't answer for every room this time.", fix: open, steps: ["It tries again after the next push", "Or re-run it now from GitHub"] };
      return ok(`${vqa.rooms} rooms checked ${since}`);
    })(),
    scans: (() => {
      if (!security || !security.reported) return dry("waiting on GitHub");
      if (security.failing.length) {
        const names = security.failing.map((f) => f.name).join(", ");
        return { state: "leak", title: `${security.failing.length === 1 ? `${names} is` : `${security.failing.length} scans are`} failing.`, body: `${names} failed on the last run, so the scans' stretch is cracked. The details stay on the Security tab.`, fix: { kind: "url", label: "Open the failing run", url: security.failing[0]!.url ?? GITHUB_RUNS }, steps: ["Open the run on GitHub", "The Builder fixes what it found", "A clean scan seals the pipe"] };
      }
      if (security.alerts) return { state: "late", title: `${security.alerts} security ${security.alerts === 1 ? "alert is" : "alerts are"} open.`, body: "Code scanning or Dependabot has open alerts. Nothing is broken; they wait to be fixed.", fix: { kind: "nav", label: "Open Security", path: "/boiler/security" }, steps: ["Security lists them by count and severity", "Dependabot opens its own pull requests", "The gauge drops as they close"] };
      return ok(`${security.reported} scans passing`);
    })(),
    deploy: jobCause("Deploy to Azure", job("deploy-azure.yml"), now),
    pings: nodes.pings?.state === "wait" ? dry("not set up") : (() => {
      const c = jobCause("Desk pings", job("desk-pings.yml"), now);
      return c.state === "dry" ? ok("set up") : c;
    })(),
    gmail: linkCause("gmail", "Gmail", L("gmail"), { fix: { kind: "gmail", label: "Reconnect Gmail" }, down: { steps: ["Reconnect opens Google's sign-in, read-only", "Dialtone sorts the inbox again", "The pipe seals and this fault closes"] } }),
    texts: linkCause("texts", "The hub", L("hub"), { down: { title: "The hub on the MacBook is down.", body: "The texts hub stopped answering, so the Relay's texts pipe is cracked. Messages stay on the Mac and wait.", steps: ["Wake the MacBook and keep it on power", "The hub starts on its own and calls out", "The pipe seals on its first answer"] } }),
    claude: node("claude") === "dry" ? dry("no key yet") : ok("Haiku, through the site"),
    clock: (() => {
      const s = L_TO[clock.state];
      const since = sinceWords(clock.at, now);
      const fix: Fix = { kind: "clock", label: "Read the clock again" };
      if (s === "leak") return { state: s, since, title: "The world clock stopped.", body: "No hour has been written for over three hours, so Ilyr is standing still. Nothing is lost; the Lattice shows the last hour.", fix, steps: ["Read again asks Azure for the latest hour", "The Function App's timer and the GitHub cron both knock hourly", "The gauge settles when an hour lands"] };
      if (s === "late") return { state: s, since, title: "The world clock is running late.", body: "The clock that turns Ilyr's day is behind its hour. Nothing is lost; the Lattice just shows the world a little late.", fix, steps: ["Read again asks Azure for the latest hour", "The next knock catches it up, no jump", "The gauge settles back in the green"] };
      if (s === "dry") return dry("not read yet");
      return ok(`last hour ${since}`);
    })(),
    voice: node("speech") === "dry" ? dry("no key yet") : ok("Skippy's voice"),
    lattice: (() => {
      const c = jobCause("The live watch", job("live-watch.yml"), now);
      return c.state === "dry" || c.state === "ok" ? ok("public, open") : { ...c, title: c.state === "leak" ? "The live site check failed." : c.title };
    })(),
    sleeper: linkCause("sleeper", "Sleeper", L("sleeper")),
    fantasypros: linkCause("fantasypros", "FantasyPros", L("fantasypros"), { fix: KEY_FIX("FantasyPros") }),
    polymarket: linkCause("polymarket", "Polymarket", L("polymarket")),
    paypal: linkCause("paypal", "PayPal", L("paypal"), { fix: KEY_FIX("PayPal") }),
    blob: node("blob") === "dry" ? dry("not read yet") : ok("ceo-state, private"),
    backup: jobCause("The nightly backup", job("backup-azure.yml"), now),
    nest: linkCause("nest", "Nest", L("nest"), { fix: VENDOR_FIX.nest, down: vendorDown("nest", "Nest") }),
    whisker: linkCause("whisker", "Whisker", L("whisker"), { down: vendorDown("whisker", "Whisker") }),
    roborock: linkCause("roborock", "Roborock", L("roborock"), { fix: VENDOR_FIX.roborock, down: vendorDown("roborock", "Roborock") }),
    petlibro: linkCause("petlibro", "Petlibro", L("petlibro"), { down: vendorDown("petlibro", "Petlibro") }),
    tasks: linkCause("tasks", "Google Tasks", L("tasks"), { fix: VENDOR_FIX.tasks }),
    kroger: linkCause("kroger", "King Soopers", L("kroger"), { fix: VENDOR_FIX.kroger }),
  };
  // A key-backed link that is down: its fix is the Keys form.
  if (causes.claude && L("openai") === "down") causes.claude = { ...linkCause("claude", "Claude", "down", { fix: KEY_FIX("Claude API") }) };

  const stations: Record<string, StationRead> = {};
  const faults: Fault[] = [];
  for (const s of STATIONS) {
    const c = causes[s.id] ?? dry();
    stations[s.id] = { id: s.id, state: c.state, note: c.note ?? "" };
    if (c.state === "leak" || c.state === "shut" || c.state === "late") {
      const line = MAP_LINES.find((l) => l.id === s.line)!;
      faults.push({ id: s.id, station: s.id, kind: c.state, line: line.name, since: c.since ?? "", title: c.title, body: c.body, route: ["Boiler", line.name, s.name], fix: c.fix ?? null, steps: c.steps ?? [] });
    }
  }
  faults.sort((a, b) => RANK[b.kind] - RANK[a.kind]);
  const counts = { ok: 0, late: 0, shut: 0, leak: 0, dry: 0, total: STATIONS.length };
  for (const r of Object.values(stations)) counts[r.state]++;
  return { stations, faults, counts };
}

/** The headline beside "Boiler Room": "everything is holding", or the faults and late ones in plain words. */
export function pipeHeadline(faults: Fault[]): { text: string; ok: boolean } {
  const bad = faults.filter((f) => f.kind !== "late").length;
  const late = faults.length - bad;
  if (!faults.length) return { text: "everything is holding", ok: true };
  const parts = [bad ? `${bad} ${bad === 1 ? "fault" : "faults"}` : "", late ? `${late} late` : ""].filter(Boolean);
  return { text: `${parts.join(", ")} in the pipes`, ok: false };
}

/** A gauge's needle for a state, 0..1: healthy ones sit mid-green, each a touch apart so the dials don't look stamped. */
export function gaugeOf(id: string, s: StationState): number {
  if (s === "leak") return 0.94;
  if (s === "late") return 0.72;
  if (s === "shut") return 0.02;
  if (s === "dry") return 0.06;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.42 + (h % 15) / 100;
}
