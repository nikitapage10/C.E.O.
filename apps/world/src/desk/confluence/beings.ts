import { frac, Parts, Poly, ring, spr, TAU, WHITE } from "../wvCanvas.ts";
import { Motes, NEAR } from "./batch.ts";

const MOTES = new Motes();

/**
 * The Council as beings (#413, round 9's Confluence): each submind is drawn from its own threads of particles, a shape
 * that says who it is, its density and speed from today's real activity. Nikita (2026-10-24 21:30Z): "I like their
 * little shapes… it would be cool if those particles actually went between these abstract shapes to more of the Skippy
 * shape". So every figure has a second body, Skippy's own (a floating can in an admiral's bicorne), and its threads
 * slide between the two: on a slow cycle of its own, and while it is pointed at, tapped or open. It keeps its colour
 * either way, so the Builder becomes an orange Skippy and the Messenger a blue one.
 */

type Form = { n: number; cnt: number; v: number; sp: number; hi?: number; f: (j: number, a: number, t: number, o: number[]) => void };

const S = (o: number[], x: number, y: number) => {
  o[0] = x;
  o[1] = y;
};

/** Each submind's own shape, in units of its radius (y down). Ported from the approved concept, plus the Director. */
const FORMS: Record<string, Form> = {
  kernel: {
    n: 5,
    cnt: 90,
    v: 0.16,
    sp: 2.2,
    f(j, a, t, o) {
      if (j === 4) {
        const r = 1.04 + 0.02 * Math.sin(t * 0.7);
        return S(o, r * Math.cos(a), r * Math.sin(a));
      }
      const r = 0.42 + 0.5 * Math.pow(Math.abs(Math.cos(2.5 * a + t * 0.05)), 0.8);
      const ro = (j * TAU) / 20 + t * 0.04 * (j % 2 ? 1 : -1);
      S(o, r * Math.cos(a + ro), r * Math.sin(a + ro));
    },
  },
  foundry: {
    n: 3,
    cnt: 80,
    v: 0.5,
    sp: 2.4,
    hi: 0.18,
    f(j, a, t, o) {
      const th = 1 + 0.07 * Math.sin(t * 5.2);
      const r = (0.28 + 0.72 * Math.abs(Math.cos(1.5 * a))) * th;
      const ro = t * 0.25 * (j + 1) * (j % 2 ? -1 : 1) + j * 1.05;
      S(o, r * Math.cos(a + ro), r * Math.sin(a + ro));
    },
  },
  spire: {
    n: 4,
    cnt: 40,
    v: 0.1,
    sp: 1.2,
    f(j, a, t, o) {
      if (j === 3) return S(o, 0.14 * Math.cos(a), -1.12 + 0.14 * Math.sin(a));
      const w = [0.22, 0.36, 0.5][j]!;
      S(o, w * Math.cos(a) + Math.sin(t * 0.4 + j) * 0.03, 1.02 * Math.sin(a) + 0.05);
    },
  },
  exchange: {
    n: 2,
    cnt: 64,
    v: 0.3,
    sp: 1.6,
    f(j, a, t, o) {
      const p = t * 0.22 + j * 1.3;
      S(o, Math.sin(3 * a + p), 0.78 * Math.sin(2 * a) + 0.04 * Math.sign(Math.sin(t * 3 + a * 9)));
    },
  },
  green: {
    n: 2,
    cnt: 70,
    v: 0.36,
    sp: 2,
    f(j, a, t, o) {
      const k = 0.3;
      const ph = t * 0.6 * (j ? -1 : 1);
      S(o, 0.82 * (Math.cos(a) + k * Math.cos(5 * a + ph)), 0.62 * (Math.sin(a) + k * Math.sin(5 * a + ph)));
    },
  },
  relay: {
    n: 2,
    cnt: 70,
    v: 0.5,
    sp: 1.5,
    f(j, a, t, o) {
      const x = Math.sin(a) * (1 - j * 0.18);
      const y = 0.55 * Math.sin(2 * a) * (1 - j * 0.1);
      const r = -0.35 + Math.sin(t * 0.9) * 0.08;
      S(o, x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r));
    },
  },
  archive: {
    n: 4,
    cnt: 32,
    v: 0.06,
    sp: 0.8,
    f(j, a, t, o) {
      const r = 0.32 + j * 0.22;
      const ro = (t * 0.03 * (j % 2 ? 1 : -1) + j) * 0.2;
      const x = r * Math.cos(a);
      const y = r * 0.5 * Math.sin(a);
      S(o, x * Math.cos(ro) - y * Math.sin(ro), x * Math.sin(ro) + y * Math.cos(ro));
    },
  },
  breakroom: {
    n: 3,
    cnt: 26,
    v: 0.16,
    sp: 1.4,
    f(j, a, t, o) {
      const cx = [-0.45, 0.45, 0][j]!;
      const cy = [0.1, 0.05, -0.5][j]! + Math.sin(t * 1.4 + j * 2) * 0.14;
      const r = [0.36, 0.3, 0.26][j]!;
      S(o, cx + r * Math.cos(a), cy + r * Math.sin(a));
    },
  },
  boiler: {
    n: 4,
    cnt: 40,
    v: 0.14,
    sp: 1.3,
    f(j, a, t, o) {
      if (j === 0) return S(o, 0.95 * Math.cos(a), -0.35 + 0.38 * Math.sin(a));
      const x = [-0.45, 0, 0.42][j - 1]!;
      const d = [0.75, 1, 0.6][j - 1]! * (0.92 + 0.08 * Math.sin(t * 0.8 + j));
      S(o, x + 0.07 * Math.cos(a), -0.1 + d * 0.5 * (1 + Math.sin(a)));
    },
  },
  workshop: {
    n: 2,
    cnt: 30,
    v: 0.12,
    sp: 1,
    f(j, a, t, o) {
      const g = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.25 + j * 2));
      const q = (a / TAU) * g * 4 * Math.PI;
      const r = (q / (4 * Math.PI)) * 1.02;
      S(o, r * Math.cos(q + j * Math.PI + t * 0.1), r * Math.sin(q + j * Math.PI + t * 0.1));
    },
  },
  // The Director: two reels turning over a wide frame.
  studio: {
    n: 3,
    cnt: 30,
    v: 0.2,
    sp: 1.1,
    f(j, a, t, o) {
      if (j === 2) return S(o, 0.78 * Math.cos(a), 0.42 + 0.3 * Math.sin(a) * (0.75 + 0.25 * Math.abs(Math.cos(a))));
      const cx = j ? 0.36 : -0.36;
      const r = 0.3 + 0.03 * Math.sin(6 * a + t * (j ? 1.2 : -1.2));
      S(o, cx + r * Math.cos(a + t * 0.4), -0.36 + r * Math.sin(a + t * 0.4));
    },
  },
};

