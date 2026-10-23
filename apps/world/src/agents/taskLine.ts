import { ROOMS, type Activity, type Place, type Prop, type RoomId } from "@ceo/core";

/**
 * The line under an agent's name on the Lattice: what they are doing right now, in a few plain words, with an
 * icon. A running task says what they are on: a real Foundry job as its issue number and short line ("#43 ·
 * Speeding up the Lattice"), anything else by its tidied title; otherwise the line comes from their activity and the
 * station they are at ("Testing in the furnace", "Keeping watch", "Heading to the bar"). Pure, so it can be
 * tested without the scene.
 */

export type TaskIcon =
  | "work"
  | "write"
  | "carry"
  | "walk"
  | "wait"
  | "rest"
  | "look"
  | "nap"
  | "stuck"
  | "cheer"
  | "music"
  | "game"
  | "read"
  | "post";

export interface TaskLine {
  icon: TaskIcon;
  text: string;
}

export interface TaskLineInput {
  activity: Activity;
  /** Where the agent is, or where they are heading while walking. */
  place: Place;
  prop: Prop | null;
  /**
   * The agent's current task, if any; only a running one is shown. A real job carries its issue number and its
   * `**Short:**` line, and shows as "#43 · Speeding up the Lattice"; without a short line, its tidied title.
   */
  task?: { title: string; status: string; number?: number; short?: string } | null;
}

/** What doing a station's job looks like, in the station's own words. */
interface StationWords {
  /** Working or writing there. */
  work: string;
  /** Standing about there. Defaults to "At the <station>". */
  idle?: string;
  /** Waiting there. Defaults to "Waiting at the <station>". */
  wait?: string;
  /** The icon for working there, when it says more than a hammer would. */
  icon?: TaskIcon;
}

