import { clamp, dots, knot, lerp, Parts, Poly, RC, spr, TAU, weave, WHITE, isPhone, type VizSpec } from "./wvCanvas.ts";

/**
 * The Chronicle's woven pieces (desk-concepts round five, 82-viz.js "wave", "tloom", "week"): the story's waveform,
 * lit up to where the reading is; a thread per room that runs hot while the story is in that room; and the week as a
 * column of strands per day, one strand per room the day visited. Shapes only: every value comes from the page.
 */

/** Where the reading is, shared by the player and its canvases (read every frame, so no re-render is needed). */
export interface TaleClock {
  on: boolean;
  t: number;
  dur: number;
  room: string | null;
  told: Set<string>;
}

export function waveSpec(tale: { current: TaleClock }): VizSpec {
  let xs: number[] = [];
  let ys: number[] = [];
  let env: number[] = [];
  const poly = new Poly();
  let P: Parts | null = null;
  return {
    lay(V) {
      const n = Math.max(40, Math.round(V.W / 4));
      xs = [];
      ys = [];
      env = [];
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        xs.push(2 + (V.W - 4) * u);
        ys.push(V.H / 2);
        env.push(0.25 + 0.75 * Math.abs(Math.sin(u * 9.1) * 0.6 + Math.sin(u * 23.7 + 1) * 0.3 + Math.sin(u * 51.3 + 2) * 0.2));
      }
      poly.set(xs, ys);
      P = new Parts(Math.round(V.W * 1.1), 0);
    },
    draw(V, c, t, dt) {
      const T = tale.current;
      const on = T.on;
      const pr = T.dur ? clamp(T.t / T.dur, 0, 1) : 0;
      const n = xs.length;
      const amp = V.H / 2 - 4;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const k = env[i]! * (on ? 0.55 + 0.45 * Math.sin(t * 5 + i * 0.7) : 0.5);
        ys[i] = V.H / 2 + Math.sin(u * TAU * 7 + t * (on ? 3 : 0.6)) * amp * k * 0.6;
      }
      poly.set(xs, ys);
      const arc = RC.archive!;
      weave(c, poly, P, { a: 0.9, sp: on ? 2.6 : 1.4, sz: 0.6, v: on ? 60 : 14, line: 0.1, rgb: WHITE, nofade: true, I: (u) => (u <= pr ? 1 : 0.4), col: (u) => (u <= pr ? spr(arc) : spr(WHITE)) }, t, dt);
      if (pr > 0) {
        const p = poly.at(pr);
        knot(c, p.x, p.y, 0.6, t, arc, 1);
      }
    },
  };
}

/** A thread beside each room's name (`.wv-tloom-l li[data-room]`): hot while the story is there, warm once told. */
export function tloomSpec(tale: { current: TaleClock }): VizSpec {
  let L: { id: string; poly: Poly; P: Parts; y: number; x0: number; x1: number }[] = [];
  return {
    lay(V) {
      const ph = isPhone(V.cv);
      const host = V.cv.parentElement;
      const lis = host ? [...host.querySelectorAll<HTMLElement>(".wv-tloom-l li")] : [];
      L = lis.map((li) => {
        const r = V.rel(li);
        const x0 = ph ? r.x : r.x + 90;
        const x1 = ph ? r.x + r.w - 4 : V.W - 4;
        const y = ph ? r.y + r.h - 2 : r.y + r.h / 2;
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = 0; i <= 24; i++) {
          xs.push(lerp(x0, x1, i / 24));
          ys.push(y);
        }
        return { id: li.dataset.room ?? "archive", poly: new Poly().set(xs, ys), P: new Parts(ph ? 22 : 40, 0.1), y, x0, x1 };
      });
    },
    draw(_V, c, t, dt) {
      const T = tale.current;
      for (const l of L) {
        const rgb = RC[l.id] ?? WHITE;
        const lit = l.id === T.room;
        for (let i = 0; i < l.poly.n; i++) l.poly.y[i] = l.y + (lit ? Math.sin(i * 0.6 + t * 4) * 2.2 : 0);
        if (lit) {
          weave(c, l.poly, l.P, { a: 1.3, sp: 2.2, sz: 0.75, v: 50, rgb, rgb2: WHITE, line: 0.35, lw: 1, jit: 0.5 }, t, dt);
          knot(c, l.x1, l.y, 0.5, t, rgb, 1);
        } else if (T.told.has(l.id)) weave(c, l.poly, l.P, { a: 0.55, sp: 1, sz: 0.55, v: 10, rgb, line: 0.16 }, t, dt);
        else dots(c, l.x0, l.y, l.x1, l.y, 5, 0.12, rgb);
      }
    },
  };
}

