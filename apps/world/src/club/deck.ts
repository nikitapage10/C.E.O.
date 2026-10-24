/**
 * Tomorrowlattice's decks. When the C.E.O. sends a track down through the Veil, Kevin plays it, and the club's
 * lights follow the music instead of the house clock: kicks flash the floor, a build strobes, and on the drop
 * the whole Break Room jumps. Without a track, the set runs on a 32-beat phrase with a drop at the top of each.
 */

/** The house tempo. */
export const CLUB_BPM = 124;

/** Shared deck state, written once a frame by the club's show driver and read by fixtures and dancers. */
export const deck = {
  /** A track from the C.E.O. is playing. */
  playing: false,
  title: "",
  /** 1 on a kick, decaying. */
  kick: 0,
  /** 0…1 while a build is rising (lights strobe faster). */
  build: 0,
  /** 1 on the drop, decaying over a few seconds. */
  drop: 0,
  /** Drops so far this session (achievements count them). */
  drops: 0,
};

const PHRASE = 32;
const BUILD_BEATS = 8;

/** The house-clock pattern for a DJ set with no track: the last eight beats of each phrase build, then it drops. */
export function phrase(beat: number) {
  const p = ((beat % PHRASE) + PHRASE) % PHRASE;
  return { build: p >= PHRASE - BUILD_BEATS ? (p - (PHRASE - BUILD_BEATS)) / BUILD_BEATS : 0, phraseIndex: Math.floor(beat / PHRASE) };
}

/**
 * Finds kicks and drops in a stream of bass energy (0…1, one sample a frame). A kick is a jump above the recent
 * average; a drop is the bass coming back hard after a breakdown, the quiet stretch where a build lives.
 */
export class BeatDetector {
  private fast = 0;
  private slow = 0;
  private lastKick = -Infinity;
  private quietSince: number | null = null;
  private lastDrop = -Infinity;
  private primed = 0;

  /** `now` in seconds. */
  push(bass: number, now: number): { kick: boolean; drop: boolean } {
    this.primed++;
    this.fast += (bass - this.fast) * 0.5;
    this.slow += (bass - this.slow) * 0.01;
    const kick = this.primed > 30 && bass > 0.18 && bass > this.slow * 1.3 && now - this.lastKick > 0.28;
    if (kick) this.lastKick = now;

    // A breakdown: the bass sits well under its long average for a couple of seconds.
    if (this.primed > 120 && this.fast < this.slow * 0.55) this.quietSince ??= now;
    let drop = false;
    if (this.quietSince !== null) {
      const quietFor = now - this.quietSince;
      if (this.fast > this.slow * 1.15 && this.fast > 0.25) {
        if (quietFor > 2 && now - this.lastDrop > 12) {
          drop = true;
          this.lastDrop = now;
        }
        this.quietSince = null;
      }
    }
    return { kick, drop };
  }
}

let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let bins: Uint8Array<ArrayBuffer> | null = null;
let detector = new BeatDetector();
const listeners = new Set<() => void>();

/** Tell the HUD (and the Kernel) the deck changed. */
export function onDeckChange(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn());

/** Play a track the C.E.O. picked from their own files. Nothing is uploaded: it plays in this browser only. */
export async function playTrack(file: File): Promise<void> {
  stopTrack();
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  audio = new Audio(URL.createObjectURL(file));
  audio.crossOrigin = "anonymous";
  const src = ctx.createMediaElementSource(audio);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  src.connect(analyser);
  analyser.connect(ctx.destination);
  detector = new BeatDetector();
  audio.addEventListener("ended", stopTrack);
  await audio.play();
  deck.playing = true;
  deck.title = file.name.replace(/\.[^.]+$/, "");
  changed();
}

/**
 * The Lattice went behind the Desk (#373): the C.E.O.'s track pauses with it and picks up where it was on the way
 * back. (Before the Lattice stayed mounted, leaving it left the track playing on the Desk with nothing to stop it.)
 */
export function holdDeck(hold: boolean) {
  if (!audio) return;
  if (hold) {
    audio.pause();
    void ctx?.suspend();
  } else {
    void ctx?.resume();
    void audio.play().catch(() => {});
  }
}

export function stopTrack() {
  if (audio) {
    audio.pause();
    URL.revokeObjectURL(audio.src);
    audio.removeEventListener("ended", stopTrack);
  }
  audio = null;
  analyser?.disconnect();
  analyser = null;
  const was = deck.playing;
  deck.playing = false;
  deck.title = "";
  if (was) changed();
}

/** Bass energy (roughly 40–260 Hz) of the playing track, 0…1. */
function bass(): number {
  if (!analyser || !bins) return 0;
  analyser.getByteFrequencyData(bins);
  let sum = 0;
  for (let i = 1; i <= 6; i++) sum += bins[i]!;
  return sum / (6 * 255);
}

/**
 * Advance the deck one frame. `beat` is the house clock's beat count; `live` says a DJ set is on.
 * Returns true on the frame a drop lands.
 */
export function tickDeck(dt: number, now: number, beat: number, live: boolean): boolean {
  let dropped = false;
  deck.drop = Math.max(0, deck.drop - dt / 4);
  if (deck.playing) {
    const { kick, drop } = detector.push(bass(), now);
    deck.kick = kick ? 1 : deck.kick * Math.exp(-dt * 8);
    deck.build = 0;
    dropped = drop;
  } else {
    deck.kick = Math.exp(-(beat % 1) * 6);
    const p = phrase(beat);
    deck.build = live ? p.build : 0;
    if (live && p.phraseIndex !== lastPhrase && lastPhrase !== -1) dropped = true;
    lastPhrase = live ? p.phraseIndex : -1;
  }
  if (dropped) {
    deck.drop = 1;
    deck.drops++;
  }
  return dropped;
}
let lastPhrase = -1;

/** How high a dancer in the Break Room is off the floor right now (metres): a bounce on the beat after a drop. */
export function hop(t: number, phase: number): number {
  if (deck.drop <= 0.01) return 0;
  const beat = (t * CLUB_BPM) / 60 + phase * 0.15;
  return deck.drop * Math.abs(Math.sin(beat * Math.PI)) * 0.32;
}
