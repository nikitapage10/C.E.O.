import { pendingApprovals } from "@ceo/core";
import { useEffect } from "react";
import { useCast } from "../cast/castStore.ts";
import { clock } from "../clock.ts";
import { readingTime, simulator, useWorld, type CampaignCostume } from "../store.ts";
import { GATHERINGS, GATHERING_BY_ID, type GatheringDef, type Line, type PlayCtx } from "./gatherings.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const shuffle = <T,>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const FIRST_AFTER = 40_000;
const EVERY = [110_000, 190_000] as const;
/** Reading time for a line that's written when it's spoken (a dice result): assume a longish sentence. */
const LAZY_MS = readingTime("x".repeat(80));
const lineMs = (l: Line) => (typeof l.text === "string" ? readingTime(l.text) : LAZY_MS) + (l.roll ? 1400 : 0) + 700;

/** Who's in: a host who likes this, then the host's friends (wherever they are), then whoever's free. */
function castFor(def: GatheringDef): { host: string; guests: string[] } | null {
  const { lattice } = useWorld.getState();
  const { cast } = useCast.getState();
  const waiting = new Set(pendingApprovals(lattice).map((p) => p.request.agentId));
  const free = Object.keys(lattice.agents).filter((id) => !waiting.has(id));
  const host = def.hosts.find((id) => free.includes(id)) ?? shuffle(free.filter((id) => lattice.agents[id]?.place.room === def.room))[0];
  if (!host) return null;
  const friends = cast.relationships
    .filter((r) => (r.a === host || r.b === host) && r.kind !== "nemesis" && r.kind !== "ex")
    .map((r) => (r.a === host ? r.b : r.a));
  const pool = [...shuffle(friends), ...shuffle(free)].filter((id, i, all) => id !== host && free.includes(id) && all.indexOf(id) === i);
  const n = Math.min(def.seats.length - 1, def.guests[0] + Math.floor(Math.random() * (def.guests[1] - def.guests[0] + 1)));
  const guests = pool.slice(0, n);
  return guests.length >= def.guests[0] ? { host, guests } : null;
}

/** Lets the rest of the world (the Kernel console, the decks) start or end a gathering. Set by the director. */
export const gatheringControl = {
  start: (_id: string): boolean => false,
  /** Break up whatever is on and send everyone back to their routine. */
  end: (): boolean => false,
};

/**
 * Starts gatherings now and then: sends the cast to their seats through the simulator, plays the scene's
 * script once they've arrived, and lets the Kernel have its say. Renders nothing.
 */
export function GatheringDirector() {
  useEffect(() => {
    let running: string | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));

    const start = (def: GatheringDef): boolean => {
      if (running) return false;
      const who = castFor(def);
      if (!who) return false;
      running = def.id;
      const world = useWorld.getState();
      const name = (id: string) => useCast.getState().cast.profiles[id]?.name ?? id;
      const costumes: CampaignCostume[] = def.costumes ? shuffle([...def.costumes]).slice(0, who.guests.length) : [];
      const script = def.compose ? def.compose(costumes) : pick(def.scripts ?? [[]]);
      // Hold long enough for the whole scene, in Lattice time.
      const sceneMs = script.reduce((sum, l) => sum + lineMs(l), 0);
      const holdSim = (sceneMs + 25_000) * world.timeScale;
      const everyone = [who.host, ...who.guests];
      world.setGathering({ id: def.id, room: def.room, host: who.host, guests: who.guests, since: performance.now(), live: false });
      if (costumes.length) world.setCostumes(Object.fromEntries(who.guests.map((id, i) => [id, costumes[i]!])));
      const dressed = def.dressAll ? Object.fromEntries(everyone.flatMap((id) => (def.dressAll!(id) ? [[id, def.dressAll!(id)!]] : []))) : null;
      if (dressed) world.setCostumes(dressed);
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
      world.announce(
        pick(def.kernel)
          .replace("{host}", name(who.host))
          .replace("{guests}", who.guests.map(name).join(", ")),
        "status",
        def.room,
      );

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
        const g = useWorld.getState().gathering;
        if (g?.id === def.id) useWorld.getState().setGathering({ ...g, live: true });
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
        later(() => {
          running = null;
          const w = useWorld.getState();
          if (w.gathering?.id === def.id) w.setGathering(null);
          if (costumes.length || def.dressAll) w.setCostumes({});
        }, t + 4000);
      };
      later(begin, 1500);
      return true;
    };

    let cadence: ReturnType<typeof setTimeout>;
    const schedule = (ms: number) => {
      cadence = setTimeout(() => {
        if (document.visibilityState === "visible") {
          const focus = useWorld.getState().focus;
          // Prefer a gathering in the room you're looking at.
          const options = shuffle(GATHERINGS.filter((g) => !g.manual)).sort((a, b) => Number(b.room === focus) - Number(a.room === focus));
          for (const def of options) if (start(def)) break;
        }
        schedule(EVERY[0] + Math.random() * (EVERY[1] - EVERY[0]));
      }, ms);
    };
    schedule(FIRST_AFTER);

    const end = () => {
      const w = useWorld.getState();
      const g = w.gathering;
      if (!running || !g) return false;
      timers.splice(0).forEach(clearTimeout);
      running = null;
      for (const id of [g.host, ...g.guests]) simulator.assign(id, [{ kind: "set", activity: "idle", prop: null }], clock.sim);
      w.setGathering(null);
      w.setCostumes({});
      return true;
    };
    gatheringControl.start = (id) => {
      const def = GATHERING_BY_ID[id];
      return def ? start(def) : false;
    };
    gatheringControl.end = end;

    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.gather = (id: string) => {
      const def = GATHERING_BY_ID[id];
      if (!def) throw new Error(`Unknown gathering "${id}". Try: ${Object.keys(GATHERING_BY_ID).join(", ")}`);
      return start(def);
    };
    api.gatheringIds = Object.keys(GATHERING_BY_ID);

    return () => {
      clearTimeout(cadence);
      timers.forEach(clearTimeout);
      gatheringControl.start = () => false;
      gatheringControl.end = () => false;
    };
  }, []);
  return null;
}
