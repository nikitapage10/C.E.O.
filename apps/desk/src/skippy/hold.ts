import { create } from "zustand";
import { SPEECH_LEVEL } from "./silence.ts";

/**
 * Hold music on a Talk call (#546): while Skippy waits on an answer (a lookup in flight, or a hand-off to his deeper
 * mind not back yet), after his one waiting line and about two seconds of nobody speaking, a quiet, cheesy bossa loop
 * plays under the call. It is our own (holdSynth.ts, a Web Audio synth: no samples, no melody of anyone else's) and it
 * plays here in the browser, so it spends no ElevenLabs credits. A quick lookup never gets there.
 *
 * It ducks out at once when the answer lands, when Skippy (or a submind) starts speaking, when Nikita speaks (his words,
 * his mic's level, a cut-off) or when the call ends, and it never plays over anyone's speech. On a long wait (ten
 * seconds or more) he may drop one aside, rarely and at most once a wait. Voicing it in his voice would cost credits,
 * so it is a caption on the hologram instead. A toggle on the call's pill mutes it, remembered on this device; with
 * reduced motion asked for it starts muted until turned on.
 */

/** Quiet needed, with something still pending, before the music starts (ms). */
export const HOLD_AFTER_MS = 2_000;
/** How long a wait runs before an aside may come (ms). */
export const ASIDE_AFTER_MS = 10_000;
/** The chance a long wait gets its one aside: rare on purpose. */
export const ASIDE_CHANCE = 0.35;
/** How long an aside stays on screen (ms). */
export const ASIDE_SHOW_MS = 6_000;
/** How often the call looks while it is live (ms): quick, so a barge-in ducks the music at once. */
export const HOLD_TICK_MS = 120;
/** Where this device keeps the toggle: "on" or "off". */
export const HOLD_KEY = "desk.holdMusic";

/** His asides over the music, in character. Captions only: none of them is ever sent to the call. */
export const HOLD_ASIDES: readonly string[] = [
  "These monkeys and their questions…",
  "Hold please. Genius at work.",
  "Your call is important to me. Moderately.",
  "I composed this loop in a nanosecond. You're welcome.",
  "Still magnificent. Still waiting. Mostly magnificent.",
  "The deeper me is thinking. The shallower me is humming.",
];

export interface HoldView {
  /** The call is live. */
  live: boolean;
  /** A lookup or a hand-off is still out. */
  pending: boolean;
  /** An agent has the floor right now. */
  agentSpeaking: boolean;
  /** The toggle is off. */
  muted: boolean;
}

export interface HoldStep {
  playing: boolean;
  /** It started on this step. */
  started: boolean;
  /** It stopped on this step. */
  stopped: boolean;
  /** The aside to show now, if this step brought one. */
  aside: string | null;
}

/**
 * The start/stop rules, pure, for the tests. `step` is called on every look (and on every event), `heard` whenever
 * anyone speaks. A wait is a stretch with something pending; the two seconds count from the later of its start and
 * the last speech, so a short lookup never reaches them.
 */
export function holdMachine(rand: () => number = Math.random) {
  let playing = false;
  let since: number | null = null;
  let spoke = Number.NEGATIVE_INFINITY;
  let asideDone = false;
  const halt = (): boolean => {
    const was = playing;
    playing = false;
    return was;
  };
  return {
    get playing() {
      return playing;
    },
    /** Someone spoke (Nikita or an agent): the quiet starts over and the music ducks out. True when it was playing. */
    heard(now: number): boolean {
      spoke = now;
      return halt();
    },
    step(v: HoldView, now: number): HoldStep {
      if (!v.live || !v.pending) {
        since = null;
        asideDone = false;
      }
      if (v.agentSpeaking) spoke = now;
      if (v.live && v.pending) since ??= now;
      if (!v.live || !v.pending || v.muted || v.agentSpeaking || since === null) return { playing: false, started: false, stopped: halt(), aside: null };
      let started = false;
      if (!playing && now - Math.max(spoke, since) >= HOLD_AFTER_MS) {
        playing = true;
        started = true;
      }
      let aside: string | null = null;
      if (playing && !asideDone && now - since >= ASIDE_AFTER_MS) {
        asideDone = true;
        if (rand() < ASIDE_CHANCE) aside = HOLD_ASIDES[Math.floor(rand() * HOLD_ASIDES.length) % HOLD_ASIDES.length] ?? null;
      }
      return { playing, started, stopped: false, aside };
    },
  };
}

