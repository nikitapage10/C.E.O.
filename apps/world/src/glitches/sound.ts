/**
 * Every sound here is synthesised on the spot: no samples, no licensing, Counsel.exe sleeps soundly.
 * Sound is off by default and only plays after the viewer turns it on.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.05) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ac.currentTime + start);
  g.gain.setValueAtTime(0, ac.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ac.currentTime + start + 0.01);
  g.gain.setValueAtTime(gain, ac.currentTime + start + dur - 0.02);
  g.gain.linearRampToValueAtTime(0, ac.currentTime + start + dur);
  o.connect(g).connect(ac.destination);
  o.start(ac.currentTime + start);
  o.stop(ac.currentTime + start + dur + 0.05);
  return o;
}

function noise(ac: AudioContext, start: number, dur: number, gain = 0.03) {
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const g = ac.createGain();
  g.gain.value = gain;
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1800;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(ac.currentTime + start);
}

/** A loving, legally distinct impression of a 56k handshake. */
export function playHandshake() {
  const ac = audio();
  if (!ac) return;
  [350, 440, 480, 620].forEach((f, i) => tone(ac, f, i * 0.12, 0.12, "sine", 0.04));
  tone(ac, 2100, 0.6, 0.5, "sine", 0.03);
  tone(ac, 1200, 1.1, 0.3, "square", 0.015);
  tone(ac, 2400, 1.1, 0.3, "square", 0.015);
  noise(ac, 1.5, 1.2, 0.04);
  for (let i = 0; i < 10; i++) tone(ac, 900 + ((i * 337) % 1400), 1.6 + i * 0.1, 0.08, "sawtooth", 0.012);
}

export function playBlip() {
  const ac = audio();
  if (!ac) return;
  tone(ac, 1600, 0, 0.04, "square", 0.02);
  tone(ac, 400, 0.05, 0.06, "square", 0.02);
}

export function playChime() {
  const ac = audio();
  if (!ac) return;
  tone(ac, 660, 0, 0.18, "triangle", 0.05);
  tone(ac, 880, 0.16, 0.3, "triangle", 0.05);
}

/** The Foundry's shipped bell (#209): one soft strike, a few sine partials that fade like brass, no clang. */
export function playBell() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.02;
  for (const [ratio, gain, dur] of [
    [1, 0.045, 2.2],
    [2.76, 0.012, 1.1],
    [5.4, 0.006, 0.6],
  ] as const) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880 * ratio, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
