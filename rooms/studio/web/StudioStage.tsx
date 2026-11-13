import { useEffect, useRef, useState, type ReactNode } from "react";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useSceneReady } from "@ceo/engine/web/roomReady.ts";
import { EPISODES, LINE } from "./line.ts";
import type { Soundstage, StudioView } from "./soundstage.ts";

/**
 * The Studio's stage (#828): the edit suite and the sound stage behind it in 3D (soundstage.ts, lazy loaded with
 * three.js), with the page's head laid over it and three small labels riding their places. Until the 3D is up, and on a
 * device without WebGL, a flat stage drawn in CSS stands in, so the page is whole at once. The scene's monitors show
 * the step the page has selected (`sel`).
 */

type GL = "idle" | "loading" | "on" | "off";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches;
const LABELS: [string, string][] = [
  ["suite", "The edit suite"],
  ["stage", "The stage · 9:16"],
  ["camera", "Camera · not rolling"],
];

export function StudioStage({ sel, children }: { sel: number; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Soundstage | null>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const [gl, setGl] = useState<GL>("idle");
  useSceneReady(gl === "on" || gl === "off");
  const view = (s: number): StudioView => ({ steps: LINE, sel: s, episodes: EPISODES.map((e) => e.t) });
  const selRef = useRef(sel);
  selRef.current = sel;

  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el) return;
    let dead = false;
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./soundstage.ts")
        .then((m) => {
          if (!m.canDraw3D()) throw new Error("no WebGL");
          return m.createSoundstage(el, cv, {
            phone: isPhone(),
            reduce: reducedMotion(),
            view: view(selRef.current),
            onPlace: (id, x, y, on) => {
              const t = labels.current.get(id);
              if (!t) return;
              t.style.setProperty("--gx", `${Math.round(x)}px`);
              t.style.setProperty("--gy", `${Math.round(y)}px`);
              t.classList.toggle("is-away", !on);
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
      if (viaIdle) w.cancelIdleCallback?.(idle);
      else window.clearTimeout(idle);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.set(view(sel));
  }, [sel, gl]);

  return (
    <section className="st-stage" data-gl={gl} aria-label="The Studio: the edit suite, and the sound stage behind it">
      <div className="st-flat" aria-hidden="true">
        <i className="st-flat-cyc" />
        <i className="st-flat-truss" />
        <i className="st-flat-frame" />
        <i className="st-flat-desk" />
        <i className="st-flat-mon is-tall" />
        <i className="st-flat-mon is-wide" />
        <i className="st-flat-mon is-bin" />
      </div>
      <div ref={host} className="st-host">
        <canvas ref={canvas} className="st-gl" aria-hidden="true" />
      </div>
      <div className="st-vig" aria-hidden="true" />
      <div className="st-labels" aria-hidden="true">
        {LABELS.map(([id, t]) => (
          <span
            key={id}
            className="st-label"
            ref={(el) => {
              if (el) labels.current.set(id, el);
              else labels.current.delete(id);
            }}
          >
            {t}
          </span>
        ))}
      </div>
      {children}
    </section>
  );
}
