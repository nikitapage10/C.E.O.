import { ROOMS, type RoomId } from "@ceo/core";
import { isSubmind } from "@ceo/simulator";
import { unlock } from "../achievements/achievements.ts";
import { clock } from "../clock.ts";
import { gatheringControl } from "../gatherings/GatheringDirector.tsx";
import { GATHERINGS } from "../gatherings/gatherings.ts";
import { skipTo } from "../night/dayCycle.ts";
import { petOrders } from "../pets/pets.ts";
import { gatheringMembers, useWorld } from "../store.ts";

/**
 * The Kernel console: the C.E.O.'s terminal into the Lattice. The Kernel takes orders from exactly one person,
 * and says so every time. Each command is a button in the console and can also be typed.
 */
export interface Command {
  /** What you type. */
  verb: string;
  label: string;
  /** Shown on hover and in `help`. */
  about: string;
  group: "gather" | "cast" | "world";
  run: () => string;
}

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** Agents standing about (not walking, not in a gathering). */
function free() {
  const s = useWorld.getState();
  const busy = gatheringMembers(s);
  return Object.values(s.lattice.agents).filter((a) => !busy.has(a.agent.id) && (!a.motion || clock.sim >= a.motion.startTs + a.motion.duration));
}

const GATHER_VERB: Record<string, string> = {
  "one-shot": "dnd",
  pickup: "football",
  rally: "pingpong",
  poker: "poker",
  "club-night": "club",
  concert: "concert",
  "costume-party": "costumes",
};

const GATHER_LABEL: Record<string, string> = {
  "one-shot": "D&D at the long table",
  pickup: "Football on the Green",
  rally: "Ping-pong rally",
  poker: "Poker in the pit",
  "club-night": "Club night",
  concert: "Live concert",
  "costume-party": "Costume party",
};

function gather(id: string, room: RoomId): string {
  const w = useWorld.getState();
  // Two at once, one per room: a second in the same room replaces the first; a third ends the oldest.
  const { ok, ended } = gatheringControl.start(id);
  if (!ok) {
    if (w.gatherings.some((g) => g.id === id)) return "That is already happening. I checked. Twice.";
    return "Nobody is free to go. They are all busy or waiting on your approvals. Coincidence is not a supported explanation.";
  }
  w.setFocus(room);
  const label = (g: string) => GATHER_LABEL[g] ?? g;
  if (ended.length) return `Ending ${ended.map(label).join(" and ")} to make room. Sending the cast to ${ROOMS[room].name}. I run two parties at once, at most. I barely run one.`;
  return pick([`Done. Sending the cast to ${ROOMS[room].name}. Productivity has been suspended by executive order.`, `Executing. ${ROOMS[room].name}, incoming. I have logged this as "team building".`]);
}

