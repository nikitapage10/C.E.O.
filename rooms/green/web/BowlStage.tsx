import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { onBye, pct, pts, yardLine } from "../data/league.ts";
import type { Bowl } from "./bowl.ts";
import { fpPts, manId, surname, type BowlView, type Man } from "./bowlView.ts";
import { Face } from "./faces.tsx";

/**
 * The Green's stage (#824): the bowl in 3D (bowl.ts, lazy loaded with three.js) filling the screen under the bar, with
 * a tag riding each starter's pillar (his face, his points, his slot) and the ball's yard line. What the page lays
 * over the scene (the scorebug, the calls) comes in as children. Until the 3D is up, and on a device without WebGL, a
 * flat drawing of the bowl stands in under the same overlays, so the room is whole and usable at once.
 */

type GL = "idle" | "loading" | "on" | "off";
const PHONE_Q = "(max-width: 760px)";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_Q).matches;
const INJ: Record<string, string> = { Q: "Questionable", D: "Doubtful", O: "Out", IR: "On IR", SUS: "Suspended", PUP: "PUP", NA: "Not active" };
const MARK: Record<string, string> = { sit: "FantasyPros sits him", bye: "on bye", out: "out", empty: "empty" };

export interface StageProps {
  view: BowlView;
  ups: { mine: Man[]; theirs: Man[] };
  week: number;
  label: string;
  onLineup: () => void;
  children: ReactNode;
}

export function BowlStage({ view, ups, week, label, onLineup, children }: StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Bowl | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const at = useRef(new Map<string, [number, number, boolean]>());
  const [gl, setGl] = useState<GL>("idle");
  useRoomReady(gl === "on" || gl === "off");
  const live = useRef(view);
  live.current = view;
  const settle = useRef(0);
  // The tags ride their pillars but never cover one another: yours first, then the ball's, then theirs; one that
  // would cover a tag already placed is lifted above it, and dropped if it still can't fit.
  const spread = () => {
    settle.current = 0;
    const order = [...els.current.keys()].sort((a, b) => rankOf(a) - rankOf(b));
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    for (const id of order) {
      const el = els.current.get(id)!;
      const p = at.current.get(id);
      if (!p || !p[2]) {
        el.classList.add("is-away");
        continue;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const x = p[0];
      let y = p[1];
      let ok = false;
      for (let k = 0; k < 5; k++) {
        const box = { l: x - w / 2 - 2, r: x + w / 2 + 2, t: y - h - 2, b: y + 2 };
        const hit = boxes.find((o) => o.l < box.r && box.l < o.r && o.t < box.b && box.t < o.b);
        if (!hit) {
          boxes.push(box);
          ok = true;
          break;
        }
        y = hit.t - 2;
      }
      el.classList.toggle("is-away", !ok || y - h < 0);
      el.style.setProperty("--gx", `${Math.round(x)}px`);
      el.style.setProperty("--gy", `${Math.round(y)}px`);
    }
  };
  const respread = useRef(() => {});
  respread.current = () => {
    if (!settle.current) settle.current = requestAnimationFrame(spread);
  };

  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el) return;
    let dead = false;
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./bowl.ts")
        .then((m) => {
          if (!m.canDraw3D()) throw new Error("no WebGL");
          return m.createBowl(el, cv, {
            phone: isPhone(),
            reduce: reducedMotion(),
            view: live.current,
            onPlace: (id, x, y, on) => {
              at.current.set(id, [x, y, on]);
              respread.current();
            },
          });
        })
        .then((s) => {
          if (dead) return s.dispose();
          scene.current = s;
          setGl("on");
        })
        .catch(() => !dead && setGl("off"));
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const viaIdle = typeof w.requestIdleCallback === "function";
    const idle = viaIdle ? w.requestIdleCallback!(start, { timeout: 600 }) : window.setTimeout(start, 120);
    return () => {
      dead = true;
      cancelAnimationFrame(settle.current);
      if (viaIdle) w.cancelIdleCallback?.(idle);
      else window.clearTimeout(idle);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  const sig = JSON.stringify(view);
  useEffect(() => {
    scene.current?.set(live.current);
  }, [sig, gl]);

  const ref = (id: string) => (el: HTMLElement | null) => {
    if (!el) {
      els.current.delete(id);
      return;
    }
    els.current.set(id, el);
    if (at.current.size) respread.current();
  };
  const yd = view.win === null || !view.them ? null : yardLine(view.win);

  return (
    <section className="gd-bowl" data-gl={gl} aria-label={`The bowl: this week's matchup. ${label}`}>
      <div className="gd-bowl-flat" aria-hidden="true">
        <i className="gd-bowl-sky" />
        <i className="gd-bowl-stands" />
        <i className="gd-bowl-field" />
      </div>
      <div ref={host} className="gd-bowl-host">
        <canvas ref={canvas} className="gd-bowl-gl" aria-hidden="true" />
      </div>
      <ul className="gd-bowl-tags" aria-label="Both lineups on the field">
        {[...ups.mine, ...ups.theirs].map((x) => {
          const id = manId(x);
          const { p, tok } = x;
          const shown = view.live ? x.pts : tok.proj;
          const what = p ? `${x.mine ? "Yours" : "Theirs"}: ${tok.slot} ${p.name}${tok.state ? `, ${tok.state === "out" && p.inj ? INJ[p.inj] : MARK[tok.state]}` : ""}. ${view.live ? `${pts(x.pts)} scored, ` : ""}FantasyPros ${pts(fpPts(p))}${x.risk ? ", late-game risk" : ""}` : `${tok.slot}: empty`;
          return (
            <li key={id}>
              <button type="button" ref={ref(id)} className={`gd-pin ${x.mine ? "is-mine" : "is-theirs"}`} data-mark={tok.state || (p && onBye(p, week) ? "bye" : undefined)} data-risk={x.risk || undefined} onClick={onLineup} title={what} aria-label={what}>
                {p ? <Face p={p} size={x.mine ? 26 : 20} /> : <span className="gd-face is-empty" style={{ "--s": `${x.mine ? 26 : 20}px` } as CSSProperties} />}
                <b>{p ? pts(shown) : "–"}</b>
                <small>
                  <i>{/FLEX/.test(tok.slot) ? "FX" : tok.slot}</i>
                  {p ? ` ${surname(p.name)}` : ""}
                </small>
                {tok.state === "sit" && <em>Sit</em>}
                {tok.state === "out" && p?.inj && <em className="is-out">{p.inj}</em>}
                {tok.state === "bye" && <em>Bye</em>}
              </button>
            </li>
          );
        })}
        {yd && view.win !== null && (
          <li aria-hidden="true">
            <span ref={ref("ball")} className="gd-pin is-ball">
              <b>{pct(view.win)}</b>
              <small>{yd.words.toLowerCase()}</small>
            </span>
          </li>
        )}
      </ul>
      {children}
    </section>
  );
}

const rankOf = (id: string) => (id === "ball" ? 1 : id.startsWith("t:") ? 2 : 0);
