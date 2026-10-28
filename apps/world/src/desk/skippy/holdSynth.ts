import type { HoldPlayer } from "./hold.ts";

/**
 * The hold music itself (#546): a small, cheesy elevator bossa, synthesised on the spot with Web Audio, so there is no
 * file to fetch and nobody's recording or melody in it. Four bars round the oldest changes in the book (Fmaj7, D7,
 * Gm7, C7), a soft two-oscillator electric piano on the bossa push, a walking root-and-fifth bass, a rim click and a
 * shaker, and a vibraphone noodling on chord tones. It sits well under the call (HOLD_GAIN) behind a low-pass, fades
 * in, and ducks out in a few milliseconds. Loaded only the first time a wait gets long enough (hold.ts).
 */

/** The loop's loudest, under everything on the call. */
export const HOLD_GAIN = 0.07;
/** The fade in (s). */
export const FADE_IN_S = 1.6;
/** The duck out (s): quick enough to call instant, slow enough not to click. */
export const DUCK_S = 0.04;

const BPM = 112;
const EIGHTH = 60 / BPM / 2;
const LOOK_AHEAD = 0.35;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** One bar a chord: the comping voicing, the bass root and fifth, the chord tones the vibes pick from. */
const BARS: readonly { chord: number[]; root: number; fifth: number; tones: number[] }[] = [
  { chord: [53, 57, 60, 64], root: 41, fifth: 48, tones: [69, 72, 76, 77] }, // Fmaj7
  { chord: [54, 57, 60, 62], root: 38, fifth: 45, tones: [66, 69, 72, 74] }, // D7
  { chord: [55, 58, 62, 65], root: 43, fifth: 50, tones: [67, 70, 74, 77] }, // Gm7
  { chord: [52, 55, 58, 60], root: 36, fifth: 43, tones: [64, 67, 70, 72] }, // C7
];

/** Eighths of a bar (0 to 7) where the piano pushes: the bossa's anticipations. */
const COMP = new Set([0, 3, 6]);
/** The rim click over two bars (0 to 15): a gentle clave. */
const RIM = new Set([0, 3, 6, 10, 12]);
/** The vibes' line, as eighth → chord-tone index, two bars long; held notes are the gaps. */
const VIBES: ReadonlyMap<number, number> = new Map([
  [0, 2],
  [3, 1],
  [4, 0],
  [8, 3],
  [10, 2],
  [11, 1],
  [14, 0],
]);

export function holdSynth(): HoldPlayer | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  let ac: AudioContext;
  try {
    ac = new AudioContext();
  } catch {
    return null;
  }
  const tone = ac.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2400;
  tone.connect(ac.destination);

  const noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.25), ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  let bus: GainNode | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;
  let next = 0;
  let step = 0;

  const note = (out: AudioNode, freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine", vibrato = 0) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (vibrato) {
      const lfo = ac.createOscillator();
      const depth = ac.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.value = freq * vibrato;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(at);
      lfo.stop(at + dur + 0.05);
    }
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.05);
  };

  const hiss = (out: AudioNode, at: number, dur: number, gain: number, freq: number) => {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(out);
    src.start(at);
    src.stop(at + dur + 0.02);
  };

  /** One eighth note's worth of the band, at `at`. */
  const eighth = (out: AudioNode, n: number, at: number) => {
    const bar = BARS[Math.floor(n / 8) % BARS.length]!;
    const pos = n % 8;
    if (COMP.has(pos)) for (const m of bar.chord) {
      note(out, hz(m), at, 0.32, 0.05);
      note(out, hz(m) * 2, at, 0.12, 0.012, "triangle");
    }
    if (pos === 0) note(out, hz(bar.root), at, EIGHTH * 2.6, 0.16, "triangle");
    if (pos === 3) note(out, hz(bar.fifth), at, EIGHTH * 0.9, 0.12, "triangle");
    if (pos === 4) note(out, hz(bar.fifth), at, EIGHTH * 2.6, 0.14, "triangle");
    const two = n % 16;
    if (RIM.has(two)) hiss(out, at, 0.05, 0.09, 2600);
    hiss(out, at, 0.04, pos % 2 ? 0.02 : 0.035, 7000);
    const pick = VIBES.get(two);
    if (pick !== undefined) note(out, hz(bar.tones[pick]!), at, EIGHTH * 3, 0.06, "sine", 0.006);
  };

  const run = () => {
    if (!bus) return;
    while (next < ac.currentTime + LOOK_AHEAD) {
      eighth(bus, step, next);
      next += EIGHTH;
      step = (step + 1) % (BARS.length * 8);
    }
  };

  return {
    play: () => {
      if (bus) return;
      if (ac.state === "suspended") void ac.resume().catch(() => undefined);
      bus = ac.createGain();
      const t = ac.currentTime;
      bus.gain.setValueAtTime(0, t);
      bus.gain.linearRampToValueAtTime(HOLD_GAIN, t + FADE_IN_S);
      bus.connect(tone);
      next = t + 0.05;
      step = 0;
      run();
      tick = setInterval(run, 100);
    },
    duck: () => {
      if (tick) clearInterval(tick);
      tick = null;
      const was = bus;
      bus = null;
      if (!was) return;
      // Notes already scheduled go to a bus that is fading and then cut loose, so nothing rings on.
      const t = ac.currentTime;
      was.gain.cancelScheduledValues(t);
      was.gain.setValueAtTime(was.gain.value, t);
      was.gain.linearRampToValueAtTime(0, t + DUCK_S);
      setTimeout(() => was.disconnect(), (DUCK_S + 0.05) * 1000);
    },
  };
}
