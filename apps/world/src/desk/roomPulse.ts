import type { HistoryEntry, RoomId, WorldFeed } from "../chronicle.ts";
import { CREW, crewOf, openIdeas, shippedToday, type FoundryData } from "../foundry.ts";
import type { Link, LinkState } from "../systems.ts";
import type { GreenBoard, GreenStatus } from "./green/league.ts";

/**
 * The rooms as the Weave Desk draws them (Nikita, 2026-10-22): nine threads, one per room, each in its submind's
 * colour (docs/SKIPPY.md), with how busy it is, a short status and its submind's report for the Council. Built only
 * from real data: the Foundry from GitHub, the Relay and the Boiler Room from the links, the Archive from the living
 * Lattice's hours, the Green from Nikita's Sleeper league (#252). Rooms with no real work connected yet say so plainly; their only knots are the scenes the hourly
 * step set there (real entries of the living Lattice, not samples). Deterministic templates, no API calls.
 */

export type PulseState = "busy" | "steady" | "waiting" | "down" | "sim";

export interface RoomPulse {
  id: RoomId;
  name: string;
  /** CSS colour (a Desk token). */
  colour: string;
  /** The room's submind: its portrait id and title. */
  submind: { id: string; title: string };
  /** Whether real work is connected for this room (else it is simulated for now). */
  real: boolean;
  state: PulseState;
  /** 0..1, how much is happening: the thread's weight and its particles. */
  activity: number;
  /** A few words for the thread's label: "Rusty is building", "Waiting on the Mac". */
  status: string;
  /** Fewer words, lower case, for the fan beside Today's greeting: "mid-build", "steady", "not set up". */
  short: string;
  /** The submind's report, in its own voice: one or two short sentences, numbers from real data. */
  report: string;
  /** Times (Date.now() style) of today's real events in the room: the knots on its thread. */
  events: number[];
  /** Where the room opens on the Desk (or the Lattice). */
  href: string;
}

export const ROOM_ORDER: readonly RoomId[] = ["foundry", "relay", "boiler", "archive", "breakroom", "spire", "exchange", "green", "workshop"];

export const ROOM_META: Record<RoomId, { name: string; colour: string; submind: { id: string; title: string }; href: string }> = {
  foundry: { name: "Foundry", colour: "var(--room-foundry)", submind: { id: "ember", title: "The Builder" }, href: "/foundry" },
  relay: { name: "Relay", colour: "var(--room-relay)", submind: { id: "static", title: "The Messenger" }, href: "/relay" },
  boiler: { name: "Boiler Room", colour: "var(--room-boiler)", submind: { id: "soot", title: "The Pessimist" }, href: "/boiler" },
  archive: { name: "Archive", colour: "var(--room-archive)", submind: { id: "vellum", title: "The Historian" }, href: "/archive" },
  breakroom: { name: "Break Room", colour: "var(--room-breakroom)", submind: { id: "fizz", title: "The Life of the Party" }, href: "/lattice?room=breakroom" },
  spire: { name: "Spire", colour: "var(--room-spire)", submind: { id: "gilt", title: "The Executive" }, href: "/spire" },
  exchange: { name: "Exchange", colour: "var(--room-exchange)", submind: { id: "ticker", title: "The Bookie" }, href: "/exchange" },
  green: { name: "Green", colour: "var(--room-green)", submind: { id: "turf", title: "The Commentator" }, href: "/green" },
  workshop: { name: "Workshop", colour: "var(--room-workshop)", submind: { id: "putty", title: "The Artiste" }, href: "/workshop" },
};

/** The simulated rooms' honest reports, each in its submind's voice: nothing real is connected there yet. */
const SIM_REPORT: Partial<Record<RoomId, string>> = {
  breakroom: "Nothing real to report yet. The party is simulated; the enthusiasm is not.",
  spire: "Nothing real to report yet. The books aren't connected, which is, frankly, an untapped opportunity.",
  exchange: "Nothing real to report yet. Odds the markets get connected this week? I'd rather not quote them.",
  green: "NOTHING REAL TO CALL YET, FOLKS. The league isn't connected, so the scoreboard stays dark.",
  workshop: "Nothing real yet. The model pipeline isn't connected, so I'm between pieces. Suffering, beautifully.",
};

