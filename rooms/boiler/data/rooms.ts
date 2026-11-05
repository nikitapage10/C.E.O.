import { CONNECTIONS, type Connection } from "./connections.ts";
import type { JobRow } from "../../../apps/desk/src/jobs.ts";
import type { Fitting, GState, PipeRow } from "./systemsGraph.ts";
import { connectionFor } from "./pressure.ts";
import { actionOf } from "./controls.ts";
import { jobCause, KEY_FIX, sinceWords, type Fault, type Fix, type PipeMap, type StationState } from "./pipes.ts";

/**
 * The Boiler Room's pipe map, room by room (#743; Nikita, 2026-11-04 23:23Z: "the boiler room is supposed to be per
 * room… the same level of granularity we had per room, and hovering over would show you more information"). Every room
 * the old rack drew (systemsGraph.ts, pipeRows) is its own manifold off the boiler: a header pipe in the room's colour
 * and one branch pipe per thing the room runs on, so nothing the rack or its room detail showed is lost:
 *
 *   every fitting on the room's rack line (what feeds it, what it feeds), in the rack's order
 *   every connection connections.ts gives the room that no fitting already stands for (planned ones as ghosts)
 *   the room's scheduled jobs (jobs.ts) and, for the Foundry, the security scans
 *
 * Each pipe keeps its own state, why, last success, what it reads and how it signs in, what it needs from Nikita and
 * its fix, for the hover card. Positions are laid out here too (world units on the floor, x across, z down), so the
 * scene and the tests read the same numbers. Pure.
 */

export type PipeKind = "link" | "part" | "job" | "planned";

export interface RoomPipe {
  /** Unique across the map: `room:key`. */
  id: string;
  room: string;
  name: string;
  /** What it is, in a few words. */
  what: string;
  kind: PipeKind;
  state: StationState;
  /** The state in a few words, and why. */
  why: string;
  body: string;
  since: string;
  /** When it last worked, if a feed says. */
  lastOk: number | null;
  /** How it works, signs in and how often (connections.ts), when it has an outside service. */
  facts: Pick<Connection, "how" | "auth" | "when" | "kinds"> | null;
  /** What it needs from Nikita, in plain words; null when nothing. */
  needs: string | null;
  fix: Fix | null;
  steps: string[];
  /** A cap, as a state word signed out or a share signed in. */
  cap: string | null;
}

export interface RoomSection {
  id: string;
  name: string;
  sub: string;
  c: string;
  /** The room has a whole flow to open (`?room=`). */
  flow: boolean;
  pipes: RoomPipe[];
}

/** Each room's colour band. */
export const ROOM_COLOUR: Record<string, string> = {
  foundry: "#ff7a3d",
  relay: "#4fa8ff",
  archive: "#a07aff",
  green: "#4fd18b",
  exchange: "#3fc8c0",
  spire: "#e0a24f",
  // The Haven's lamplight, warmed so it reads apart from the Spire's gold (#789).
  haven: "#ffb08a",
  // The Boiler Room's steel: only the shared plumbing now.
  boiler: "#a8aebc",
};

/** Which reading in pipes.ts (readPipes) stands for a fitting, where one is richer than the rack's own state. */
const FIT_STATION: Record<string, string> = {
  claudecode: "claudecode",
  github: "github",
  gemini: "vqa",
  vqa: "vqa",
  phone: "pings",
  pings: "pings",
  gmail: "gmail",
  bluebubbles: "texts",
  hub: "texts",
  claude: "claude",
  openai: "claude",
  clock: "clock",
  step: "clock",
  speech: "voice",
  lattice: "lattice",
  blob: "blob",
  worldstate: "blob",
  sleeper: "sleeper",
  fantasypros: "fantasypros",
  polymarket: "polymarket",
  paypal: "paypal",
  roborock: "roborock",
  petlibro: "petlibro",
  whisker: "whisker",
  nest: "nest",
  tasks: "tasks",
  kroger: "kroger",
};

