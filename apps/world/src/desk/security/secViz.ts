import { bez, knot, lerp, OK, Parts, Poly, RC, ring, TAU, weave, WHITE, BAD, type VizSpec } from "../wvCanvas.ts";

/**
 * The woven pieces of Security and Compliance (desk-concepts round five, 82-viz.js "beads", "tmap", "ring"): a thread
 * through the scans with a knot on each, the trust map's threads between the zones, and a framework's ring, one
 * strand per control. Shapes only; every value they show comes from the page.
 */

export type Bead = "ok" | "bad" | "off";
const BEAD_RGB: Record<Bead, string> = { ok: OK, bad: BAD, off: WHITE };

/** A thread along the row of scans, a knot over each: green when it passed, red when it failed, faint when unknown. */
export function beadsSpec(states: Bead[]): VizSpec {
  let ks: { x: number; s: Bead }[] = [];
  let poly = new Poly();
  let P: Parts | null = null;
  const y = 30;
  return {
    lay(V) {
      const host = V.cv.parentElement;
      const lis = host ? [...host.querySelectorAll(".wv-scans-l li")] : [];
      ks = lis.map((li, i) => {
        const r = V.rel(li);
        return { x: r.x + r.w / 2, s: states[i] ?? "off" };
      });
      poly = new Poly().set([0, V.W], [y, y]);
      P ??= new Parts(200, 0.1);
    },
    draw(V, c, t, dt) {
      const bad = states.includes("bad");
      weave(c, poly, P, { a: 0.7, sp: 1.6, sz: 0.6, v: 22, line: 0.15, rgb: bad ? BAD : OK, rgb2: WHITE, jit: 0.3 }, t, dt);
      ks.forEach((k, i) => (k.s === "off" ? ring(c, k.x, y, 4, WHITE, 0.45, [2, 2]) : knot(c, k.x, y, 0.55, t + i, BEAD_RGB[k.s], 1)));
    },
  };
}

/** One thread per trust boundary, between the chips of the zones it joins (`[data-tn]`). Planned ones are dashed. */
export function tmapSpec(edges: { id: string; from: string; to: string; wait: boolean }[], ctl: { current: string | null }): VizSpec {
  let E: { id: string; poly: Poly; P: Parts; wait: boolean }[] = [];
  return {
    lay(V) {
      const host = V.cv.parentElement;
      const nodes: Record<string, { l: number; r: number; y: number; cx: number }> = {};
      host?.querySelectorAll<HTMLElement>("[data-tn]").forEach((el) => {
        const r = V.rel(el);
        nodes[el.dataset.tn!] = { l: r.x, r: r.x + r.w, y: r.y + r.h / 2, cx: r.x + r.w / 2 };
      });
      E = [];
      for (const e of edges) {
        const a = nodes[e.from];
        const b = nodes[e.to];
        if (!a || !b) continue;
        const xs = new Array<number>(30);
        const ys = new Array<number>(30);
        if (Math.abs(a.cx - b.cx) < 4) {
          // Two zones in the same column: the thread bows out to the right of them.
          const x = Math.max(a.r, b.r) + 2;
          bez(x, a.y, x + 34, a.y, x + 34, b.y, x, b.y, 30, xs, ys);
        } else {
          const ltr = b.cx > a.cx;
          const x0 = ltr ? a.r + 2 : a.l - 2;
          const x1 = ltr ? b.l - 2 : b.r + 2;
          const mx = (x0 + x1) / 2;
          bez(x0, a.y, mx, a.y, mx, b.y, x1, b.y, 30, xs, ys);
        }
        E.push({ id: e.id, poly: new Poly().set(xs, ys), P: new Parts(e.wait ? 10 : 40, 0.1), wait: e.wait });
      }
    },
    draw(_V, c, t, dt) {
      const hot = ctl.current;
      for (const e of E) {
        const on = hot === e.id;
        const dim = hot && !on ? 0.4 : 1;
        if (e.wait) weave(c, e.poly, e.P, { a: 0.4 * dim, sp: 0.6, sz: 0.55, v: 0, rgb: RC.relay, line: (on ? 0.7 : 0.35) * dim, dash: [3, 4], nofade: true }, t, 0);
        else weave(c, e.poly, e.P, { a: (on ? 1 : 0.8) * dim, sp: on ? 1.3 : 0.9, sz: on ? 0.75 : 0.55, v: 30, rgb: OK, rgb2: WHITE, line: (on ? 0.45 : 0.14) * dim, lw: on ? 1.4 : 1 }, t, dt);
      }
    },
  };
}

/** A framework's ring: one arc per control, its strength 0..1 (0 draws a faint dotted arc). */
export function ringSpec(segs: number[], room: string): VizSpec {
  let arcs: { s: number; poly: Poly; P: Parts }[] = [];
  const rgb = RC[room] ?? OK;
  return {
    lay(V) {
      const r = Math.min(V.W, V.H) / 2 - 14;
      const n = Math.max(1, segs.length);
      const gap = Math.min(0.05, 1 / n);
      arcs = segs.map((s, i) => {
        const a0 = -Math.PI / 2 + (i / n) * TAU + gap / 2;
        const a1 = -Math.PI / 2 + ((i + 1) / n) * TAU - gap / 2;
        const xs: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k <= 16; k++) {
          const a = lerp(a0, a1, k / 16);
          xs.push(V.W / 2 + Math.cos(a) * r);
          ys.push(V.H / 2 + Math.sin(a) * r);
        }
        return { s, poly: new Poly().set(xs, ys), P: new Parts(Math.round((10 + s * 26) * (12 / Math.max(6, n))), 0.1) };
      });
    },
    draw(_V, c, t, dt) {
      for (const a of arcs) {
        if (a.s <= 0) {
          c.globalAlpha = 1;
          c.strokeStyle = `rgba(${WHITE},.18)`;
          c.setLineDash([1.5, 4]);
          c.lineWidth = 1;
          a.poly.stroke(c);
          c.setLineDash([]);
          continue;
        }
        weave(c, a.poly, a.P, { a: 0.4 + 0.6 * a.s, sp: a.s > 0.9 ? 2.4 : 1.4, sz: 0.65, v: 12, rgb, rgb2: WHITE, line: 0.1 + 0.25 * a.s, lw: 1.2, jit: 0.3 }, t, dt);
      }
    },
  };
}
