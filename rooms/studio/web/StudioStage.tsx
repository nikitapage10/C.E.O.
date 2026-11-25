import { useEffect, useRef, useState, type ReactNode } from "react";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useSceneReady } from "@ceo/engine/web/roomReady.ts";
import type { Soundstage, StudioView } from "./soundstage.ts";

/** What the page drives on the stage once the 3D is up (#1229). */
export type StageApi = Pick<Soundstage, "screens" | "focus" | "setVideo">;

/**
 * The Studio's stage (#828): the edit suite and the sound stage behind it in 3D (soundstage.ts, lazy loaded with
 * three.js), with the page's head laid over it and three small labels riding their places. Until the 3D is up, and on a
 * device without WebGL, a flat stage drawn in CSS stands in, so the page is whole at once. The scene's monitors show
 * the desk as the page has it (`view`; #1227), and once the 3D is up the page renders its working screens onto them and
 * drives the camera and the cut on the stage through `onReady` (#1229).
 */

type GL = "idle" | "loading" | "on" | "off";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches;
export function StudioStage({ view, children, onReady, onFrame }: { view: StudioView; children: ReactNode; onReady?: (api: StageApi | null) => void; onFrame?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Soundstage | null>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const [gl, setGl] = useState<GL>("idle");
  useSceneReady(gl === "on" || gl === "off");
  const viewRef = useRef(view);
  viewRef.current = view;
  const cb = useRef({ onReady, onFrame });
  cb.current = { onReady, onFrame };
  const labelList: [string, string][] = [
    ["suite", "The edit suite"],
    ["stage", "The stage · 9:16"],
    ["camera", view.rolling ? "Camera · rolling" : "Camera · not rolling"],
  ];

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
            view: viewRef.current,
            onFrame: () => cb.current.onFrame?.(),
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
          cb.current.onReady?.({ screens: s.screens, focus: s.focus, setVideo: s.setVideo });
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
      cb.current.onReady?.(null);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.set(view);
  }, [view, gl]);

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
        {labelList.map(([id, t]) => (
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
