import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { reducedMotion } from "../sigils/motion.tsx";
import { GRID, pointOn, rgbOf, seats, sigilOf, sigilPath, strokeLength, type RoomSigil } from "../sigils/roomSigils.ts";
import { clamp, eOut, spr, TAU } from "../sigils/wvCanvas.ts";
import { CAP_MS, ReadyGate, RoomReadyContext } from "./roomReady.ts";
import "./roomLoader.css";

/**
 * The room loader (#752): one short cover for every Desk page, from the moment it is opened until it is ready (its
 * chunk loaded, every gate it opened with `useRoomReady` open, then one frame drawn), so a room never pops in piece
 * by piece. Motes gather from the dark into the room's own sigil (roomSigils.ts) in its accent colour, the hairlines
 * draw in under them, and the room's name sits between two gold rules. Then it fades.
 *
 *   - A page that is ready in the same commit it mounts in (its code already fetched, nothing to wait for) is never
 *     covered at all: no delay for its own sake.
 *   - A page opened before shows its sigil later (only a longer wait shows more than the veil) and fades faster.
 *   - Nothing is covered for longer than `cap` (CAP_MS, 4 s, unless the host gives a room with a 3D scene longer),
 *     whether the page signals or not.
 *   - With reduced motion the sigil is a still and the cover simply fades.
 *
 * The cover sits over the page (not the bar, Ask Skippy or the room mic), and takes no clicks. A room the Desk keeps
 * mounted out of sight (#759) passes `shown={false}`: it keeps counting towards ready, and shows no cover.
 */

/** Rooms that have been ready once this visit. */
const SEEN = new Set<string>();

type Phase = "cover" | "leave" | "gone";

/** The Desk's gold, as on the C.E.O. mark's core. */
const GOLD = "232,207,156";

export function RoomLoader({ room, name, accent, shown = true, cap = CAP_MS, children }: { room: string; name: string; accent: string; shown?: boolean; cap?: number; children: ReactNode }) {
  const [revisit] = useState(() => SEEN.has(room));
  const [reduced] = useState(reducedMotion);
  const [phase, setPhase] = useState<Phase>("cover");
  const [fade, setFade] = useState(460);
  const t0 = useRef(0);
  // True until this component's own layout effect has run: a page ready by then was never painted under a cover.
  const sync = useRef(true);
  const gate = useMemo(
    () =>
      new ReadyGate(() => {
        SEEN.add(room);
        if (sync.current) return setPhase("gone");
        const quick = performance.now() - t0.current < 180;
        setFade(quick ? 200 : reduced ? 280 : 460);
        // One frame for the page to draw under the cover, then the fade.
        requestAnimationFrame(() => requestAnimationFrame(() => setPhase((p) => (p === "cover" ? "leave" : p))));
      }),
    [room, reduced],
  );

  useLayoutEffect(() => {
    sync.current = false;
    t0.current = performance.now();
  }, []);

  useEffect(() => {
    if (phase === "cover") {
      const timer = window.setTimeout(() => {
        SEEN.add(room);
        setPhase((p) => (p === "cover" ? "leave" : p));
      }, cap);
      return () => window.clearTimeout(timer);
    }
    if (phase === "leave") {
      const t = window.setTimeout(() => setPhase("gone"), fade + 80);
      return () => window.clearTimeout(t);
    }
  }, [phase, fade, room, cap]);

  const sigil = sigilOf(room);
  const style = { "--rl-accent": `var(${accent})`, "--rl-fade": `${fade}ms`, "--rl-delay": revisit ? "240ms" : "70ms" } as CSSProperties;

  return (
    <RoomReadyContext.Provider value={gate}>
      {children}
      {shown && phase !== "gone" && (
        <div className="room-loader" data-phase={phase} role="status" aria-label={`Opening ${name}`} style={style}>
          <div className="room-loader__mark" aria-hidden="true">
            {reduced ? <SigilStill sigil={sigil} /> : <Swarm sigil={sigil} leaving={phase === "leave"} />}
          </div>
          <p className="room-loader__name" aria-hidden="true">
            <i />
            <span>{name}</span>
            <i />
          </p>
        </div>
      )}
    </RoomReadyContext.Provider>
  );
}

/** The sigil's box, as a share of the mark's square: the rest is the room the motes gather from. */
const BOX = 0.46;

function SigilStill({ sigil }: { sigil: RoomSigil }) {
  const pad = (GRID / BOX - GRID) / 2;
  return (
    <svg viewBox={`${-pad} ${-pad} ${GRID + pad * 2} ${GRID + pad * 2}`}>
      <path className="room-loader__still" d={sigilPath(sigil)} />
      {sigil.nodes.map(([x, y]) => (
        <circle key={`${x},${y}`} className="room-loader__node" cx={x} cy={y} r={1.1} />
      ))}
    </svg>
  );
}

interface Mote {
  stroke: number;
  u: number;
  /** Drift along its stroke, in grid units a second. */
  v: number;
  sx: number;
  sy: number;
  spin: number;
  delay: number;
  dur: number;
  r: number;
  gold: boolean;
  tw: number;
  ph: number;
}