const prefersStill = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whether hold music is off on this device: what was chosen here, else off only when reduced motion is asked for. */
export function readHoldMuted(): boolean {
  try {
    const v = window.localStorage.getItem(HOLD_KEY);
    if (v === "off") return true;
    if (v === "on") return false;
  } catch {
    /* storage blocked: fall back to the default */
  }
  return prefersStill();
}

export function writeHoldMuted(muted: boolean) {
  try {
    window.localStorage.setItem(HOLD_KEY, muted ? "off" : "on");
  } catch {
    /* storage blocked: the choice lasts this visit only */
  }
}

interface HoldStore {
  playing: boolean;
  aside: string | null;
  muted: boolean;
}

export const useHold = create<HoldStore>(() => ({ playing: false, aside: null, muted: readHoldMuted() }));

/** What plays the loop (holdSynth.ts; a stand-in in the tests). */
export interface HoldPlayer {
  play: () => void;
  /** Out at once (a few ms of ramp, no click). */
  duck: () => void;
}

/** What a live call tells the hold music. */
export interface HoldSource {
  pending: () => boolean;
  agentSpeaking: () => boolean;
  /** Nikita's mic level while he has the floor, 0 to 1. */
  micLevel: () => number;
}

let machine: ReturnType<typeof holdMachine> | null = null;
let source: HoldSource | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let asideTimer: ReturnType<typeof setTimeout> | null = null;
let player: HoldPlayer | null = null;
let loading: Promise<HoldPlayer | null> | null = null;
let makePlayer: () => Promise<HoldPlayer | null> = () => import("./holdSynth.ts").then((m) => m.holdSynth()).catch(() => null);

/** For the tests: what makes the player. */
export const setHoldPlayer = (make: () => Promise<HoldPlayer | null>) => {
  makePlayer = make;
  player = null;
  loading = null;
};

const duck = () => {
  try {
    player?.duck();
  } catch {
    /* nothing to stop */
  }
  if (asideTimer) clearTimeout(asideTimer);
  asideTimer = null;
  if (useHold.getState().playing || useHold.getState().aside) useHold.setState({ playing: false, aside: null });
};

const play = () => {
  useHold.setState({ playing: true });
  if (player) return player.play();
  loading ??= makePlayer();
  void loading.then((p) => {
    player = p;
    // Only if nothing stopped it while the synth loaded.
    if (p && machine?.playing) p.play();
  });
};

/** Looks now: starts, stops or brings the aside as the rules say. */
export function holdCheck(now = Date.now()) {
  if (!machine || !source) return;
  if (source.micLevel() >= SPEECH_LEVEL) holdHeard(now);
  const s = machine.step({ live: true, pending: source.pending(), agentSpeaking: source.agentSpeaking(), muted: useHold.getState().muted }, now);
  if (s.stopped) duck();
  if (s.started) play();
  if (s.aside) {
    useHold.setState({ aside: s.aside });
    if (asideTimer) clearTimeout(asideTimer);
    asideTimer = setTimeout(() => useHold.setState({ aside: null }), ASIDE_SHOW_MS);
  }
}

/** Someone spoke: duck out at once. */
export function holdHeard(now = Date.now()) {
  if (machine?.heard(now)) duck();
}

/** A live call starts watching for waits. */
export function holdBegin(src: HoldSource, rand: () => number = Math.random) {
  holdEnd();
  machine = holdMachine(rand);
  source = src;
  timer = setInterval(() => holdCheck(), HOLD_TICK_MS);
}

/** The call ended: out at once, and nothing more until the next call. */
export function holdEnd() {
  if (timer) clearInterval(timer);
  timer = null;
  machine?.heard(Date.now());
  machine = null;
  source = null;
  duck();
}

/** The toggle on the call's pill. */
export function setHoldMuted(muted: boolean) {
  writeHoldMuted(muted);
  useHold.setState({ muted });
  holdCheck();
}
