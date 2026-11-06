/**
 * The home as Skippy reads it (#926): every device in a few spoken lines, the thermostat first, for the `home_status`
 * tool (rooms/haven/tools.ts), the call's `read_haven` lookup and the brain's quick tier ("what's the temperature in
 * the apartment?").
 *
 * Instant on purpose: the vendors' clouds can take seconds on a cold instance (Nest's SDM, Petlibro's and Whisker's
 * logins), so every good read the Home makes also keeps these lines in the private store (`SNAPSHOT_PATH`, at most once
 * a minute per instance). A read that isn't back inside `LIVE_WAIT_MS` answers from the kept lines with their age, and
 * the live read carries on to warm the Home's own 30-second cache for the next ask.
 *
 * Never a device's own name, serial or place; whole °F, percents and fixed words only.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../../_blob.js";
import { clockWords } from "./rails.js";
import { dryNextWords, vacScheduleWords, wetNextWords } from "./schedule.js";
import type { DeviceReading } from "./types.js";

/** Where the last good lines are kept. */
export const SNAPSHOT_PATH = "haven/devices/home-lines.json";
/** How long a live read may take before the kept lines answer. */
export const LIVE_WAIT_MS = 1_500;
/** How often one instance writes the kept lines, at most. */
export const SNAPSHOT_EVERY_MS = 60_000;
/** Kept lines older than this are said with their age. */
const FRESH_MS = 2 * 60_000;
/** Kept lines older than this aren't used. */
const STALE_MS = 6 * 60 * 60_000;

/** What the read needs from the Home's view. */
export interface HomeLook {
  vendors: Record<string, "waiting" | "live" | "down">;
  devices: DeviceReading[];
}

const MODE: Record<string, string> = { heat: "heat", cool: "cool", heatcool: "keep between", off: "off" };

/** The thermostat in one spoken sentence. */
export function climateLine(d: DeviceReading): string {
  if (!d.online) return "The thermostat is offline right now.";
  const inside = typeof d.tempF === "number" ? `It's ${d.tempF}°F inside${typeof d.humidity === "number" ? ` with ${d.humidity}% humidity` : ""}` : "The thermostat isn't giving a temperature";
  let set = "";
  if (d.eco) set = "the thermostat is in eco";
  else if (d.mode === "off") set = "the heating and cooling are off";
  else if (d.mode === "heatcool" && typeof d.heatF === "number" && typeof d.coolF === "number") set = `the thermostat keeps it between ${d.heatF} and ${d.coolF}°F`;
  else if (d.mode === "heat" && typeof d.heatF === "number") set = `the heat is set to ${d.heatF}°F`;
  else if (d.mode === "cool" && typeof d.coolF === "number") set = `the AC is set to ${d.coolF}°F`;
  else if (d.mode) set = `the thermostat is on ${MODE[d.mode] ?? d.mode}`;
  const now = d.hvac === "heating" ? " and it's heating now" : d.hvac === "cooling" ? " and it's cooling now" : "";
  return `${inside}${set ? `; ${set}${now}` : ""}.`;
}

/** One device in a short line, with when it runs next where it has a schedule (#952). */
function deviceLine(d: DeviceReading, now: number): string {
  if (d.kind === "thermostat") return climateLine(d);
  const off = !d.online;
  const alerts = d.alerts.length ? ` (${d.alerts.slice(0, 2).join(", ")})` : "";
  switch (d.kind) {
    case "vacuum":
      return `${off ? "The vacuum is offline." : `The vacuum is ${d.state}${typeof d.battery === "number" ? `, battery ${d.battery}%` : ""}${alerts}.`}${d.schedule ? ` ${vacScheduleWords(d, now)}` : ""}`;
    case "dry-feeder":
      return off ? "The dry food feeder is offline." : `The dry food feeder is ${d.state}${typeof d.fedPortions === "number" ? `, ${d.fedPortions} portions out today` : ""}${d.foodLow ? ", food low" : ""}${alerts}.${d.plan ? ` ${dryNextWords(d)}` : ""}`;
    case "wet-feeder": {
      if (off) return "The wet food feeder is offline.";
      const closes = d.closesAt ? mountainClock(d.closesAt) : "";
      const lid = d.state === "lid open" ? `the lid is open${closes ? `, closing itself at ${clockWords(closes)}` : ""}` : `the lid is ${d.state}`;
      // When the next meal is (#952): the plan, the device list's own next meal, or plainly why there's none.
      const next = wetNextWords(d);
      return `The wet food feeder: ${lid}${d.plate ? `, bowl ${d.plate} in front` : ""}${alerts}.${next ? ` ${next}` : ""}`;
    }
    case "fountain":
      return off ? "The fountain is offline." : `The fountain is ${d.state}${typeof d.water === "number" ? `, water ${d.water}%` : ""}${typeof d.filter === "number" ? `, filter ${d.filter}%` : ""}${alerts}.`;
    case "litter":
      return off ? "The Litter-Robot is offline." : `The Litter-Robot is ${d.state}${typeof d.drawer === "number" ? `, drawer ${d.drawer}% full` : ""}${alerts}.`;
  }
}