export const COMMANDS: Command[] = [
  ...GATHERINGS.map(
    (g): Command => ({
      verb: GATHER_VERB[g.id] ?? g.id,
      label: GATHER_LABEL[g.id] ?? g.name,
      about: `${g.name}: some of the cast drop what they're doing and go.`,
      group: "gather",
      run: () => gather(g.id, g.room),
    }),
  ),
  {
    verb: "dismiss",
    label: "Back to work",
    about: "End every gathering that's on and send everyone back to their routine.",
    group: "gather",
    run: () => {
      const n = gatheringControl.end();
      return n ? `${n === 1 ? "Gathering" : "Both gatherings"} dismissed. Everyone back to work. The groans have been logged.` : "Nothing to dismiss. Everyone is already pretending to work.";
    },
  },
  {
    verb: "celebrate",
    label: "Everyone celebrate",
    about: "Every agent standing about celebrates for a few seconds.",
    group: "cast",
    run: () => {
      const w = useWorld.getState();
      const who = free();
      who.forEach((a) => {
        w.override(a.agent.id, "celebrating", 6000 + Math.random() * 3000);
        w.emote(a.agent.id, "✦", 3000);
      });
      return `${who.length} agents are now celebrating. Nobody knows what. Morale is up. Output is not.`;
    },
  },
  {
    verb: "nap",
    label: "Nap time",
    about: "Every agent standing about naps where they stand.",
    group: "cast",
    run: () => {
      const w = useWorld.getState();
      // The subminds keep watch: they never nap, even on orders.
      const who = free().filter((a) => !isSubmind(a.agent.id));
      who.forEach((a) => {
        w.override(a.agent.id, "napping", 30_000 + Math.random() * 15_000);
        w.emote(a.agent.id, "☾", 3000);
      });
      return `Nap time authorised for ${who.length} agents. I have never authorised anything faster.`;
    },
  },
  {
    verb: "wave",
    label: "Say hello",
    about: "Everyone in the room you're watching turns and looks at you.",
    group: "cast",
    run: () => {
      const w = useWorld.getState();
      const here = free().filter((a) => !w.focus || a.place.room === w.focus);
      here.forEach((a) => w.override(a.agent.id, "stare", 4000 + Math.random() * 1500));
      if (here[0]) w.say(here[0].agent.id, pick(["Oh! I didn't see you there.", "Hi! Hello. We were all working.", "Everyone act natural."]));
      if (!here.length) return "Nobody here is standing still long enough to notice you. They are busy. Allegedly.";
      return `${here.length} agents have noticed you. They are pretending they hadn't.`;
    },
  },
  {
    verb: "lights-out",
    label: "Lights out",
    about: "Skip ahead to ten at night: the night shift.",
    group: "world",
    run: () => {
      skipTo(22);
      return "Advancing the Lattice to 22:00. Night shift in progress. Overtime is not a concept I recognise.";
    },
  },
  {
    verb: "sunrise",
    label: "Sunrise",
    about: "Skip ahead to seven in the morning.",
    group: "world",
    run: () => {
      skipTo(7);
      return "Advancing the Lattice to 07:00. Good morning. That is a status, not a wish.";
    },
  },
  {
    verb: "zoomies",
    label: "Zoomies",
    about: "Myshka runs through the Lattice at three times his usual speed.",
    group: "world",
    run: () => {
      petOrders.zoomiesUntil = performance.now() + 25_000;
      unlock("zoomies");
      return "Myshka has been granted the zoomies. He did not need to be granted them. He has root access.";
    },
  },
  {
    verb: "memory",
    label: "Leak a memory",
    about: "Let one of the Syntherion's old memories leak into the Lattice.",
    group: "world",
    run: () => {
      const api = (window as unknown as { __ceo?: { fireGlitch?: (id: string) => void; glitchIds?: string[] } }).__ceo;
      const ids = (api?.glitchIds ?? []).filter((id) => id !== "counsel-memo");
      if (!api?.fireGlitch || !ids.length) return "No memories available. That is the most worrying thing I have ever said.";
      api.fireGlitch(pick(ids));
      return "Releasing one memory, on purpose, for the first time in Lattice history. Counsel.exe has been notified.";
    },
  },
];

const BY_VERB: Record<string, Command> = Object.fromEntries(COMMANDS.map((c) => [c.verb, c]));
const ALIASES: Record<string, string> = {
  "d&d": "dnd",
  campaign: "dnd",
  "one-shot": "dnd",
  soccer: "football",
  pickup: "football",
  "ping-pong": "pingpong",
  rally: "pingpong",
  cards: "poker",
  party: "club",
  "club-night": "club",
  dance: "club",
  gig: "concert",
  halloween: "costumes",
  costume: "costumes",
  "costume-party": "costumes",
  veil: "costumes",
  work: "dismiss",
  stop: "dismiss",
  sleep: "nap",
  night: "lights-out",
  "lights out": "lights-out",
  dark: "lights-out",
  morning: "sunrise",
  day: "sunrise",
  glitch: "memory",
  hello: "wave",
  hi: "wave",
  cheer: "celebrate",
  party_time: "celebrate",
};

/** Run what was typed. Returns the Kernel's answer. */
export function runCommand(input: string): string {
  const raw = input.trim().toLowerCase().replace(/^\/+/, "");
  if (!raw) return "";
  if (raw === "help" || raw === "?") return `Commands: ${COMMANDS.map((c) => c.verb).join(", ")}. I accept requests from the C.E.O. only. You are the C.E.O.`;
  if (raw === "sudo" || raw.startsWith("sudo ")) return raw === "sudo" ? "You already have root. So does the cat." : runCommand(raw.slice(5));
  const verb = BY_VERB[raw] ? raw : ALIASES[raw] ?? raw.split(/\s+/).map((w) => ALIASES[w] ?? w).find((w) => BY_VERB[w]);
  const cmd = verb ? BY_VERB[verb] : undefined;
  if (!cmd) return `Unknown command "${raw}". Type "help". I know what you meant, obviously. I just want to hear you say it properly, monkey.`;
  return cmd.run();
}