/** The jobs on GitHub's clock, by the room they belong to (Visual QA is the Foundry's fitting already). */
const JOB_ROOM: Record<string, string> = {
  "checks.yml": "foundry",
  "e2e.yml": "foundry",
  "codeql.yml": "foundry",
  "scorecard.yml": "foundry",
  "deploy-azure.yml": "foundry",
  "desk-pings.yml": "foundry",
  "live-watch.yml": "foundry",
  "world-step.yml": "boiler",
  "backup-azure.yml": "boiler",
};

/** What a link that isn't connected yet needs, and the button that connects it. */
const CONNECT: Record<string, { needs: string; fix: Fix | null }> = {
  gmail: { needs: "Connect Gmail (read-only) from here.", fix: { kind: "gmail", label: "Connect Gmail" } },
  nest: { needs: "Connect Nest at Google.", fix: { kind: "google", label: "Connect Nest", grant: "nest" } },
  tasks: { needs: "Connect Google Tasks at Google.", fix: { kind: "google", label: "Connect Google Tasks", grant: "tasks" } },
  kroger: { needs: "Pick a home store and connect King Soopers.", fix: { kind: "kroger", label: "Connect King Soopers" } },
  roborock: { needs: "Connect Roborock with its email code on Controls.", fix: { kind: "nav", label: "Connect Roborock", path: "/boiler/controls#ct-house", signedIn: true } },
  petlibro: { needs: "Its email and digest in the Key Vault (the setup paste, docs/HOME-DEVICES.md).", fix: null },
  whisker: { needs: "Its email and digest in the Key Vault (the setup paste, docs/HOME-DEVICES.md).", fix: null },
  fantasypros: { needs: "The FantasyPros key on Controls.", fix: KEY_FIX("FantasyPros") },
  paypal: { needs: "The PayPal keys on Controls.", fix: KEY_FIX("PayPal") },
  openai: { needs: "The Claude API key on Controls.", fix: KEY_FIX("Claude API") },
  claude: { needs: "The Claude API key on Controls.", fix: KEY_FIX("Claude API") },
  hub: { needs: "Install and pair the hub on the MacBook.", fix: null },
  bluebubbles: { needs: "Install and pair the hub on the MacBook.", fix: null },
  speech: { needs: "The ElevenLabs key on Controls.", fix: KEY_FIX("ElevenLabs") },
};

const RANK: Record<StationState, number> = { leak: 4, shut: 3, late: 2, ok: 1, dry: 0 };
const G_TO: Record<GState, StationState> = { ok: "ok", run: "ok", wait: "dry", bad: "leak" };
export const STATE_SAY: Record<StationState, string> = { ok: "Flowing", late: "Running late", shut: "Valve shut", leak: "Broken", dry: "Not connected yet" };

export interface RoomsInput {
  now: number;
  rows: PipeRow[];
  /** The richer readings (pipes.ts). */
  map: PipeMap;
  jobs: JobRow[];
  /** When each link was last heard from (systems.ts), by fitting id. */
  lastSeen?: Record<string, number | null>;
  /** Caps by fitting id: a share of the cap (0..1), or null when unread. */
  caps?: Record<string, number | null>;
  signedIn: boolean;
  security?: { failing: number; reported: number; alerts: number | null } | null;
}

const capWord = (share: number | null | undefined, signedIn: boolean): string | null => {
  if (share === undefined) return null;
  if (share === null) return "Waiting for its meter";
  if (signedIn) return `${Math.round(share * 100)}% of its cap this month`;
  return share >= 1 ? "At its cap" : share >= 0.8 ? "Near its cap" : "Under its cap";
};

function factsOf(c: Connection | undefined): RoomPipe["facts"] {
  return c ? { how: c.how, auth: c.auth, when: c.when, kinds: [...c.kinds] } : null;
}

