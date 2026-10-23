import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { eInOut, eOut, gauss, kick, lerp, RC, spr, sstep, TAU, vizTime, WHITE } from "../wvCanvas.ts";
import { FAN, fanPaths } from "./fan.ts";

/**
 * The daily opening (the approved Weave, 87-opening.js), about three seconds on the first open of the day: out of the
 * dark, particles drift in and gather onto nine long threads across the screen, the threads draw together into
 * Today's fan beside Skippy, the dark lifts and his greeting writes itself in. A click, a tap or any key skips it; with
 * reduced motion it never plays. It sits over the page in its own layer and takes no clicks itself.
 */

/** The opening's beats, in milliseconds. */
export const OP = { B0: 420, B1: 1500, C0: 1550, C1: 2400, LIFT: 2050, WRITE: 2150, RISE: 2350, FADE0: 2300, FADE1: 2950, END: 3050 };

const ORDER = ["foundry", "boiler", "breakroom", "archive", "relay", "spire", "exchange", "green", "workshop", "studio"];

interface P {
  i: number;
  u: number;
  o: number;
  sx: number;
  sy: number;
  z: number;
  d0: number;
  d1: number;
  v: number;
}

/** Where thread i runs while the particles gather: a long wave across the whole screen. */
function openPath(i: number, u: number, T: number, W: number, H: number): [number, number] {
  const x = lerp(-0.06 * W, 1.06 * W, u);
  const env = 0.35 + 0.65 * Math.sin(Math.PI * u);
  const y = H * 0.5 + H * 0.3 * Math.sin(u * TAU * 0.9 + (i * TAU) / 9 + T * 1.1) * env + (i - 4) * H * 0.012;
  return [x, y];
}