const sp = (v: number, e: number) => Math.sign(v) * Math.pow(Math.abs(v), e);

/**
 * Skippy's body, piece by piece, in the same units: the can, its admiral's bicorne, the rim, the band, the base and
 * the cockade. A figure with n threads takes the first n pieces, so even a two-thread figure reads as can and hat.
 */
function can(piece: number, a: number, o: number[]) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  switch (piece) {
    case 0: // the can's side, a rounded upright
      return S(o, 0.34 * sp(c, 0.22), 0.25 + 0.53 * sp(s, 0.22));
    case 1: {
      // the bicorne: a high crescent over a flatter brim, its two points out wide
      const x = 0.7 * c;
      const k = Math.max(0, 1 - (x * x) / 0.49);
      // y down: the crown rises high in the middle, the brim dips onto the rim, the points turn up at the ends.
      const tip = 0.1 * Math.pow(1 - k, 3);
      return S(o, x, s < 0 ? -0.46 - 0.36 * Math.pow(k, 0.65) - tip : -0.44 + 0.13 * Math.pow(k, 1.6) - tip);
    }
    case 2: // the rim
      return S(o, 0.34 * c, -0.28 + 0.08 * s);
    case 3: // the label's band
      return S(o, 0.34 * c, 0.26 + 0.06 * s);
    case 4: // the base
      return S(o, 0.34 * c, 0.78 + 0.07 * s);
    default: // the cockade, pinned to the crown
      return S(o, 0.16 + 0.07 * c, -0.62 + 0.07 * s);
  }
}

const SEG = 72;
const smooth = (k: number) => k * k * (3 - 2 * k);

export class Being {
  id: string;
  F: Form;
  x = 0;
  y = 0;
  r = 40;
  /** Alpha, and a highlight (0..1) when it is pointed at or open. */
  a = 1;
  hl = 0;
  rgb: string;
  /** How far it has turned into Skippy, 0..1, and the target the cycle or a pointer asks for. */
  m = 0;
  want = 0;
  hold = false;
  /** Where it is on its own slow cycle. */
  phase: number;
  polys: Poly[] = [];
  P: Parts[] = [];
  speed: number;
  private xs = new Float32Array(SEG + 1);
  private ys = new Float32Array(SEG + 1);
  private pa = [0, 0];
  private pb = [0, 0];

  constructor(id: string, rgb: string, activity: number, density: number, phase: number) {
    this.id = id;
    this.F = FORMS[id] ?? FORMS.kernel!;
    this.rgb = rgb;
    this.phase = phase;
    const act = Math.max(0.12, activity);
    for (let j = 0; j < this.F.n; j++) {
      this.polys.push(new Poly());
      this.P.push(new Parts(Math.max(10, Math.round(this.F.cnt * (0.35 + act) * density)), this.F.hi ?? 0));
    }
    this.speed = this.F.v * (0.5 + act);
  }

