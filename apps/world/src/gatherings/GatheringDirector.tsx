import { pendingApprovals } from "@ceo/core";
import { isSubmind } from "@ceo/simulator";
import { useEffect } from "react";
import { useCast } from "../cast/castStore.ts";
import { clock } from "../clock.ts";
import { readingTime, simulator, useWorld, type CampaignCostume } from "../store.ts";
import { COSTUME_PARTY, isHalloweenNight } from "../veil/veil.ts";
import { chronicleDay } from "../chronicle.ts";
import { GATHERINGS, GATHERING_BY_ID, type GatheringDef, type Line, type PlayCtx } from "./gatherings.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const shuffle = <T,>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
/** The first gathering after opening the Lattice: soon enough to see one, not right away. */
const FIRST_AFTER = 3 * 60_000;
/** Gap between the Lattice's own gatherings: 30-36 minutes, so never more than two an hour. */
const EVERY = [30 * 60_000, 36 * 60_000] as const;
/** Reading time for a line that's written when it's spoken (a dice result): assume a longish sentence. */
const LAZY_MS = readingTime("x".repeat(80));
const lineMs = (l: Line) => (typeof l.text === "string" ? readingTime(l.text) : LAZY_MS) + (l.roll ? 1400 : 0) + 700;

/** How often the director checks whether Halloween night has begun or ended. */
const VEIL_CHECK_MS = 60_000;

/** At most this many gatherings at once. Starting another ends the oldest. */
export const MAX_GATHERINGS = 2;

/** Who's in: a host who likes this, then the host's friends (wherever they are), then whoever's free. */
function castFor(def: GatheringDef, busy: Set<string>): { host: string; guests: string[] } | null {
  const { lattice } = useWorld.getState();
  const { cast } = useCast.getState();
  const waiting = new Set(pendingApprovals(lattice).map((p) => p.request.agentId));
  // The subminds stay at their posts keeping watch; they conduct a gathering, they don't join it.
  const free = Object.keys(lattice.agents).filter((id) => !waiting.has(id) && !busy.has(id) && !isSubmind(id));
  const local = shuffle(free.filter((id) => lattice.agents[id]?.place.room === def.room));
  const host = def.hosts.find((id) => free.includes(id)) ?? local[0] ?? shuffle(free)[0];
  if (!host) return null;
  const friends = cast.relationships
    .filter((r) => (r.a === host || r.b === host) && r.kind !== "nemesis" && r.kind !== "ex")
    .map((r) => (r.a === host ? r.b : r.a));
  const pool = [...shuffle(friends), ...shuffle(free)].filter((id, i, all) => id !== host && free.includes(id) && all.indexOf(id) === i);
  const n = Math.min(def.seats.length - 1, def.guests[0] + Math.floor(Math.random() * (def.guests[1] - def.guests[0] + 1)));
  const guests = pool.slice(0, n);
  return guests.length >= def.guests[0] ? { host, guests } : null;
}

export interface StartResult {
  ok: boolean;
  /** Gatherings that were ended to make room (same room, or the oldest when two were already on). */
  ended: string[];
}

/** Lets the rest of the world (the Kernel console, the decks) start or end gatherings. Set by the director. */
export const gatheringControl = {
  start: (_id: string): StartResult => ({ ok: false, ended: [] }),
  /** End one gathering, or all of them, and send everyone back to their routine. Returns how many ended. */
  end: (_id?: string): number => 0,
};

interface Running {
  def: GatheringDef;
  members: string[];
  timers: ReturnType<typeof setTimeout>[];
}

/**
 * Starts gatherings now and then: sends the cast to their seats through the simulator, plays the scene's
 * script once they've arrived, and lets the Kernel have its say. Up to two can run at once, one per room; the
 * Lattice only starts one on its own when nothing else is on. Renders nothing.
 */