/** The connections a fitting stands for in a room: the rack's explanation (pressure.ts) plus the ones only here. */
function connOf(fitId: string, room: string): Connection | undefined {
  return connectionFor(fitId, room) ?? (fitId === "blob" || fitId === "worldstate" ? CONNECTIONS.find((c) => c.id === "blob") : undefined);
}

/** The whole map, room by room. */
export function roomSections(input: RoomsInput): RoomSection[] {
  const { now, rows, map, jobs, lastSeen = {}, caps = {}, signedIn, security } = input;
  // Every room that uses an API owns it; the Boiler Room keeps the shared plumbing and comes last (#789).
  const order = [...rows].sort((a, b) => Number(a.id === "boiler") - Number(b.id === "boiler"));
  return order.map((r) => {
    const pipes: RoomPipe[] = [];
    const used = new Set<string>();
    const seen = new Set<string>();
    const fits: Fitting[] = [];
    for (const f of [...r.ins, ...r.outs]) if (!seen.has(f.id)) {
      seen.add(f.id);
      fits.push(f);
    }

    for (const f of fits) {
      const c = connOf(f.id, r.room);
      if (c) used.add(c.id);
      // Relay's "Lattice" is the hub's live socket, not the public site's watch.
      const key = f.id === "lattice" && r.id === "relay" ? undefined : FIT_STATION[f.id];
      const st = key ? map.stations[key] : undefined;
      // The rack's own state for this connection wins when it says broken or waiting; the richer reading says why.
      const rack = G_TO[f.state];
      const state: StationState = st && st.state !== "dry" ? (RANK[rack] > RANK[st.state] ? rack : st.state) : rack;
      const told = !!st && st.state === state && !!st.title;
      const conn = CONNECT[f.id];
      const isPart = !c && !st;
      const fault = state === "leak" || state === "shut" || state === "late";
      const fix = fault ? (told ? st!.fix : (conn?.fix ?? null)) : state === "dry" ? (conn?.fix ?? null) : null;
      const name = c?.name ?? f.l;
      pipes.push({
        id: `${r.id}:${f.id}`,
        room: r.id,
        name,
        what: c?.serves ?? f.s,
        kind: isPart ? "part" : "link",
        state,
        why: fault ? (told ? st!.title : `${name} is down.`) : state === "dry" ? (st?.note ? `${st.note.charAt(0).toUpperCase()}${st.note.slice(1)}.` : "Not connected yet.") : st?.note ? `${STATE_SAY[state]}, ${st.note}.` : `${STATE_SAY[state]}.`,
        body: fault ? (told ? st!.body : "It stopped answering, so its pipe is cracked. The rest of the room holds.") : isPart ? `A part on the ${r.name} line, with no outside service of its own. Its state is the state of the connection into it.` : "",
        since: st?.since ?? "",
        lastOk: state === "ok" || state === "late" ? (lastSeen[f.id] ?? null) : null,
        facts: factsOf(c),
        needs: fault ? (fix ? `${fix.label}.` : told && st!.steps[0] ? `${st!.steps[0]}.` : "Nothing yet: it tries again on its own.") : state === "dry" ? (conn?.needs ?? (actionOf(f.id).kind === "key" ? "Its key on Controls." : null)) : null,
        fix,
        steps: fault && told ? st!.steps : [],
        cap: capWord(caps[f.id], signedIn),
      });
    }

    // The Boiler Room's own line is the world clock (the rack's state for its row).
    if (r.id === "boiler" && map.stations.clock) {
      const ck = map.stations.clock;
      const fault = ck.state === "leak" || ck.state === "shut" || ck.state === "late";
      pipes.unshift({
        id: "boiler:clock",
        room: r.id,
        name: "World clock",
        what: "Ilyr's hourly step",
        kind: "link",
        state: ck.state,
        why: fault ? ck.title : ck.state === "dry" ? "Not read yet." : `Flowing, ${ck.note}.`,
        body: fault ? ck.body : "",
        since: ck.since,
        lastOk: lastSeen.clock ?? null,
        facts: { how: "A timer on the Function App steps the world each hour; Claude writes the hour, Azure Blob keeps it, the Lattice and this Desk read it back.", auth: "The Function App's managed identity; the cron's knock needs no key.", when: "Hourly at :05, with backup knocks.", kinds: ["Scheduled", "Polling"] },
        needs: fault && ck.fix ? `${ck.fix.label}.` : null,
        fix: fault ? ck.fix : null,
        steps: fault ? ck.steps : [],
        cap: capWord(caps.claude, signedIn),
      });
    }

    // The room's other connections, as its room detail listed them.
    for (const c of CONNECTIONS.filter((x) => x.room === r.room && !used.has(x.id))) {
      const planned = c.status === "planned";
      pipes.push({
        id: `${r.id}:${c.id}`,
        room: r.id,
        name: c.name,
        what: c.serves,
        kind: planned ? "planned" : "link",
        state: planned ? "dry" : "ok",
        why: planned ? "Planned, not laid yet." : "Live; no feed reads its state here, so the pipe shows it as laid.",
        body: "",
        since: "",
        lastOk: null,
        facts: factsOf(c),
        needs: planned ? "Nothing yet: it's planned." : null,
        fix: null,
        steps: [],
        cap: null,
      });
    }

    // Its jobs on GitHub's clock.
    for (const j of jobs.filter((x) => JOB_ROOM[x.file] === r.id)) {
      const proper = /^(Deploy|CodeQL|Scorecard|Visual)\b/.test(j.name);
      const cause = jobCause(proper ? j.name : `The ${j.name.charAt(0).toLowerCase()}${j.name.slice(1)}`, j, now);
      const fault = cause.state === "leak" || cause.state === "shut" || cause.state === "late";
      pipes.push({
        id: `${r.id}:job-${j.file}`,
        room: r.id,
        name: j.name,
        what: `Scheduled on GitHub, ${j.when}`,
        kind: "job",
        state: cause.state,
        why: fault ? cause.title : cause.state === "dry" ? "No run seen yet." : `Passed, ${sinceWords(j.at, now) || "recently"}.`,
        body: fault ? cause.body : "",
        since: cause.since ?? sinceWords(j.at, now),
        lastOk: j.state === "pass" ? j.at : null,
        facts: { how: "A GitHub Actions workflow.", auth: "GitHub's own runner; secrets stay in GitHub.", when: j.when, kinds: ["Scheduled"] },
        needs: fault ? (cause.fix ? `${cause.fix.label}.` : null) : null,
        fix: fault ? (cause.fix ?? null) : null,
        steps: fault ? (cause.steps ?? []) : [],
        cap: null,
      });
    }

    // The Foundry also carries the security scans.
    if (r.id === "foundry") {
      const sc = map.stations.scans;
      if (sc) {
        const fault = sc.state === "leak" || sc.state === "shut" || sc.state === "late";
        pipes.push({
          id: "foundry:scans",
          room: r.id,
          name: "Security scans",
          what: "CodeQL, Scorecard, dependency review and the alerts",
          kind: "link",
          state: sc.state,
          why: fault ? sc.title : sc.state === "dry" ? "Waiting on GitHub." : `Flowing, ${sc.note}.`,
          body: fault ? sc.body : security ? `${security.reported - security.failing} of ${security.reported} passing, ${security.alerts ?? "–"} open alerts.` : "",
          since: sc.since,
          lastOk: null,
          facts: { how: "GitHub's code scanning, Dependabot and the OpenSSF Scorecard, read by the security feed.", auth: "A read-only GitHub token on the server.", when: "Every two minutes while the page is open.", kinds: ["REST API"] },
          needs: fault && sc.fix ? `${sc.fix.label}.` : null,
          fix: fault ? sc.fix : null,
          steps: fault ? sc.steps : [],
          cap: null,
        });
      }
    }

    return { id: r.id, name: r.name, sub: r.sub, c: ROOM_COLOUR[r.id] ?? ROOM_COLOUR.boiler!, flow: r.flow, pipes };
  });
}

