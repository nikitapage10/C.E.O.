/**
 * The hologram's glitch sound (#1093, Nikita 2026-11-13: "a glitchy sound effect as it kind of glitches into being"):
 * a short burst of static that stutters and tears, timed to the projection's boot glitch when Talk starts and to its
 * glitch into clarity when the call connects (connect.ts RESOLVE_MS).
 *
 * It is the call's own sound, like the hold music, so it is not one of the site's duckable sources: the rule that the
 * rest of the site goes quiet during a call (siteSound.ts) leaves it heard. Synthesised on the spot (no samples), soft,
 * and never louder than the call. Where Web Audio isn't there, or the browser won't start it, it's silent.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const AC = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!AC) return null;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

/** One crackle of filtered static: `at` and `dur` in seconds from now, its band centred on `hz`. */
function crackle(ac: AudioContext, at: number, dur: number, hz: number, gain: number): void {
  const n = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const data = buf.getChannelData(0);
  // Bit-crushed noise: held samples give it the digital, torn edge rather than a soft hiss.
  let held = 0;
  for (let i = 0; i < n; i++) {
    if (i % 6 === 0) held = Math.random() * 2 - 1;
    data[i] = held;
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = hz;
  band.Q.value = 1.2;
  const g = ac.createGain();
  const t = ac.currentTime + at;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.setValueAtTime(gain, t + Math.max(0.005, dur - 0.01));
  g.gain.linearRampToValueAtTime(0, t + dur);
  src.connect(band).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + dur + 0.02);
}

/** A quick pitch tear: a square tone sliding between two pitches. */
function tear(ac: AudioContext, at: number, dur: number, from: number, to: number, gain: number): void {
  const o = ac.createOscillator();
  const g = ac.createGain();
  const t = ac.currentTime + at;
  o.type = "square";
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.005);
  g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/**
 * The glitch timings, pure for the tests: stuttering bursts of static over `ms`, denser at the start and thinning
 * as he settles, with a few pitch tears among them.
 */
export function glitchPlan(ms: number, seed = 1): { crackles: { at: number; dur: number; hz: number }[]; tears: { at: number; dur: number; from: number; to: number }[] } {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const total = Math.max(0.2, ms / 1000);
  const crackles: { at: number; dur: number; hz: number }[] = [];
  let at = 0;
  while (at < total) {
    const left = 1 - at / total;
    const dur = 0.02 + rnd() * 0.05 * (0.5 + left);
    crackles.push({ at, dur: Math.min(dur, total - at), hz: 900 + rnd() * 3200 });
    // Gaps grow as the picture clears.
    at += dur + 0.01 + rnd() * 0.07 * (1.4 - left);
  }
  const tears = [0.05, 0.35, 0.62]
    .map((f) => f * total)
    .map((t, i) => ({ at: t, dur: 0.05 + rnd() * 0.05, from: i % 2 ? 260 : 1900, to: i % 2 ? 1400 : 180 }));
  return { crackles, tears };
}

/** Plays the glitch over `ms`: the boot's glitch (about a second) or the clearing as the call connects. */
export function playGlitchIn(ms: number, loud = 1): void {
  const ac = audio();
  if (!ac) return;
  const { crackles, tears } = glitchPlan(ms, (Date.now() % 9973) + 1);
  const total = ms / 1000;
  for (const c of crackles) crackle(ac, c.at, c.dur, c.hz, 0.05 * loud * (1 - (0.6 * c.at) / total));
  for (const t of tears) tear(ac, t.at, t.dur, t.from, t.to, 0.012 * loud);
}
