import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

/**
 * Procedural surface textures, painted once on a canvas. No downloads, no licensing, real surface detail:
 * concrete, brushed metal, wood grain, terrazzo, carpet, deck grating, felt, paper.
 */

const cache = new Map<string, Texture>();

function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(key: string, size: number, paint: (g: CanvasRenderingContext2D, r: () => number, s: number) => void, opts: { color?: boolean; repeat?: [number, number] } = {}) {
  const k = `${key}:${opts.repeat?.join("x") ?? ""}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  paint(g, rand(key.length * 977 + size), size);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  if (opts.repeat) tex.repeat.set(...opts.repeat);
  if (opts.color) tex.colorSpace = SRGBColorSpace;
  cache.set(k, tex);
  return tex;
}

function speckle(g: CanvasRenderingContext2D, r: () => number, s: number, n: number, colors: string[], min: number, max: number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)]!;
    const d = min + r() * (max - min);
    g.globalAlpha = 0.25 + r() * 0.6;
    g.beginPath();
    g.ellipse(r() * s, r() * s, d, d * (0.6 + r() * 0.6), r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Soft mottled noise: a roughness map that makes flat surfaces read as real ones. */
export function roughnessNoise(repeat: [number, number] = [2, 2]) {
  return make(
    "rough",
    512,
    (g, r, s) => {
      g.fillStyle = "#8a8a8a";
      g.fillRect(0, 0, s, s);
      speckle(g, r, s, 2600, ["#6c6c6c", "#a4a4a4", "#7b7b7b", "#b3b3b3"], 4, 40);
      speckle(g, r, s, 5000, ["#5a5a5a", "#c0c0c0"], 0.5, 2.5);
    },
    { repeat },
  );
}

export function concrete(repeat: [number, number] = [2, 2]) {
  return make(
    "concrete",
    512,
    (g, r, s) => {
      g.fillStyle = "#2c3036";
      g.fillRect(0, 0, s, s);
      speckle(g, r, s, 2200, ["#25292e", "#33383f", "#2a2e33", "#3a3f46"], 6, 60);
      speckle(g, r, s, 6000, ["#1d2024", "#454b53"], 0.4, 1.8);
      // Expansion joints.
      g.strokeStyle = "rgba(10,12,14,0.8)";
      g.lineWidth = 2;
      g.strokeRect(1, 1, s - 2, s - 2);
    },
    { color: true, repeat },
  );
}

export function terrazzo(repeat: [number, number] = [2, 2]) {
  return make(
    "terrazzo",
    512,
    (g, r, s) => {
      g.fillStyle = "#b9bdc2";
      g.fillRect(0, 0, s, s);
      speckle(g, r, s, 900, ["#9ea3a9", "#868c93", "#d0d3d6", "#aab0b6", "#737980"], 1.5, 7);
      g.strokeStyle = "rgba(150,155,162,0.45)";
      g.lineWidth = 1.5;
      g.strokeRect(0.75, 0.75, s - 1.5, s - 1.5);
    },
    { color: true, repeat },
  );
}

export function blackGlassFloor(repeat: [number, number] = [4, 4]) {
  return make(
    "blackfloor",
    256,
    (g, r, s) => {
      g.fillStyle = "#07090d";
      g.fillRect(0, 0, s, s);
      speckle(g, r, s, 300, ["#0c1016", "#0a0d12"], 4, 30);
      g.strokeStyle = "rgba(60,70,82,0.6)";
      g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, s - 1, s - 1);
    },
    { color: true, repeat },
  );
}

export function woodGrain(tone: "walnut" | "oak" = "walnut", repeat: [number, number] = [1, 1]) {
  const base = tone === "walnut" ? ["#2a1a12", "#3a2418", "#21140e", "#4a2f1f"] : ["#8a6a48", "#a07c55", "#76593c", "#b48c60"];
  return make(
    `wood-${tone}`,
    512,
    (g, r, s) => {
      g.fillStyle = base[0]!;
      g.fillRect(0, 0, s, s);
      // Planks.
      const planks = 6;
      for (let p = 0; p < planks; p++) {
        const y0 = (p / planks) * s;
        g.fillStyle = base[Math.floor(r() * base.length)]!;
        g.globalAlpha = 0.55;
        g.fillRect(0, y0, s, s / planks);
        g.globalAlpha = 1;
        for (let i = 0; i < 26; i++) {
          g.strokeStyle = base[Math.floor(r() * base.length)]!;
          g.globalAlpha = 0.35 + r() * 0.4;
          g.lineWidth = 0.6 + r() * 1.8;
          g.beginPath();
          const y = y0 + r() * (s / planks);
          g.moveTo(0, y);
          for (let x = 0; x <= s; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * (1 + r() * 3));
          g.stroke();
        }
        g.globalAlpha = 1;
        g.fillStyle = "rgba(0,0,0,0.55)";
        g.fillRect(0, y0, s, 1.5);
      }
    },
    { color: true, repeat },
  );
}

export function brushedMetal(repeat: [number, number] = [1, 1]) {
  return make(
    "brushed",
    512,
    (g, r, s) => {
      g.fillStyle = "#808080";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 1600; i++) {
        g.strokeStyle = r() > 0.5 ? "#9a9a9a" : "#686868";
        g.globalAlpha = 0.15 + r() * 0.35;
        g.lineWidth = 0.5 + r();
        const y = r() * s;
        g.beginPath();
        g.moveTo(r() * s * 0.3, y);
        g.lineTo(s * (0.7 + r() * 0.3), y + (r() - 0.5) * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    { repeat },
  );
}

/** Industrial floor grating (as a colour map; used with matching roughness). */
export function grating(repeat: [number, number] = [6, 6]) {
  return make(
    "grating",
    256,
    (g, _r, s) => {
      g.fillStyle = "#14171b";
      g.fillRect(0, 0, s, s);
      g.fillStyle = "#3b4048";
      const n = 8;
      for (let i = 0; i < n; i++) {
        const o = (i / n) * s;
        g.fillRect(o, 0, 5, s);
        g.fillRect(0, o, s, 2);
      }
      g.fillStyle = "rgba(255,255,255,0.06)";
      for (let i = 0; i < n; i++) g.fillRect((i / n) * s, 0, 1.5, s);
    },
    { color: true, repeat },
  );
}

export function carpet(color: string, repeat: [number, number] = [3, 3]) {
  return make(
    `carpet-${color}`,
    256,
    (g, r, s) => {
      g.fillStyle = color;
      g.fillRect(0, 0, s, s);
      speckle(g, r, s, 9000, ["rgba(255,255,255,0.05)", "rgba(0,0,0,0.12)"], 0.4, 1.4);
    },
    { color: true, repeat },
  );
}

export function felt(color: string) {
  return make(
    `felt-${color}`,
    256,
    (g, r, s) => {
      g.fillStyle = color;
      g.fillRect(0, 0, s, s);
      speckle(g, r, s, 6000, ["rgba(255,255,255,0.04)", "rgba(0,0,0,0.1)"], 0.4, 1.2);
    },
    { color: true },
  );
}

/** Lit windows for the Spire's skyline. */
export function windowGrid(repeat: [number, number] = [1, 3]) {
  return make(
    "windows",
    256,
    (g, r, s) => {
      g.fillStyle = "#06080c";
      g.fillRect(0, 0, s, s);
      const cols = 8;
      const rows = 16;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const lit = r();
          g.fillStyle = lit > 0.62 ? (lit > 0.9 ? "#ffe2b0" : "#9fc8ff") : "#0d1219";
          g.globalAlpha = lit > 0.62 ? 0.5 + r() * 0.5 : 1;
          g.fillRect(x * (s / cols) + 4, y * (s / rows) + 3, s / cols - 8, s / rows - 6);
        }
      g.globalAlpha = 1;
    },
    { color: true, repeat },
  );
}