export function GatheringDirector() {
  useEffect(() => {
    const running = new Map<string, Running>();

    /** End a gathering: cancel its scene, undress and release its cast. `release` sends them back to work. */
    const stop = (id: string, release: boolean) => {
      const r = running.get(id);
      if (!r) return false;
      r.timers.forEach(clearTimeout);
      running.delete(id);
      const w = useWorld.getState();
      if (release) for (const a of r.members) simulator.assign(a, [{ kind: "set", activity: "idle", prop: null }], clock.sim);
      w.dropGathering(id);
      w.undress(r.members);
      return true;
    };

    /** `auto`: the party opened itself (Skippy's line); `again`: it is carrying on, so nobody announces it twice. */
    const start = (def: GatheringDef, opened: "called" | "auto" | "again" = "called"): StartResult => {
      const ended: string[] = [];
      if (running.has(def.id)) return { ok: false, ended };
      // One per room, and at most two at once: make room before casting, so the freed agents can join.
      const toEnd = [...running.values()].filter((r) => r.def.room === def.room).map((r) => r.def.id);
      const others = [...running.keys()].filter((id) => !toEnd.includes(id));
      // Map keeps insertion order, so the first left over is the oldest.
      while (others.length >= MAX_GATHERINGS) toEnd.push(others.shift()!);
      const busyOf = () => new Set(others.flatMap((id) => running.get(id)!.members));
      let who = castFor(def, busyOf());
      // Still short of players: the oldest gathering breaks up too, and its people come along.
      while (!who && others.length) {
        toEnd.push(others.shift()!);
        who = castFor(def, busyOf());
      }
      if (!who) return { ok: false, ended };
      for (const id of toEnd) if (stop(id, true)) ended.push(id);
      const r: Running = { def, members: [who.host, ...who.guests], timers: [] };
      running.set(def.id, r);
      const later = (fn: () => void, ms: number) => r.timers.push(setTimeout(fn, ms));

      const world = useWorld.getState();
      const name = (id: string) => useCast.getState().cast.profiles[id]?.name ?? id;
      const costumes: CampaignCostume[] = def.costumes ? shuffle([...def.costumes]).slice(0, who.guests.length) : [];
      const script = def.compose ? def.compose(costumes) : pick(def.scripts ?? [[]]);
      // Hold long enough for the whole scene, in Lattice time.
      const sceneMs = script.reduce((sum, l) => sum + lineMs(l), 0);
      const holdSim = (sceneMs + 25_000) * world.timeScale;
      const everyone = r.members;
      world.putGathering({ id: def.id, room: def.room, host: who.host, guests: who.guests, since: performance.now(), live: false });
      if (costumes.length) world.dress(Object.fromEntries(who.guests.map((id, i) => [id, costumes[i]!])));
      if (def.dressAll) world.dress(Object.fromEntries(everyone.flatMap((id) => (def.dressAll!(id) ? [[id, def.dressAll!(id)!]] : []))));
      everyone.forEach((id, i) => {
        const host = i === 0;
        const activity = def.seatActivities?.[i] ?? (host ? def.hostActivity : def.guestActivity);
        simulator.assign(
          id,
          [
            { kind: "go", station: def.seats[i]!, room: def.room },
            { kind: "do", activity, ms: holdSim, prop: host ? (def.hostProp ?? null) : null },
            { kind: "do", activity: "celebrating", ms: 1800, prop: null },
            { kind: "set", activity: "idle", prop: null },
          ],
          clock.sim,
        );
      });
      if (opened !== "again") {
        world.announce(
          pick(opened === "auto" && def.kernelAuto ? def.kernelAuto : def.kernel)
            .replace("{host}", name(who.host))
            .replace("{guests}", who.guests.map(name).join(", ")),
          "status",
          def.room,
        );
      }

      // Play the scene once the host has taken their seat (give up after a minute).
      const seated = (id: string, seat: string) => {
        const rt = useWorld.getState().lattice.agents[id];
        return rt?.place.station === seat && (!rt.motion || clock.sim >= rt.motion.startTs + rt.motion.duration);
      };
      let waited = 0;
      const begin = () => {
        if (!seated(who.host, def.seats[0]!) && waited < 60_000) {
          waited += 1000;
          later(begin, 1000);
          return;
        }
        useWorld.getState().putGathering({ ...useWorld.getState().gatherings.find((g) => g.id === def.id)!, live: true });
        const ctx: PlayCtx = { host: who.host, guests: who.guests, rolls: {}, name };
        let t = 0;
        let turn = 0;
        for (const line of script) {
          const speaker = line.who === "host" ? who.host : who.guests[(line.guest ?? turn++) % who.guests.length]!;
          // A roll lands first; the line that reacts to it is written once it has.
          if (line.roll) {
            later(() => {
              ctx.rolls[speaker] = useWorld.getState().roll(speaker, line.roll);
            }, t);
            t += 1400;
          }
          later(() => {
            const w = useWorld.getState();
            w.say(speaker, typeof line.text === "string" ? line.text : line.text(ctx));
            w.emote(speaker, def.emote, 3000);
          }, t);
          t += lineMs(line) - (line.roll ? 1400 : 0);
        }
        // The scene is over; the simulator walks them home when their hold runs out.
        later(() => stop(def.id, false), t + 4000);
      };
      later(begin, 1500);
      return { ok: true, ended };
    };

    let cadence: ReturnType<typeof setTimeout>;
    const schedule = (ms: number) => {
      cadence = setTimeout(() => {
        if (document.visibilityState === "visible") {
          const focus = useWorld.getState().focus;
          // Prefer a gathering in the room you're looking at.
          const options = shuffle(GATHERINGS.filter((g) => !g.manual)).sort((a, b) => Number(b.room === focus) - Number(a.room === focus));
          // The Lattice starts its own only when nothing else is on.
          if (running.size === 0) for (const def of options) if (start(def).ok) break;
        }
        schedule(EVERY[0] + Math.random() * (EVERY[1] - EVERY[0]));
      }, ms);
    };
    schedule(FIRST_AFTER);

    // Halloween night: the Hallowed Veil opens itself at dusk (Mountain time) and shuts at midnight. If the C.E.O.
    // ends it from the console it stays shut for the rest of the night; the party restarts after each scene until then.
    let veilOpened = false;
    let dismissedOn: string | null = null;
    const watchVeil = () => {
      const now = new Date();
      if (isHalloweenNight(now)) {
        if (dismissedOn === chronicleDay(now.getTime()) || document.visibilityState !== "visible") return;
        if (!running.has(COSTUME_PARTY) && start(GATHERING_BY_ID[COSTUME_PARTY]!, veilOpened ? "again" : "auto").ok) veilOpened = true;
      } else if (veilOpened) {
        veilOpened = false;
        stop(COSTUME_PARTY, true);
      }
    };
    const veilWatch = setInterval(watchVeil, VEIL_CHECK_MS);
    watchVeil();

    gatheringControl.start = (id) => {
      const def = GATHERING_BY_ID[id];
      return def ? start(def) : { ok: false, ended: [] };
    };
    gatheringControl.end = (id) => {
      const ids = id ? [id] : [...running.keys()];
      if (ids.includes(COSTUME_PARTY) && running.has(COSTUME_PARTY)) dismissedOn = chronicleDay(Date.now());
      return ids.filter((g) => stop(g, true)).length;
    };

    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.gather = (id: string) => {
      const def = GATHERING_BY_ID[id];
      if (!def) throw new Error(`Unknown gathering "${id}". Try: ${Object.keys(GATHERING_BY_ID).join(", ")}`);
      return start(def).ok;
    };
    api.gatheringIds = Object.keys(GATHERING_BY_ID);

    return () => {
      clearTimeout(cadence);
      clearInterval(veilWatch);
      running.forEach((r) => r.timers.forEach(clearTimeout));
      gatheringControl.start = () => ({ ok: false, ended: [] });
      gatheringControl.end = () => 0;
    };
  }, []);
  return null;
}