export interface PulseInput {
  now: number;
  /** Midnight today, local: what "today" counts from. */
  dayStart: number;
  /** Where the threads' knots start (the day's strip shows the last several hours, across midnight). */
  since?: number;
  foundry: { connected: boolean; data: FoundryData; pending: FoundryData["crates"] };
  links: Link[];
  hub: LinkState;
  /** Replies waiting on Nikita (Relay), once the hub is connected. */
  owed: number;
  world: WorldFeed | null;
  /** The Green's league board (desk/green/league.ts), once it has been asked for; left out, the Green stays simulated. */
  green?: { status: GreenStatus; board: GreenBoard | null };
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
const clamp = (v: number) => Math.max(0, Math.min(1, v));

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The living Lattice's hours today, and the rooms its scenes were set in. */
function worldToday(world: WorldFeed | null, dayStart: number): HistoryEntry[] {
  return (world?.recent ?? []).filter((e) => Date.parse(e.at) >= dayStart);
}

export function roomPulses(input: PulseInput): RoomPulse[] {
  const { now, dayStart, foundry, links, hub, owed, world } = input;
  const since = input.since ?? dayStart;
  const today = worldToday(world, dayStart);
  const recent = worldToday(world, since);
  const scenesIn = (room: RoomId) => recent.filter((e) => e.scenes.some((s) => s.room === room)).map((e) => Date.parse(e.at));

  const pulse = (id: RoomId, p: Omit<RoomPulse, "id" | "name" | "colour" | "submind" | "href">): RoomPulse => ({ id, ...ROOM_META[id], ...p });
  const out: RoomPulse[] = [];

  // The Foundry: GitHub's issues and the changelog.
  {
    const { data, connected, pending } = foundry;
    const crates = data.crates;
    const working = crates.filter((c) => c.kind !== "idea" && c.state === "working");
    const waiting = openIdeas(crates, pending).filter((c) => !c.revising).length + crates.filter((c) => c.kind !== "idea" && (c.state === "ready" || c.state === "stuck")).length;
    const shipped = shippedToday(data.changelog, now);
    const events = [...data.changelog.map((c) => c.at), ...working.map((c) => c.updatedAt)].filter((t) => t >= since && t <= now);
    const who = working[0] ? CREW[crewOf(working[0], crates)].name : null;
    const red = data.checks.state === "fail";
    if (!connected) {
      out.push(pulse("foundry", { real: true, state: "waiting", activity: 0.1, status: "Reaching GitHub", short: "reaching GitHub", report: "Can't see the shop floor yet. GitHub hasn't answered. I'll wait. I hate waiting.", events }));
    } else {
      const parts = [
        working.length ? `${n(working.length, "job")} on the bench${who ? `, ${who} at the furnace` : ""}` : "Nothing on the bench",
        waiting ? `${waiting} waiting on you` : "nothing waiting on you",
        `${shipped} shipped today`,
      ];
      out.push(
        pulse("foundry", {
          real: true,
          state: red ? "down" : working.length ? "busy" : "steady",
          activity: clamp(0.25 + working.length * 0.3 + shipped * 0.08),
          status: red ? "Checks on main are red" : who ? `${who} is building` : waiting ? `${n(waiting, "thing")} waiting on you` : "All clear",
          short: red ? "checks red" : who ? "mid-build" : waiting ? `${waiting} waiting on you` : "all clear",
          report: `${parts.join(", ")}. ${red ? "Main's red. Rivet's already on it." : "Checks are green. Don't touch anything."}`,
          events,
        }),
      );
    }
  }

  // The Relay: the hub on the MacBook.
  if (hub === "off") {
    out.push(pulse("relay", { real: true, state: "waiting", activity: 0.05, status: "Waiting on the Mac", short: "waiting on the Mac", report: "Psst. I can't hear a thing yet: the hub on the MacBook isn't connected. The moment it is, you'll know who's waiting on you.", events: [] }));
  } else {
    out.push(
      pulse("relay", {
        real: true,
        state: hub === "down" ? "down" : owed ? "busy" : "steady",
        activity: clamp(0.25 + owed * 0.12),
        status: hub === "down" ? "The hub is down" : owed ? `${n(owed, "reply", "replies")} waiting` : "Nobody waiting",
        short: hub === "down" ? "hub down" : owed ? `${owed} waiting` : "all quiet",
        report: hub === "down" ? "The hub went quiet. What you see is from before. Somebody check the Mac." : owed ? `${n(owed, "person", "people")} waiting on a reply from you. I know who. I won't say it out loud.` : "Nobody's waiting on you. I checked. Twice.",
        events: [],
      }),
    );
  }

  // The Boiler Room: every link the Desk watches.
  {
    const known = links.filter((l) => l.state !== "off");
    const up = known.filter((l) => l.state === "ok").length;
    const down = known.filter((l) => l.state === "down").length;
    const slow = known.filter((l) => l.state === "slow").length;
    const off = links.length - known.length;
    out.push(
      pulse("boiler", {
        real: true,
        state: down ? "down" : known.length ? "steady" : "waiting",
        activity: clamp(0.15 + up * 0.05),
        status: down ? `${n(down, "link")} down` : slow ? `${n(slow, "link")} slow` : `${up} of ${links.length} links up`,
        short: down ? `${down} down` : slow ? `${slow} slow` : known.length ? "steady" : "waiting",
        report: down
          ? `${n(down, "link")} down. I said this would happen. I take no pleasure in it.`
          : `${up} links up${slow ? `, ${slow} slow` : ""}${off ? `, ${off} not connected yet` : ""}. Nothing's burst. Yet.`,
        events: [],
      }),
    );
  }

  // The Archive: the living Lattice's hours, written by the step.
  {
    const events = recent.map((e) => Date.parse(e.at));
    const last = today.at(-1);
    out.push(
      pulse("archive", {
        real: true,
        state: !world ? "waiting" : today.length ? "steady" : "waiting",
        activity: clamp(0.15 + today.length * 0.04),
        status: !world ? "Opening the record" : today.length ? `${n(today.length, "hour")} written today` : "No hours yet today",
        short: !world ? "opening the record" : today.length ? "writing it down" : "no hours yet",
        report: !world
          ? "The record hasn't opened yet. Patience is a scholarly virtue."
          : last
            ? `${n(today.length, "hour")} of Ilyr written today, the latest at ${timeOf(Date.parse(last.at))}${last.source === "claude" ? ", by Claude" : ", from the agents' own lines"}. For the record.`
            : "No hours written today yet. The first one usually lands within the hour.",
        events,
      }),
    );
  }

  // The Green: Nikita's Sleeper league, when the board has been read (or is being read).
  const green = input.green;
  const greenReal = green && green.status !== "off";
  if (greenReal) out.push(greenPulse(green, scenesIn("green"), pulse));

  for (const id of ["breakroom", "spire", "exchange", "green", "workshop"] as const) {
    if (id === "green" && greenReal) continue;
    const events = scenesIn(id);
    out.push(
      pulse(id, {
        real: false,
        state: "sim",
        activity: clamp(0.04 + events.length * 0.05),
        status: events.length ? `${n(events.length, "scene")} in Ilyr lately` : "Not set up yet",
        short: "not set up",
        report: `${SIM_REPORT[id]}${events.length ? ` In Ilyr, ${n(events.length, "scene")} here lately.` : ""}`,
        events,
      }),
    );
  }

  return ROOM_ORDER.map((id) => out.find((p) => p.id === id)!);
}

type PulseFn = (id: RoomId, p: Omit<RoomPulse, "id" | "name" | "colour" | "submind" | "href">) => RoomPulse;

/** The Green's thread from the league board, in the Commentator's voice. */
function greenPulse(green: NonNullable<PulseInput["green"]>, events: number[], pulse: PulseFn): RoomPulse {
  const { status, board } = green;
  if (status === "failed") return pulse("green", { real: true, state: "down", activity: 0.1, status: "Sleeper isn't answering", short: "Sleeper down", report: "WE'VE LOST THE FEED, FOLKS. Sleeper isn't answering. Stay with us.", events });
  if (status === "absent") return pulse("green", { real: true, state: "waiting", activity: 0.05, status: "No team in the league", short: "no team", report: "The Commentator can't find your team in the league. A broadcast with no home side. Unthinkable.", events });
  if (status !== "ready" || !board) return pulse("green", { real: true, state: "waiting", activity: 0.1, status: "Reading the league", short: "reading Sleeper", report: "Warming up the booth. Sleeper's on the line.", events });
  const m = board.matchup;
  const win = m?.win ?? null;
  const pctWin = win === null ? null : `${Math.round(win * 100)}%`;
  const calls = board.swaps.length;
  const top = board.pickups[0]?.player.name;
  const match = !m
    ? `No game in week ${board.week}.`
    : !m.them
      ? `Bye in week ${board.week}.`
      : m.live
        ? `LIVE: ${m.me.pts.toFixed(1)} to ${m.them.pts.toFixed(1)} against ${m.them.team}${pctWin ? `, ${pctWin} to win` : ""}.`
        : `Week ${m.week} against ${m.them.team}: projected ${m.me.proj.toFixed(1)} to ${m.them.proj.toFixed(1)}${pctWin ? `, ${pctWin} to win` : ""}.`;
  const lineup = calls ? `${calls === 1 ? "One lineup call" : `${calls} lineup calls`} from the booth.` : "Lineup's set.";
  return pulse("green", {
    real: true,
    state: m?.live || calls ? "busy" : "steady",
    activity: clamp(0.3 + (m?.live ? 0.35 : 0) + calls * 0.1),
    status: pctWin ? `Week ${board.week}: ${pctWin} to win` : `${board.me.team}, ${board.me.record}`,
    short: m?.live ? "game on" : pctWin ? `${pctWin} to win` : board.me.record,
    report: `${board.me.team.toUpperCase()}, ${board.me.record}. ${match} ${lineup}${top ? ` Top pickup: ${top}.` : ""}`,
    events,
  });
}

/** Skippy's opening line on Today: what needs a human, said his way. */
export function skippyLine(todo: number, pulses: RoomPulse[]): string {
  const down = pulses.filter((p) => p.state === "down");
  const busy = pulses.filter((p) => p.state === "busy");
  const lead =
    todo === 0
      ? "Nothing needs a human right now. I handled the rest, naturally."
      : todo === 1
        ? "One thing needs a human. Everything else I handled while you were out."
        : `${cap(words(todo))} things need a human, in the order I'd do them. Everything else I handled.`;
  const tail = down.length ? ` ${down.map((p) => p.name).join(" and ")} ${down.length === 1 ? "needs" : "need"} a look.` : busy.length ? ` ${busy.map((p) => p.name).join(" and ")} ${busy.length === 1 ? "is" : "are"} hard at work.` : "";
  return lead + tail;
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
/** A count in words up to twelve, then figures. */
export const words = (k: number) => WORDS[k] ?? String(k);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The rooms with real work, said the way Skippy would in passing: "the Foundry's mid-build". */
export function roomPhrase(p: RoomPulse): string {
  switch (p.id) {
    case "foundry":
      return p.state === "down" ? "the Foundry's checks are red" : p.state === "busy" ? "the Foundry's mid-build" : p.state === "waiting" ? "the Foundry's reaching GitHub" : "the Foundry's all clear";
    case "boiler":
      return p.state === "down" ? `${p.short} in the Boiler Room` : p.state === "waiting" ? "the Boiler Room's waiting on its gauges" : "all quiet in the Boiler Room";
    case "relay":
      return p.state === "waiting" ? "the Relay's waiting on the Mac" : p.state === "down" ? "the Relay's hub is down" : p.state === "busy" ? `${p.short} in the Relay` : "the Relay's quiet";
    case "archive":
      return p.state === "waiting" ? "the Archive's waiting on the hours" : "the Archive's writing it down";
    case "green":
      if (!p.real) return `${p.name}: ${p.short}`;
      return p.state === "down" ? "the Green's lost Sleeper" : p.state === "waiting" ? "the Green's reading the league" : p.short === "game on" ? "the Green's game is on" : p.short.endsWith("to win") ? `the Green has you at ${p.short}` : `the Green has you ${p.short}`;
    default:
      return `${p.name}: ${p.short}`;
  }
}

/** "Evening, Nikita." by the hour. */
export function greeting(now: number): string {
  const h = new Date(now).getHours();
  return h < 5 ? "Still up, Nikita." : h < 12 ? "Morning, Nikita." : h < 18 ? "Afternoon, Nikita." : "Evening, Nikita.";
}

/** Ilyr's part of the day, from the local hour. */
export function partOfDay(now: number): string {
  const h = new Date(now).getHours();
  return h < 5 ? "night" : h < 12 ? "morning" : h < 18 ? "afternoon" : h < 22 ? "evening" : "night";
}