/** A room's worst state. */
export const roomState = (s: RoomSection): StationState => s.pipes.reduce<StationState>((a, p) => (RANK[p.state] > RANK[a] ? p.state : a), "dry");

/** Every fault on the map, worst first, as the panel walks them. */
export function roomFaults(sections: RoomSection[]): (Fault & { pipe: string; room: string })[] {
  const out: (Fault & { pipe: string; room: string })[] = [];
  for (const s of sections)
    for (const p of s.pipes)
      if (p.state === "leak" || p.state === "shut" || p.state === "late")
        out.push({ id: p.id, pipe: p.id, room: s.id, station: p.id, kind: p.state, line: s.name, since: p.since, title: p.why, body: p.body, route: ["Boiler", s.name, p.name], fix: p.fix, steps: p.steps });
  return out.sort((a, b) => RANK[b.kind] - RANK[a.kind]);
}

/** Counts across the whole map. */
export function roomCounts(sections: RoomSection[]): Record<StationState, number> & { total: number } {
  const c = { ok: 0, late: 0, shut: 0, leak: 0, dry: 0, total: 0 };
  for (const s of sections) for (const p of s.pipes) {
    c[p.state]++;
    c.total++;
  }
  return c;
}

/* ── the layout ── */

export type V2 = readonly [number, number];