const STATIONS: Partial<Record<RoomId, Record<string, StationWords>>> = {
  foundry: {
    intake: { work: "Sorting the crate intake" },
    assembler: { work: "Building at the assembly arm" },
    furnace: { work: "Testing in the furnace" },
    shipping: { work: "Loading the shipping dock", wait: "Waiting at the dock for your OK" },
    "bench-a": { work: "Fine work at the bench", idle: "Between jobs" },
    "bench-b": { work: "Pinning ideas to the board", idle: "Between jobs" },
    drafting: { work: "Studying the plan", idle: "Over the plan", icon: "read" },
    handoff: { work: "Handing a job up", wait: "Handing a job up" },
    watch: { work: "Watching the lamp closely", idle: "Keeping watch", wait: "Keeping watch", icon: "look" },
  },
  spire: {
    "desk-1": { work: "Working the books", icon: "write" },
    "desk-2": { work: "Working the books", icon: "write" },
    "desk-3": { work: "Working the books", icon: "write" },
    whiteboard: { work: "Updating the KPI board", icon: "write" },
    meeting: { work: "In a meeting", idle: "In the meeting pod" },
    coffee: { work: "Making coffee", idle: "Getting coffee", icon: "rest" },
  },
  exchange: {
    "desk-n": { work: "Reading the markets", icon: "look" },
    "desk-e": { work: "Reading the markets", icon: "look" },
    "desk-w": { work: "Reading the markets", icon: "look" },
    vault: { work: "At the approval vault", wait: "Waiting on your OK" },
    terminal: { work: "Researching at the terminal", icon: "read" },
    "poker-n": { work: "Playing cards", idle: "At the card table", icon: "game" },
    "poker-e": { work: "Playing cards", idle: "At the card table", icon: "game" },
    "poker-w": { work: "Playing cards", idle: "At the card table", icon: "game" },
    "poker-s": { work: "Playing cards", idle: "At the card table", icon: "game" },
  },
  green: {
    "depth-chart": { work: "Setting the depth chart", icon: "write" },
    mailbox: { work: "Checking the waiver mailbox", icon: "post" },
    sideline: { work: "Calling it from the sideline", idle: "On the sideline", icon: "look" },
    huddle: { work: "In the huddle", icon: "game" },
    bench: { work: "On the park bench", idle: "Resting on the bench", icon: "rest" },
    "play-1": { work: "Playing on the pitch", icon: "game" },
    "play-2": { work: "Playing on the pitch", icon: "game" },
    "play-3": { work: "Playing on the pitch", icon: "game" },
    "play-4": { work: "Playing on the pitch", icon: "game" },
  },
  relay: {
    tubes: { work: "Sorting the tube post", icon: "post" },
    "draft-desk": { work: "Drafting a reply", icon: "write" },
    outbox: { work: "Sealing the outbox", wait: "Waiting on your OK", icon: "post" },
    switchboard: { work: "Working the switchboard", icon: "post" },
  },
  archive: {
    shelves: { work: "Browsing the glass shelves", icon: "read" },
    loom: { work: "Weaving at the lore loom", icon: "write" },
    "dice-table": { work: "Running the table", idle: "In the DM's chair", icon: "game" },
    shrine: { work: "Tending the shrine" },
    reading: { work: "Reading in the nook", idle: "Reading in the nook", icon: "read" },
    lab: { work: "At the professor's bench" },
    "loot-box": { work: "Sitting in the loot box", idle: "Sitting in the loot box", icon: "rest" },
    ...Object.fromEntries(
      ["seat-w", "seat-e", "seat-sw", "seat-se", "seat-nm", "seat-sm"].map((id) => [id, { work: "Playing at the long table", idle: "At the long table", icon: "game" as const }]),
    ),
  },
  breakroom: {
    couch: { work: "Lounging", idle: "Lounging", icon: "rest" },
    "ping-pong": { work: "Playing ping-pong", icon: "game" },
    "pong-a": { work: "Playing ping-pong", idle: "Playing ping-pong", icon: "game" },
    "pong-b": { work: "Playing ping-pong", idle: "Playing ping-pong", icon: "game" },
    "coffee-machine": { work: "Brewing coffee", idle: "Getting coffee", icon: "rest" },
    bar: { work: "At the bar", idle: "At the bar", icon: "rest" },
    "server-rack": { work: "By the warm rack", idle: "Resting by the rack", icon: "rest" },
    window: { work: "Taking in the skyline", idle: "Taking in the skyline", icon: "look" },
    decks: { work: "Spinning the decks", idle: "Behind the decks", icon: "music" },
    mic: { work: "On the mic", idle: "On the mic", icon: "music" },
    "stage-l": { work: "On the drums", idle: "On the drum riser", icon: "music" },
    "stage-r": { work: "On the keys", idle: "On the keys", icon: "music" },
    ...Object.fromEntries(["dance-1", "dance-2", "dance-3", "dance-4", "dance-5", "dance-6"].map((id) => [id, { work: "Dancing", idle: "On the dance floor", icon: "music" as const }])),
  },
  boiler: {
    pipes: { work: "Reading the pipe gauges", icon: "look" },
    boiler: { work: "Stoking the boiler" },
    bucket: { work: "Minding the bucket" },
    sign: { work: "Updating the incident sign", icon: "write" },
    bench: { work: "At the tool bench" },
    "warm-side": { work: "Warming by the boiler", idle: "Warming by the boiler", icon: "rest" },
  },
  workshop: {
    easel: { work: "Sketching at the easel", icon: "write" },
    mould: { work: "Working the mould" },
    fitting: { work: "Fitting a piece" },
    stage: { work: "Rehearsing on stage", icon: "music" },
    bench: { work: "At the workbench" },
    shelves: { work: "Looking over past figures", icon: "look" },
    crate: { work: "Packing finished pieces", icon: "carry" },
  },
  studio: {
    set: { work: "On the mark, filming", icon: "music" },
    camera: { work: "Running the camera", icon: "look" },
    storyboard: { work: "Pinning up the storyboard", icon: "write" },
    script: { work: "Writing a script", icon: "write" },
    edit: { work: "Cutting at the edit desk" },
    render: { work: "Rendering, 9:16" },
  },
};

const PROP_NAME: Record<Prop, string> = {
  crate: "a crate",
  cube: "a cube",
  envelope: "a letter",
  ball: "the ball",
  book: "a book",
  coin: "a coin",
  mug: "a mug",
  chart: "a chart",
};

