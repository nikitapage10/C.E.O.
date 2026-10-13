import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Vector3, type Group } from "three";
import { FAR_PLAN, ROOM_PLAN, arrangeBubbles, pageAt, planSpeech, typedAt, typedPerLine, type BubbleBox } from "./speech.ts";
import type { Voiced } from "./voices.ts";

/** Every bubble on screen this frame, so overlapping ones can lift apart. */
const onScreen = new Map<string, BubbleBox>();
/** The stem's resting length under a bubble (px); it stretches by however far the bubble is lifted. */
const STEM = 12;
const STEM_FAR = 8;
/** Keep clear of the top bar; a bubble that can't find room under it tucks away. */
const MIN_TOP = 64;
const PIP = { w: 30, h: 26 };
const PIP_FAR = { w: 30, h: 23 };
/** A tucked bubble stays tucked at least this long, so it doesn't flicker at the edge of fitting (ms). */
const TUCK_HOLD = 900;
const v = new Vector3();

function phaseOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A speaking agent's line, as a compact bubble that rides above its head: it pops up out of a stem that points at the
 * speaker, bobs gently, types its words out a few short lines at a time (paging when there is more to say), and
 * shrinks away when its time is up. When two bubbles would overlap, the later one rises above the earlier and its
 * stem stretches to keep pointing at its speaker; when there is no room left, it tucks into a little pip of dots
 * until there is. It never sits over the speaker's body.
 */
export function SpeechBubble({ id, name, accent, line, until, y, far }: {
  id: string;
  name: string;
  accent: string;
  line: Voiced;
  /** performance.now() time the line is done. */
  until: number;
  /** Where the stem starts: just over the head, in the agent's local space. */
  y: number;
  /** The small version, for the Lattice-wide view and the studio. */
  far?: boolean;
}) {
  const opts = far ? FAR_PLAN : ROOM_PLAN;
  const [born] = useState(() => performance.now());
  const plan = useMemo(() => planSpeech(line.text, until - born, opts, line.post), [line.text, line.post, until, born, opts]);
  const cps = useMemo(() => (reducedMotion() ? 0 : opts.cps), [opts.cps]);
  const [elapsed, setElapsed] = useState(0);

  // Tick quickly while typing, then sleep until the next page or the exit.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      const e = performance.now() - born;
      setElapsed(e);
      const p = pageAt(plan, e);
      const page = plan.pages[p]!;
      const since = e - plan.starts[p]!;
      const typing = typedAt(page, since, cps) < page.reduce((n, l) => n + l.text.length, 0);
      const next = Math.min(p + 1 < plan.starts.length ? plan.starts[p + 1]! : Infinity, e < plan.exitAt ? plan.exitAt : Infinity);
      if (typing) timer = setTimeout(wake, 1000 / Math.max(12, Math.min(cps, 40)));
      else if (Number.isFinite(next)) timer = setTimeout(wake, Math.max(16, next - e + 4));
    };
    wake();
    return () => clearTimeout(timer);
  }, [plan, born, cps]);

  const anchor = useRef<Group>(null);
  const outer = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 0, h: 0 });
  const lift = useRef(0);
  const tuck = useRef({ on: false, at: 0 });

  // The card renders in Html's own root, a moment after this component, so it is watched from the first frame it exists.
  const watching = useRef<{ el: HTMLElement; ro: ResizeObserver | null } | null>(null);
  useEffect(
    () => () => {
      watching.current?.ro?.disconnect();
      onScreen.delete(id);
    },
    [id],
  );

  // Keep this bubble's screen box in the shared list, and ease its lift toward clear air.
  useFrame(({ camera, size: view }, dt) => {
    if (!anchor.current || !outer.current || !card.current) return;
    if (watching.current?.el !== card.current) {
      const el = card.current;
      watching.current?.ro?.disconnect();
      const measure = () => {
        size.current = { w: el.offsetWidth, h: el.offsetHeight + (far ? STEM_FAR : STEM) };
      };
      measure();
      const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
      ro?.observe(el);
      watching.current = { el, ro };
    }
    anchor.current.getWorldPosition(v).project(camera);
    if (v.z > 1 || !size.current.w) {
      onScreen.delete(id);
    } else {
      onScreen.set(id, { id, x: ((v.x + 1) / 2) * view.width, y: ((1 - v.y) / 2) * view.height, w: size.current.w, h: size.current.h, order: born });
    }
    const spot = onScreen.has(id) ? arrangeBubbles([...onScreen.values()], { minTop: MIN_TOP, pip: far ? PIP_FAR : PIP })[id] : undefined;
    const now = performance.now();
    let tucked = spot?.tucked ?? false;
    if (tucked) tuck.current.at = now;
    else if (tuck.current.on && now - tuck.current.at < TUCK_HOLD) tucked = true;
    if (tucked !== tuck.current.on) {
      tuck.current.on = tucked;
      // A data attribute, not a class: React owns className and would wipe it on the next render.
      if (tucked) outer.current.dataset.tucked = "";
      else delete outer.current.dataset.tucked;
    }
    const want = spot?.lift ?? 0;
    const next = lift.current + (want - lift.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 9));
    if (Math.abs(next - lift.current) > 0.05 || (want === 0 && lift.current !== 0)) {
      lift.current = Math.abs(next - want) < 0.1 ? want : next;
      outer.current.style.setProperty("--lift", `${lift.current.toFixed(1)}px`);
    }
  });

  const p = pageAt(plan, elapsed);
  const page = plan.pages[p]!;
  const shown = typedPerLine(page, typedAt(page, elapsed - plan.starts[p]!, cps));
  const caretAt = shown.findIndex((n, j) => n < page[j]!.text.length);
  const leaving = elapsed >= plan.exitAt;
  const style = { "--accent": accent, "--bob": `${-phaseOf(id) * 3.4}s` } as CSSProperties;

  return (
    <group ref={anchor} position={[0, y, 0]}>
      <Html zIndexRange={[30, 0]} style={{ pointerEvents: "none" }}>
        <div ref={outer} className={`speech${far ? " speech--far" : ""}${leaving ? " speech--out" : ""}`} style={style} data-speech={id}>
          <div className="speech__bob">
            <div ref={card} className="speech__card">
              <div className="speech__head">
                <b>{name}</b>
                {line.pre && <span className="speech__pre">{line.pre}</span>}
                {plan.pages.length > 1 && (
                  <span className="speech__dots" aria-hidden>
                    {plan.pages.map((_, i) => (
                      <i key={i} className={i === p ? "on" : i < p ? "done" : undefined} />
                    ))}
                  </span>
                )}
              </div>
              <div className="speech__pages">
                {plan.pages.map((pg, i) => (
                  <div key={i} className={`speech__page ${i === p ? "is-on" : i < p ? "is-gone" : "is-next"}`} aria-hidden={i !== p}>
                    {pg.map((l, j) => {
                      const n = i < p ? l.text.length : i === p ? shown[j]! : 0;
                      return (
                        <span key={j} className={`speech__line${l.aside ? " speech__line--aside" : ""}`}>
                          {l.text.slice(0, n)}
                          {i === p && j === caretAt && <i className="speech__caret" />}
                          <span className="speech__ghost">{l.text.slice(n)}</span>
                        </span>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <span className="speech__pip" aria-hidden>
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className="speech__stem" />
        </div>
      </Html>
    </group>
  );
}