export interface PipeGeo {
  id: string;
  /** Where its branch leaves the header, and where its station stands. */
  root: V2;
  tip: V2;
}

export interface SectionGeo {
  id: string;
  /** The header pipe, from the trunk outward. */
  header: V2[];
  pipes: PipeGeo[];
  /** Where the room's name stands. */
  label: V2;
  /** The section's box on the floor: min x, min z, max x, max z. */
  box: [number, number, number, number];
}

export interface MapGeo {
  boiler: V2;
  /** The stubs from the boiler to each trunk, and the trunks. */
  trunks: V2[][];
  sections: SectionGeo[];
  box: [number, number, number, number];
}

/** Spacing along a header (a pair of branches, one up and one down, share each step), branch length, room pitch. */
export const STEP = 1.1;
export const BRANCH = 1.05;
export const PITCH = 3.3;
/** The most steps a header runs before it winds back on itself (#789), and the pitch between its runs. */
export const RUN = 6;
export const ROW = 3.4;
const TRUNK_X = 2.4;
const LEAD = 1.0;

/** How many runs a room's header winds through. */
export const runsOf = (pipes: number) => Math.max(1, Math.ceil(Math.max(1, Math.ceil(pipes / 2)) / RUN));

/**
 * Lay the rooms out as manifolds: half on each side of the boiler, sides balanced by how many pipes they carry, each
 * room a header running outward from its side's trunk, its branches alternating up and down in pairs. A header longer
 * than RUN steps winds back on itself (#789): out, down a run, back toward the trunk, and so on, so a big room (the
 * Foundry, the Archive) stays a block that fits the view instead of one long line.
 */