  /** The slow cycle: mostly itself, now and then Skippy for about four seconds. 34 s round, staggered by `phase`. */
  cycle(t: number): number {
    const k = frac(t / 34 + this.phase);
    return k < 0.72 ? 0 : k < 0.8 ? smooth((k - 0.72) / 0.08) : k < 0.92 ? 1 : 1 - smooth((k - 0.92) / 0.08);
  }

  /** Step the morph toward its target (instant under reduced motion, where dt is 0). */
  step(t: number, dt: number) {
    const target = this.hold ? 1 : Math.max(this.want, this.cycle(t));
    if (!dt) this.m = this.hold ? 1 : this.want;
    else this.m += (target - this.m) * (1 - Math.exp(-dt * 2.4));
  }

  shape(t: number) {
    const F = this.F;
    const m = smooth(Math.min(1, Math.max(0, this.m)));
    // The can floats: a slow bob and a little tilt, only as much as it has become Skippy.
    const bob = Math.sin(t * 1.1 + this.phase * 9) * 0.07 * m;
    const tilt = Math.sin(t * 0.7 + this.phase * 5) * 0.09 * m;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const r = this.r;
    const A = this.pa;
    const B = this.pb;
    for (let j = 0; j < F.n; j++) {
      for (let i = 0; i <= SEG; i++) {
        const a = (i / SEG) * TAU;
        F.f(j, a, t, A);
        let x = A[0]!;
        let y = A[1]!;
        if (m > 0.001) {
          can(j, a, B);
          const bx = B[0]! * ct - B[1]! * st;
          const by = B[0]! * st + B[1]! * ct + bob;
          x += (bx - x) * m;
          y += (by - y) * m;
        }
        this.xs[i] = this.x + x * r;
        this.ys[i] = this.y + y * r;
      }
      this.polys[j]!.set(this.xs, this.ys);
    }
  }

  draw(c: CanvasRenderingContext2D, t: number, dt: number) {
    this.step(t, dt);
    this.shape(t);
    const a = this.a;
    const sprite = spr(this.rgb);
    const white = spr(WHITE);
    c.lineWidth = 0.7;
    c.strokeStyle = `rgba(${this.rgb},${0.16 * a * (1 + this.hl)})`;
    // Every thread's line in one path: one stroke a figure, not one a thread.
    c.beginPath();
    for (const p of this.polys) {
      for (let i = 0; i < p.n; i += 2) {
        if (i) c.lineTo(p.x[i]!, p.y[i]!);
        else c.moveTo(p.x[0]!, p.y[0]!);
      }
    }
    c.stroke();
    const F = this.F;
    const scale = Math.max(0.7, Math.min(1.5, this.r / 46));
    for (let j = 0; j < F.n; j++) {
      const poly = this.polys[j]!;
      const P = this.P[j]!;
      const L = Math.max(20, poly.len || 1);
      for (let i = 0; i < P.n; i++) {
        let u = P.u[i]!;
        if (dt) {
          u = frac(u + (P.v[i]! * this.speed * 80 * (this.r / 46) * dt) / L);
          P.u[i] = u;
        }
        const p = poly.at(u);
        // Spread thins as it becomes Skippy, so the can's outline reads clearly.
        const off = P.o[i]! * F.sp * (this.r / 40) * (0.6 + 0.4 * P.z[i]!) * (1 - 0.55 * this.m) + Math.sin(t * 1.9 + P.p[i]! * 3) * 0.6;
        const z = P.z[i]!;
        const sz = (0.75 + z * 1.9) * scale;
        const x = p.x - p.ty * off;
        const y = p.y + p.tx * off;
        if (z < NEAR && !P.c[i]) {
          MOTES.add(x, y, sz * 0.95, z > 0.2);
          continue;
        }
        const A = (0.3 + 0.7 * z) * a * (0.8 + 0.4 * this.hl);
        if (A < 0.02) continue;
        c.globalAlpha = A > 1 ? 1 : A;
        c.drawImage(P.c[i] ? white : sprite, x - sz, y - sz, sz * 2, sz * 2);
      }
    }
    MOTES.flush(c, this.rgb, a * (0.8 + 0.4 * this.hl));
    c.globalAlpha = 1;
  }

  /** A hot ring when something of its room waits on Nikita, a mote circling it. */
  need(c: CanvasRenderingContext2D, t: number, rgb: string) {
    const pr = this.r * 1.34 + Math.sin(t * 2.2) * 2;
    ring(c, this.x, this.y, pr, rgb, 0.38 * this.a, [2, 5]);
    const q = t * 0.5;
    c.globalAlpha = this.a;
    c.drawImage(spr(rgb), this.x + Math.cos(q) * pr - 6, this.y + Math.sin(q) * pr - 6, 12, 12);
    c.globalAlpha = 1;
  }

  /** The top of the figure, where its words rise from. */
  top() {
    return this.y - this.r * 1.2;
  }
}
