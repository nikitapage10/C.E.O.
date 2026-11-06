import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import type { BedState, GlassPopup, GlassView, Glasshouse as Scene } from "./glasshouse.ts";

/**
 * The Annex's stage (#829): the Glasshouse in 3D (glasshouse.ts, lazy loaded with three.js), with a tag riding each
 * pop-up wherever it is (its bed, its seed in the vault, its plot), each free bed, the vault and the plot. A tag opens
 * the pop-up's row below. Until the 3D is up, and on a device without WebGL, a flat drawing of the dome stands in with
 * the same tags, so the room is whole and usable at once.
 */

type GL = "idle" | "loading" | "on" | "off";
const PHONE_Q = "(max-width: 760px)";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_Q).matches;
/** Where the tags stand in the flat drawing (percent of the stage): beds round the carousel, the vault low, the plot past the door. */
const FLAT_BED: [number, number][] = [
  [38, 44],
  [56, 36],
  [64, 56],
  [44, 62],
];
const FLAT: Record<string, [number, number]> = { vault: [24, 82], plot: [86, 42] };
const rank = (id: string) => (id.startsWith("free-") ? 3 : id === "vault" || id === "plot" ? 2 : 1);
const WHERE: Record<BedState, string> = { bed: "Growing", vault: "Seed · on the Shelf", plot: "Own plot" };

export interface StageProps {
  view: GlassView;
  /** Notes for the tags ("38 of 470 called"), by pop-up. */
  notes: Record<string, string>;
  onPick: (id: string) => void;
  /** The page's head, laid over the top of the stage (#932). */
  children?: ReactNode;
}