export function layout(sections: { id: string; pipes: { id: string }[] }[]): MapGeo {
  const sides: { ids: string[]; load: number }[] = [
    { ids: [], load: 0 },
    { ids: [], load: 0 },
  ];
  const order = sections.map((s, i) => ({ s, i })).sort((a, b) => b.s.pipes.length - a.s.pipes.length || a.i - b.i);
  for (const { s } of order) {
    const side = sides[0]!.load <= sides[1]!.load ? sides[0]! : sides[1]!;
    side.ids.push(s.id);
    side.load += runsOf(s.pipes.length) * ROW + PITCH;
  }
  // Within a side keep the rack's order.
  for (const side of sides) side.ids.sort((a, b) => sections.findIndex((s) => s.id === a) - sections.findIndex((s) => s.id === b));

  const out: SectionGeo[] = [];
  const trunks: V2[][] = [];
  let box: [number, number, number, number] = [-2, -2, 2, 2];
  const grow = (b: [number, number, number, number]) => (box = [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])]);
  sides.forEach((side, si) => {
    const sx = si === 0 ? 1 : -1;
    const n = side.ids.length;
    if (!n) return;
    // Each room's first run, stacked down the side with its wound runs under it, the side centred on the boiler.
    const tops: number[] = [];
    let z = 0;
    for (const id of side.ids) {
      tops.push(z);
      z += (runsOf(sections.find((x) => x.id === id)!.pipes.length) - 1) * ROW + PITCH;
    }
    const last = side.ids[n - 1]!;
    const span = tops[n - 1]! + (runsOf(sections.find((x) => x.id === last)!.pipes.length) - 1) * ROW;
    const zs = tops.map((t) => t - span / 2);
    trunks.push([
      [sx * 1.35, 0],
      [sx * TRUNK_X, 0],
    ]);
    if (n > 1)
      trunks.push([
        [sx * TRUNK_X, Math.min(0, zs[0]!)],
        [sx * TRUNK_X, Math.max(0, zs[n - 1]!)],
      ]);
    side.ids.forEach((id, i) => {
      const s = sections.find((x) => x.id === id)!;
      const z0 = zs[i]!;
      const steps = Math.max(1, Math.ceil(s.pipes.length / 2));
      const runs = runsOf(s.pipes.length);
      const full = Math.min(steps, RUN);
      const inner = TRUNK_X + LEAD - 0.55;
      const outer = TRUNK_X + LEAD + (full - 1) * STEP + 0.6;
      const xAt = (step: number) => {
        const r = Math.floor(step / RUN);
        const j = step % RUN;
        return TRUNK_X + LEAD + (r % 2 ? RUN - 1 - j : j) * STEP;
      };
      const pipes: PipeGeo[] = s.pipes.map((p, k) => {
        const step = Math.floor(k / 2);
        const z = z0 + Math.floor(step / RUN) * ROW;
        const dz = k % 2 ? BRANCH : -BRANCH;
        return { id: p.id, root: [sx * xAt(step), z], tip: [sx * xAt(step), z + dz] };
      });
      // The header: out along the first run, then turning at each end into the next.
      const header: V2[] = [[sx * TRUNK_X, z0]];
      for (let r = 0; r < runs; r++) {
        const z = z0 + r * ROW;
        const lastRun = r === runs - 1;
        const left = steps - r * RUN;
        const endX = lastRun && runs > 1 ? xAt(r * RUN + Math.min(RUN, left) - 1) + (r % 2 ? -0.6 : 0.6) : r % 2 ? inner : outer;
        header.push([sx * (r === 0 ? TRUNK_X : r % 2 ? outer : inner), z]);
        header.push([sx * endX, z]);
      }
      const tidy = header.filter((p, k) => k === 0 || p[0] !== header[k - 1]![0] || p[1] !== header[k - 1]![1]);
      const z1 = z0 + (runs - 1) * ROW;
      // The box takes in the room's name past the header's end.
      const far = sx * (outer + 2.6);
      const b: [number, number, number, number] = [Math.min(sx * TRUNK_X, far), z0 - BRANCH - 0.7, Math.max(sx * TRUNK_X, far), z1 + BRANCH + 0.5];
      grow(b);
      out.push({ id, header: tidy, pipes, label: [sx * (outer + 1.2), z0], box: b });
    });
  });
  // Keep the input's order.
  out.sort((a, b) => sections.findIndex((s) => s.id === a.id) - sections.findIndex((s) => s.id === b.id));
  return { boiler: [0, 0], trunks, sections: out, box };
}
