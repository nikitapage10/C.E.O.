import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { reducedMotion } from "../sigils/motion.tsx";
import { GRID, pointOn, rgbOf, seats, sigilOf, sigilPath, type RoomSigil } from "../sigils/roomSigils.ts";
import { TAU } from "../sigils/wvCanvas.ts";
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
            {reduced ? <SigilStill sigil={sigil} /> : <Swarm sigil={sigil} />}
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

/** Ping-pong a position into 0..1, so a drift along an open stroke turns at its ends. */
const pingpong = (x: number) => 1 - Math.abs((((x % 2) + 2) % 2) - 1);

/** The approach's curve: a cubic ease-out, as the hairlines draw. */
const EASE = "cubic-bezier(0.22, 0.61, 0.24, 1)";

/**
 * The motes gathering into the sigil (#784). Each mote, hairline and glint is a small element with its own Web
 * Animation of transform and opacity only, set up once before the first paint. The browser runs those on the
 * compositor, so they keep moving while the page behind the cover holds the main thread: a 3D scene's build, a big
 * JSON parse, a shader compile. (The first version drew on a canvas from a requestAnimationFrame loop, which froze
 * whenever the main thread did, mid-gather, as Today's chamber built.)
 */
function Swarm({ sigil }: { sigil: RoomSigil }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || typeof el.animate !== "function") return;
    const w = el.clientWidth || 320;
    const h = el.clientHeight || 320;
    el.style.setProperty("--rl-rgb", rgbOf(getComputedStyle(el).getPropertyValue("--rl-accent")));
    const k = (Math.min(w, h) * BOX) / GRID;
    const ox = w / 2 - (GRID / 2) * k;
    const oy = h / 2 - (GRID / 2) * k;
    const half = Math.min(w, h) / 2;
    const anims: Animation[] = [];
    const add = (node: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) => anims.push(node.animate(frames, { fill: "both", ...opts }));
    const frag = document.createDocumentFragment();

    // The hairlines: one small SVG per stroke, so each fades in on the compositor, one after another.
    const pad = (GRID / BOX - GRID) / 2;
    sigil.strokes.forEach((s, i) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", `${-pad} ${-pad} ${GRID + pad * 2} ${GRID + pad * 2}`);
      svg.setAttribute("class", "room-loader__line");
      const d = s.map(([x, y], j) => `${j ? "L" : "M"}${x} ${y}`).join("");
      svg.innerHTML = `<path class="room-loader__glow" d="${d}"/><path d="${d}"/>`;
      frag.append(svg);
      add(svg, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 420 + i * 110, easing: "ease-out" });
    });

    // The motes: in from the dark on a curve, then a slow drift along their stroke and a twinkle, for as long as it takes.
    const n = w < 300 ? 110 : 140;
    seats(sigil, n).forEach((s, i) => {
      const stroke = sigil.strokes[s.stroke]!;
      const [px, py] = pointOn(stroke, s.u);
      const tx = ox + px * k;
      const ty = oy + py * k;
      const a = Math.random() * TAU;
      const r = half * (0.62 + Math.random() * 0.4);
      const dx = w / 2 + Math.cos(a) * r - tx;
      const dy = h / 2 + Math.sin(a) * r - ty;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7);
      const gold = Math.random() < 0.12;
      const size = (0.9 + Math.random() * 1.2) * (gold ? 5.5 : 4.6);
      // The curve's midpoint: the offset from the seat, turned and shrunk.
      const at = (f: number) => {
        const rot = f * spin;
        const x = tx + (dx * Math.cos(rot) - dy * Math.sin(rot)) * f;
        const y = ty + (dx * Math.sin(rot) + dy * Math.cos(rot)) * f;
        return `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px)`;
      };
      const delay = (i / n) * 260 + Math.random() * 320;
      const dur = 760 + Math.random() * 440;
      const m = document.createElement("i");
      m.className = gold ? "room-loader__mote is-gold" : "room-loader__mote";
      m.style.width = m.style.height = `${size.toFixed(1)}px`;
      const dot = document.createElement("b");
      m.append(dot);
      frag.append(m);
      add(m, [{ transform: at(1), opacity: 0 }, { transform: at(0.4), opacity: 0.7, offset: 0.45 }, { transform: at(0.12), opacity: 0.85, offset: 0.75 }, { transform: at(0), opacity: gold ? 0.9 : 0.8 }], { duration: dur, delay, easing: EASE });
      // Along the stroke a little, back and forth, and a twinkle: endless, until the cover goes.
      const [qx, qy] = pointOn(stroke, pingpong(s.u + (Math.random() - 0.5) * 0.06));
      add(dot, [{ transform: "translate(0, 0)", opacity: 1 }, { transform: `translate(${((qx - px) * k).toFixed(1)}px, ${((qy - py) * k).toFixed(1)}px)`, opacity: 0.45 }], {
        duration: 1300 + Math.random() * 1700,
        delay: delay + dur,
        direction: "alternate",
        iterations: Infinity,
        easing: "ease-in-out",
      });
    });

    // The gold glints, once the motes are in.
    for (const [nx, ny] of sigil.nodes) {
      const g = document.createElement("i");
      g.className = "room-loader__glint";
      g.style.transform = `translate(${(ox + nx * k - 8).toFixed(1)}px, ${(oy + ny * k - 8).toFixed(1)}px)`;
      const core = document.createElement("b");
      g.append(core);
      frag.append(g);
      add(core, [{ opacity: 0, transform: "scale(0.4)" }, { opacity: 0.9, transform: "scale(1)" }], { duration: 600, delay: 1150, easing: EASE });
      add(g, [{ opacity: 1 }, { opacity: 0.7 }], { duration: 1500, delay: 1750, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
    }

    el.append(frag);
    return () => {
      for (const an of anims) an.cancel();
      el.replaceChildren();
    };
  }, [sigil]);
  return <div ref={host} className="room-loader__swarm" />;
}