/** Ping-pong a position into 0..1, so a mote drifting along an open stroke turns at its ends. */
const pingpong = (x: number) => 1 - Math.abs((((x % 2) + 2) % 2) - 1);

/** The motes gathering into the sigil, on one small canvas with its own loop (it lives for a second or two). */
function Swarm({ sigil, leaving }: { sigil: RoomSigil; leaving: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const leaveAt = useRef<number | null>(null);
  useEffect(() => {
    if (leaving && leaveAt.current === null) leaveAt.current = performance.now();
  }, [leaving]);

  useEffect(() => {
    const c = cv.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const w = c.clientWidth || 320;
    const h = c.clientHeight || 320;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rgb = rgbOf(getComputedStyle(c).getPropertyValue("--rl-accent"));
    const k = (Math.min(w, h) * BOX) / GRID;
    const ox = w / 2 - (GRID / 2) * k;
    const oy = h / 2 - (GRID / 2) * k;
    const lens = sigil.strokes.map(strokeLength);
    const half = Math.min(w, h) / 2;
    const n = w < 300 ? 130 : 170;
    const motes: Mote[] = seats(sigil, n).map((s, i) => {
      const a = Math.random() * TAU;
      const r = half * (0.62 + Math.random() * 0.4);
      return {
        stroke: s.stroke,
        u: s.u,
        v: (Math.random() - 0.5) * 1.6,
        sx: w / 2 + Math.cos(a) * r,
        sy: h / 2 + Math.sin(a) * r,
        spin: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7),
        // Roughly in the order the strokes are drawn, so the sigil gathers rather than snaps.
        delay: (i / n) * 260 + Math.random() * 320,
        dur: 760 + Math.random() * 440,
        r: 0.9 + Math.random() * 1.2,
        gold: Math.random() < 0.12,
        tw: 2 + Math.random() * 3,
        ph: Math.random() * TAU,
      };
    });
    const dotA = spr(rgb);
    const dotG = spr(GOLD);
    const start = performance.now();
    let raf = 0;

    const draw = (now: number) => {
      const t = now - start;
      const ts = t / 1000;
      const out = leaveAt.current === null ? 0 : eOut((now - leaveAt.current) / 520);
      g.clearRect(0, 0, w, h);

      // The hairlines draw in under the motes, one stroke after another.
      g.lineCap = "round";
      g.lineJoin = "round";
      sigil.strokes.forEach((s, i) => {
        const f = clamp((t - 420 - i * 110) / 700, 0, 1);
        if (!f) return;
        g.beginPath();
        let left = f * lens[i]!;
        g.moveTo(ox + s[0]![0] * k, oy + s[0]![1] * k);
        for (let j = 1; j < s.length && left > 0; j++) {
          const [ax, ay] = s[j - 1]!;
          const [bx, by] = s[j]!;
          const l = Math.hypot(bx - ax, by - ay);
          const q = l ? Math.min(1, left / l) : 1;
          g.lineTo(ox + (ax + (bx - ax) * q) * k, oy + (ay + (by - ay) * q) * k);
          left -= l;
        }
        g.strokeStyle = `rgba(${rgb},${0.07 * (1 - out)})`;
        g.lineWidth = 3.2;
        g.stroke();
        g.strokeStyle = `rgba(${rgb},${0.34 * (1 - out)})`;
        g.lineWidth = 1;
        g.stroke();
      });

      g.globalCompositeOperation = "lighter";
      for (const m of motes) {
        const e = eOut((t - m.delay) / m.dur);
        if (e <= 0) continue;
        const len = lens[m.stroke] || 1;
        const [px, py] = pointOn(sigil.strokes[m.stroke]!, pingpong(m.u + (m.v * Math.max(0, ts - 1)) / len));
        const tx = ox + px * k;
        const ty = oy + py * k;
        // A curving approach: the offset from the seat turns as it shrinks.
        const rot = (1 - e) * m.spin;
        const dx = (m.sx - tx) * (1 - e);
        const dy = (m.sy - ty) * (1 - e);
        let x = tx + dx * Math.cos(rot) - dy * Math.sin(rot);
        let y = ty + dx * Math.sin(rot) + dy * Math.cos(rot);
        if (out) {
          x += (x - w / 2) * out * 0.12;
          y += (y - h / 2) * out * 0.12;
        }
        const tw = e >= 1 ? 0.72 + 0.28 * Math.sin(ts * m.tw + m.ph) : 1;
        const s = m.r * (m.gold ? 5.5 : 4.6);
        g.globalAlpha = Math.min(1, e * 1.2) * tw * (m.gold ? 0.85 : 0.75) * (1 - out);
        g.drawImage(m.gold ? dotG : dotA, x - s / 2, y - s / 2, s, s);
      }

      // The gold glints, once the motes are in.
      const glint = eOut((t - 1150) / 600);
      if (glint > 0)
        for (const [nx, ny] of sigil.nodes) {
          const s = 16 + 3 * Math.sin(ts * 2.1);
          g.globalAlpha = glint * 0.9 * (1 - out);
          g.drawImage(dotG, ox + nx * k - s / 2, oy + ny * k - s / 2, s, s);
        }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [sigil]);

  return <canvas ref={cv} />;
}