/** The longest line shown; anything longer is cut at a word and given an ellipsis. */
export const TASK_LINE_MAX = 38;

/** A station's label as it reads in a sentence: "the crate intake", "the bar", "desk 1". */
export function stationPhrase(place: Place): string {
  const st = ROOMS[place.room]?.stations.find((s) => s.id === place.station);
  if (!st) return "their spot";
  if (place.station === "post") return `the ${ROOMS[place.room].name.replace(/^The /, "")}'s post`;
  const label = st.label.replace(/\s*\(.*\)\s*/g, "").trim();
  if (/^the /i.test(label)) return `the ${label.slice(4)}`;
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  return /\d$/.test(label) ? lower : `the ${lower}`;
}

/** Cut a line to fit under a name: at a word where possible, with an ellipsis. */
export function shorten(text: string, max = TASK_LINE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.·-]+$/, "")}…`;
}

/** A task title tidied for the line: the issue number kept, the lane prefixes ("Idea:", "Foundry:") dropped. */
export function tidyTitle(title: string): string {
  return title
    .replace(/^(#\d+\s+)?(?:idea|foundry|fix|build|upkeep)(?:\s*#\d+)?\s*:\s*/i, "$1")
    .replace(/^(#\d+\s+)?(.)/, (_, num: string | undefined, c: string) => `${num ?? ""}${c.toUpperCase()}`);
}

/** What a running task reads as on the line: "#43 · Speeding up the Lattice", else its tidied title. Null when none runs. */
export function onTask(task: TaskLineInput["task"]): string | null {
  if (!task || task.status !== "running") return null;
  if (task.number !== undefined && task.short) return shorten(`#${task.number} · ${task.short}`);
  return shorten(tidyTitle(task.title));
}

/** The line under an agent's name: an icon for what they are doing and a few words for what it is. */
export function taskLine({ activity, place, prop, task }: TaskLineInput): TaskLine {
  const running = onTask(task);
  // What they're stuck on, without the issue number: the short line ("speeding up the Lattice"), else the title.
  const stuckOn = task?.short ? task.short.charAt(0).toLowerCase() + task.short.slice(1) : running?.replace(/^#\d+\s+/, "");
  const words = STATIONS[place.room]?.[place.station];
  const at = stationPhrase(place);

  switch (activity) {
    // These say more than any task title would.
    case "napping":
      return { icon: "nap", text: "Napping" };
    case "slumped":
      return { icon: "stuck", text: running ? shorten(`Stuck on ${stuckOn}`) : "Stuck: needs a hand" };
    case "celebrating":
      return { icon: "cheer", text: "Celebrating a win" };
    case "walking":
      return { icon: "walk", text: running ?? (place.station === "command" ? "Coming out to give orders" : shorten(`Heading to ${at}`)) };
    case "carrying":
      return { icon: "carry", text: running ?? shorten(`Carrying ${prop ? PROP_NAME[prop] : "something"} to ${at}`) };
    default:
      break;
  }
  // A room lead at the conductor's post, overhead: conducting when busy, otherwise keeping an eye on the room.
  if (place.station === "post") {
    const busy = activity === "working" || activity === "typing";
    return { icon: "look", text: running ?? (busy ? "Conducting the room" : "Watching over the room") };
  }
  // A room lead come down off the post to give an order.
  if (place.station === "command") return { icon: "look", text: running ?? "Giving orders" };
  switch (activity) {
    case "waiting":
      return { icon: "wait", text: running ?? words?.wait ?? shorten(`Waiting at ${at}`) };
    case "staring":
      return { icon: "look", text: running ?? "Thinking it over" };
    case "idle":
      return words?.idle ? { icon: words.icon ?? "rest", text: running ?? words.idle } : { icon: "rest", text: running ?? shorten(`At ${at}`) };
    default:
      return { icon: words?.icon ?? (activity === "typing" ? "write" : "work"), text: running ?? words?.work ?? shorten(`Working at ${at}`) };
  }
}