/** "HH:MM" in Mountain time from an ISO instant. */
function mountainClock(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Denver", hour: "2-digit", minute: "2-digit", hour12: false }).format(t);
}

const VENDOR: Record<string, string> = { roborock: "the vacuum's cloud (Roborock)", petlibro: "the feeders' cloud (Petlibro)", whisker: "the Litter-Robot's cloud (Whisker)", nest: "the thermostat's cloud (Google Nest)" };

/** The home in lines: the thermostat first, then each device; a vendor that's down or not connected says so. */
export function homeText(view: HomeLook, now = Date.now()): string {
  const lines = view.devices.map((d) => deviceLine(d, now));
  if (!view.devices.some((d) => d.kind === "thermostat")) {
    const nest = view.vendors.nest;
    lines.unshift(nest === "down" ? "The thermostat's cloud (Google Nest) isn't answering, so there's no temperature right now." : "The thermostat isn't connected yet (Connect Nest in the Boiler Room's Controls), so there's no temperature.");
  }
  for (const [v, s] of Object.entries(view.vendors)) if (s === "down" && v !== "nest") lines.push(`${VENDOR[v] ?? v} isn't answering right now.`);
  return lines.join("\n");
}

/** The lines that start each device's, for picking one out (#952). */
const LEADS: Record<"wet-feeder" | "dry-feeder" | "vacuum", RegExp> = { "wet-feeder": /^The wet food feeder/, "dry-feeder": /^The dry food feeder/, vacuum: /^The vacuum/ };

/**
 * One device's line out of the home's lines, or both feeders' (#952), with any "As of" note kept; when the device
 * isn't in them, the vendor's own line (down, not connected) or a plain word that it isn't answering.
 */
export function deviceOf(text: string, about: "wet-feeder" | "dry-feeder" | "vacuum" | "feeders"): string {
  const lines = text.split("\n");
  const asOf = lines[0]?.startsWith("As of ") ? `${lines[0]} ` : "";
  const want = about === "feeders" ? [LEADS["wet-feeder"], LEADS["dry-feeder"]] : [LEADS[about]];
  const got = lines.filter((l) => want.some((w) => w.test(l)));
  if (got.length) return `${asOf}${got.join(" ")}`;
  const cloud = about === "vacuum" ? /Roborock/ : /Petlibro/;
  return lines.find((l) => cloud.test(l)) ?? (about === "vacuum" ? "The vacuum didn't answer just now." : "The feeders didn't answer just now.");
}

/** The thermostat's line out of the home's lines (the first one, by construction). */
export const climateOf = (text: string): string => text.split("\n")[0] ?? text;

/* ── The kept lines ── */

interface Kept {
  at: number;
  text: string;
}

export async function readKept(blob: BlobBackend): Promise<Kept | null> {
  const found = await blob.get(SNAPSHOT_PATH).catch(() => null);
  if (!found) return null;
  const raw = (await new Response(found.stream).json().catch(() => null)) as Partial<Kept> | null;
  return raw && typeof raw.at === "number" && typeof raw.text === "string" && raw.text.length <= 4_000 ? { at: raw.at, text: raw.text } : null;
}

let wroteAt = 0;
/** Test seam. */
export const forgetKeptWrite = () => {
  wroteAt = 0;
};

/** Keeps the lines of a good read, at most once a minute per instance. Best effort: never throws. */
export async function keepLines(blob: BlobBackend, view: HomeLook, now: number): Promise<void> {
  if (now - wroteAt < SNAPSHOT_EVERY_MS || !view.devices.length) return;
  wroteAt = now;
  await blob.put(SNAPSHOT_PATH, JSON.stringify({ at: now, text: homeText(view) }), { contentType: "application/json", addRandomSuffix: false, allowOverwrite: true }).catch(() => undefined);
}

const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} minute${m === 1 ? "" : "s"} ago` : `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? "" : "s"} ago`;
};

/**
 * The home's lines, fast: the live view when it is back inside `waitMs`, else the kept lines (with their age when not
 * fresh), else the live view however long it takes. `live` is the Home's status (its own 30-second cache first).
 */
export async function homeNow(live: () => Promise<HomeLook>, blob: BlobBackend | null, now: number, waitMs = LIVE_WAIT_MS): Promise<string> {
  const run = live().then(
    (view) => {
      if (blob) void keepLines(blob, view, Date.now());
      return homeText(view);
    },
    () => null,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), waitMs);
  });
  const first = await Promise.race([run, late]).finally(() => clearTimeout(timer));
  if (first !== "late" && first !== null) return first;
  const kept = blob ? await readKept(blob) : null;
  if (kept && now - kept.at < STALE_MS) return now - kept.at < FRESH_MS ? kept.text : `As of ${ago(now - kept.at)}:\n${kept.text}`;
  if (first === "late") {
    const got = await run;
    if (got) return got;
  }
  return "The home devices aren't answering right now: none of their clouds came back, and there's no recent reading kept.";
}