export function GlassStage({ view, notes, onPick, children }: StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<Scene | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const at = useRef(new Map<string, [number, number, boolean]>());
  const [gl, setGl] = useState<GL>("idle");
  useRoomReady(gl === "on" || gl === "off");
  const live = useRef(view);
  live.current = view;
  const pick = useRef(onPick);
  pick.current = onPick;
  const settle = useRef(0);
  const sect = useRef<HTMLElement>(null);
  /** How much of the stage's height the head lies over, kept fresh on resize (#932). */
  const headroom = useRef(0);
  // The tags ride their anchors but never cover one another: the pop-ups' own tags first, then the vault and the plot,
  // then the free beds; one that would cover a tag already placed is lifted above it, and dropped if it still can't fit.
  const spread = () => {
    settle.current = 0;
    const order = [...els.current.keys()].sort((a, b) => rank(a) - rank(b));
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    // The head's words and numbers: a tag never lands on them; it drops below them instead (#932).
    const fixed: { l: number; r: number; t: number; b: number }[] = [];
    const st = sect.current;
    if (st) {
      const top = st.getBoundingClientRect();
      for (const el of st.querySelectorAll(".an-head>*")) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) fixed.push({ l: r.left - top.left - 6, r: r.right - top.left + 6, t: r.top - top.top - 6, b: r.bottom - top.top + 6 });
      }
    }
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
      let below = false;
      for (let k = 0; k < 6; k++) {
        below = el.classList.contains("is-below");
        const box = below ? { l: x - w / 2 - 4, r: x + w / 2 + 4, t: y + 8 - 4, b: y + 8 + h + 4 } : { l: x - w / 2 - 4, r: x + w / 2 + 4, t: y - 8 - h - 4, b: y - 8 + 4 };
        const over = fixed.find((o) => o.l < box.r && box.l < o.r && o.t < box.b && box.t < o.b);
        if (over && !below) {
          y = over.b + h + 8 + 2;
          continue;
        }
        const hit = boxes.find((o) => o.l < box.r && box.l < o.r && o.t < box.b && box.t < o.b);
        if (!hit) {
          boxes.push(box);
          ok = true;
          break;
        }
        y = below ? hit.b - 8 + 4 : hit.t + 8 - 4;
      }
      el.classList.toggle("is-away", !ok || (!below && y - h < 0));
      el.style.setProperty("--gx", `${Math.round(x)}px`);
      el.style.setProperty("--gy", `${Math.round(y)}px`);
    }
  };
  const respreadRef = useRef(() => {});
  respreadRef.current = () => {
    if (!settle.current) settle.current = requestAnimationFrame(spread);
  };
  const respread = () => respreadRef.current();

  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el) return;
    let dead = false;
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./glasshouse.ts")
        .then((m) => {
          if (!m.canDraw3D()) throw new Error("no WebGL");
          return m.createGlasshouse(el, cv, {
            phone: isPhone(),
            reduce: reducedMotion(),
            view: live.current,
            onPlace: (id, x, y, on) => {
              at.current.set(id, [x, y, on]);
              respreadRef.current();
            },
            onPick: (id) => pick.current(id),
            headroom: () => headroom.current,
          });
        })
        .then((s) => {
          if (dead) return s.dispose();
          scene.current = s;
          setGl("on");
        })
        .catch(() => !dead && setGl("off"));
    };
    const measure = () => {
      const st = sect.current;
      const hd = st?.querySelector(".an-head");
      if (!st || !hd || !st.clientHeight) return;
      const share = (hd.getBoundingClientRect().bottom - st.getBoundingClientRect().top + 16) / st.clientHeight;
      headroom.current = Math.max(0, Math.min(0.6, share)) * (isPhone() ? 1 : 0.7);
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const viaIdle = typeof w.requestIdleCallback === "function";
    const idle = viaIdle ? w.requestIdleCallback!(start, { timeout: 600 }) : window.setTimeout(start, 120);
    return () => {
      dead = true;
      ro?.disconnect();
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
    if (at.current.size) respread();
  };
  const flat = (xy: [number, number]) => ({ "--fx": `${xy[0]}%`, "--fy": `${xy[1]}%` }) as CSSProperties;
  const bedOf = (i: number) => i % 4;
  const inBeds = new Set(view.popups.map((p, i) => (p.state === "bed" ? bedOf(i) : -1)));
  const shelved = view.popups.filter((p) => p.state === "vault").length;
  const graduate = view.popups.find((p) => p.state === "plot");
  const flatOf = (p: GlassPopup, i: number): [number, number] => (p.state === "bed" ? FLAT_BED[bedOf(i)]! : p.state === "vault" ? [30 + i * 6, 76] : FLAT.plot!);

  return (
    <section ref={sect} className="an-gh" data-gl={gl} aria-label="The Glasshouse: running pop-ups in their beds, the Shelf's seed vault under the floor, the plot past the door">
      <div className="an-gh-flat" aria-hidden="true">
        <i className="an-gh-sky" />
        <i className="an-gh-dome" />
        <i className="an-gh-floor" />
      </div>
      <div ref={host} className="an-gh-host">
        <canvas ref={canvas} className="an-gh-gl" aria-hidden="true" />
      </div>
      <ul className="an-gh-tags">
        {view.popups.map((p, i) => (
          <li key={p.id}>
            <button type="button" ref={ref(p.id)} className={`an-tag${p.staked && p.state === "bed" ? " is-staked" : ""}`} data-where={p.state} style={flat(flatOf(p, i))} onClick={() => onPick(p.id)}>
              <b>{p.name}</b>
              <small>
                {p.ended && p.state === "bed" ? "Ended" : WHERE[p.state]}
                {p.state === "bed" && notes[p.id] ? ` · ${notes[p.id]}` : ""}
                {p.staked && p.state === "bed" ? " · followed" : ""}
              </small>
            </button>
          </li>
        ))}
        {[0, 1, 2, 3]
          .filter((i) => !inBeds.has(i))
          .map((i) => (
            <li key={`free-${i}`} aria-hidden="true">
              <span ref={ref(`free-${i}`)} className="an-tag is-free" style={flat(FLAT_BED[i]!)}>
                Free bed
              </span>
            </li>
          ))}
        <li aria-hidden="true">
          <span ref={ref("vault")} className="an-tag is-place is-below" style={flat(FLAT.vault!)}>
            Seed vault · the Shelf <small>{shelved ? `${shelved} ${shelved === 1 ? "seed" : "seeds"}` : "empty"}</small>
          </span>
        </li>
        <li aria-hidden="true">
          <span ref={ref("plot")} className={`an-tag is-place${graduate ? "" : " is-empty"}`} style={flat(FLAT.plot!)}>
            Out the door <small>{graduate ? `${graduate.name}'s plot` : "a plot for a graduate"}</small>
          </span>
        </li>
      </ul>
      {children}
    </section>
  );
}