/** The week: a column per day, with the rooms it visited (scenes per room) and the changes it shipped. */
export interface WeekCol {
  rooms: Record<string, number>;
  ships: number;
  hot: boolean;
}

/**
 * The week as a scroll (#388): a storyline per room the week visited, running Monday to Sunday. A room's line lights
 * and draws in toward the middle on the days it had scenes (by how many), and goes quiet on the days it didn't, so the
 * rooms gather where the week was busy. A knot under a day per change it shipped.
 */
export function weekSpec(cols: WeekCol[], pad: { top: number; bottom: number } = { top: 18, bottom: 46 }): VizSpec {
  let S: { id: string; poly: Poly; P: Parts; k: number[] }[] = [];
  let cw = 0;
  let top = 0;
  let bot = 0;
  // A day-by-day value at a point along the week, eased between the days' centres.
  const along = (k: number[], u: number) => {
    const p = clamp(u * 7 - 0.5, 0, 6);
    const i0 = Math.floor(p);
    const i1 = Math.min(6, i0 + 1);
    const e = (1 - Math.cos((p - i0) * Math.PI)) / 2;
    return lerp(k[i0] ?? 0, k[i1] ?? 0, e);
  };
  return {
    lay(V) {
      cw = V.W / 7;
      top = pad.top;
      bot = V.H - pad.bottom;
      const tot: Record<string, number> = {};
      for (const c of cols) for (const [r, n] of Object.entries(c.rooms)) if (n > 0) tot[r] = (tot[r] ?? 0) + n;
      const ids = Object.keys(tot).sort((a, b) => tot[b]! - tot[a]!);
      const max = Math.max(1, ...cols.flatMap((c) => Object.values(c.rooms)));
      const mid = (top + bot) / 2;
      const half = (bot - top) / 2 - 6;
      const rungs = Math.max(1, Math.ceil((ids.length - 1) / 2));
      S = ids.map((id, j) => {
        const base = mid + (j === 0 ? 0 : (j % 2 ? -1 : 1) * (Math.ceil(j / 2) / rungs) * half);
        const k = cols.map((c) => (c.rooms[id] ?? 0) / max);
        const xs: number[] = [];
        const ys: number[] = [];
        const N = 84;
        for (let q = 0; q <= N; q++) {
          const u = q / N;
          xs.push(u * V.W);
          ys.push(base + (mid - base) * 0.62 * along(k, u) + Math.sin(u * TAU * 2.5 + j * 1.3) * 2);
        }
        return { id, poly: new Poly().set(xs, ys), P: new Parts(Math.min(150, Math.round(16 + tot[id]! * 3)), 0.1), k };
      });
    },
    draw(V, c, t, dt) {
      cols.forEach((col, i) => {
        if (!col.hot) return;
        c.globalCompositeOperation = "source-over";
        const g = c.createLinearGradient(0, 0, 0, V.H);
        g.addColorStop(0, `rgba(${RC.archive},.13)`);
        g.addColorStop(1, `rgba(${RC.archive},0)`);
        c.fillStyle = g;
        c.fillRect(i * cw + 1, 0, cw - 2, V.H);
        c.globalCompositeOperation = "lighter";
      });
      if (!S.length) dots(c, 0, (top + bot) / 2, V.W, (top + bot) / 2, 6, 0.14, RC.archive);
      for (const s of S) weave(c, s.poly, s.P, { a: 1, sp: 1.4, sz: 0.6, v: 16, rgb: RC[s.id] ?? WHITE, line: 0.13, lw: 1, I: (u) => 0.06 + 0.94 * along(s.k, u) }, t, dt);
      cols.forEach((col, i) => {
        const n = Math.min(col.ships, 6);
        const x = i * cw + cw / 2;
        for (let k = 0; k < n; k++) knot(c, x + (k - (n - 1) / 2) * 11, bot + 16, 0.32, t + k, col.hot ? RC.archive! : WHITE, col.hot ? 1 : 0.6);
      });
    },
  };
}