export function Opening({ onLift, onWrite, onRise, onDone }: { onLift: () => void; onWrite: (skipped: boolean) => void; onRise: () => void; onDone: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const cbs = useRef({ onLift, onWrite, onRise, onDone });
  cbs.current = { onLift, onWrite, onRise, onDone };

  useEffect(() => {
    const c = cv.current?.getContext("2d");
    const canvas = cv.current;
    if (!c || !canvas) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const n = W < 640 ? 700 : 1500;
    const parts: P[] = [];
    for (let k = 0; k < n; k++) {
      const u = Math.random();
      parts.push({ i: k % 9, u, o: gauss(), sx: Math.random() * W, sy: Math.random() * H, z: Math.random(), d0: Math.random() * 480, d1: OP.B0 + u * 650 + Math.random() * 160, v: 0.03 + Math.random() * 0.04 });
    }
    // The fan's threads go in the fan's order; the opening's nine waves map onto them by room.
    const fanIndex = (i: number) => FAN.items.findIndex((x) => x.id === ORDER[i]);
    const t0 = performance.now();
    const done = { lift: false, write: false, rise: false, end: false };
    let fin: ({ x: number[]; y: number[] } | null)[] = [];
    let raf = 0;
    FAN.am = 0;
    kick();

    const finish = () => {
      if (done.end) return;
      done.end = true;
      cancelAnimationFrame(raf);
      FAN.am = 1;
      kick();
      if (!done.lift) cbs.current.onLift();
      if (!done.write) cbs.current.onWrite(true);
      if (!done.rise) cbs.current.onRise();
      cbs.current.onDone();
    };

    const finalPath = (i: number, u: number, T: number): [number, number] => {
      const f = fin[i];
      if (!f) return openPath(i, u, T, W, H);
      const q = u * (f.x.length - 1);
      const j = Math.min(f.x.length - 2, q | 0);
      const r = q - j;
      return [f.x[j]! + (f.x[j + 1]! - f.x[j]!) * r, f.y[j]! + (f.y[j + 1]! - f.y[j]!) * r];
    };

    const frame = (now: number) => {
      const T = now - t0;
      const ts = T / 1000;
      if (T >= OP.END) return finish();
      const paths = fanPaths(vizTime());
      fin = ORDER.map((_, i) => {
        const fi = fanIndex(i);
        return paths && fi >= 0 ? paths[fi]! : null;
      });
      const km = eInOut((T - OP.C0) / (OP.C1 - OP.C0));
      const spread = lerp(10, 2.2, km);
      const fade = 1 - sstep(OP.FADE0, OP.FADE1, T);
      if (T > OP.LIFT && !done.lift) {
        done.lift = true;
        veil.current?.classList.add("is-lift");
        cbs.current.onLift();
      }
      if (T > OP.WRITE && !done.write) {
        done.write = true;
        cbs.current.onWrite(false);
      }
      if (T > OP.RISE && !done.rise) {
        done.rise = true;
        cbs.current.onRise();
      }
      FAN.am = sstep(OP.FADE0, OP.FADE1, T);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalCompositeOperation = "source-over";
      c.clearRect(0, 0, W, H);
      c.globalCompositeOperation = "lighter";
      if (T > OP.B0 + 300) {
        c.lineWidth = 0.8;
        for (let i = 0; i < 9; i++) {
          c.strokeStyle = `rgba(${RC[ORDER[i]!]},${0.16 * sstep(OP.B0 + 300, OP.B1, T) * fade})`;
          c.beginPath();
          for (let k = 0; k <= 40; k++) {
            const u = k / 40;
            const a = openPath(i, u, ts, W, H);
            const b = finalPath(i, u, ts);
            const x = lerp(a[0], b[0], km);
            const y = lerp(a[1], b[1], km);
            if (k) c.lineTo(x, y);
            else c.moveTo(x, y);
          }
          c.stroke();
        }
      }
      for (const p of parts) {
        const rgb = RC[ORDER[p.i]!]!;
        p.u += p.v * 0.016 * (T > OP.B1 ? 1 : 0.5);
        if (p.u > 1) p.u -= 1;
        const A = openPath(p.i, p.u, ts, W, H);
        const B = finalPath(p.i, p.u, ts);
        let tx = lerp(A[0], B[0], km);
        let ty = lerp(A[1], B[1], km);
        const u2 = Math.min(1, p.u + 0.01);
        const A2 = openPath(p.i, u2, ts, W, H);
        const B2 = finalPath(p.i, u2, ts);
        const dx = lerp(A2[0], B2[0], km) - tx;
        const dy = lerp(A2[1], B2[1], km) - ty;
        const l = Math.sqrt(dx * dx + dy * dy) || 1;
        tx += (-dy / l) * p.o * spread;
        ty += (dx / l) * p.o * spread;
        const e = eOut((T - p.d1) / 650);
        const x = lerp(p.sx + Math.sin(ts * 0.8 + p.z * 20) * 6, tx, e);
        const y = lerp(p.sy + Math.cos(ts * 0.7 + p.z * 30) * 6, ty, e);
        const al = sstep(p.d0, p.d0 + 500, T) * (0.25 + 0.75 * p.z) * (e > 0 ? 0.55 + 0.45 * e : 0.4) * fade;
        if (al < 0.02) continue;
        const col = e < 0.5 ? (p.z > 0.6 ? rgb : WHITE) : rgb;
        const sz = (1 + p.z * 2) * (0.8 + 0.4 * e);
        c.globalAlpha = al;
        c.drawImage(spr(col), x - sz, y - sz, sz * 2, sz * 2);
      }
      c.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Anything skips it: a click or tap anywhere, or a key. The click still lands where it was aimed.
    const skip = () => finish();
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("keydown", skip, true);
    window.addEventListener("wheel", skip, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("wheel", skip, true);
      if (!done.end) FAN.am = 1;
    };
  }, []);

  return createPortal(
    <div className="wv-opening" aria-hidden="true">
      <div ref={veil} className="wv-opening__veil">
        <p>Tap or press any key to skip</p>
      </div>
      <canvas ref={cv} className="wv-opening__fx" />
    </div>,
    document.body,
  );
}
