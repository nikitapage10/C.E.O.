import { CanvasTexture, Color, LinearFilter, SRGBColorSpace, ShaderMaterial, type Texture } from "three";

/**
 * New York at night, for the club's back window: three painted layers (sky and far towers, midtown, the
 * bridge and the river) composited in one shader that shifts each layer with the view, so the city has depth
 * without any geometry behind the wall. Landmarks are drawn as silhouettes: the stepped tower with its
 * coloured crown and mast, the arched art-deco crown, the tapered glass spire, the pencil-thin tower, water
 * tanks on the rooftops, and a gothic-arched suspension bridge strung with lights.
 */

const W = 2048;
const H = 768;

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function canvas() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return [c, c.getContext("2d")!] as const;
}

function texture(c: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

/** Lit windows in a building's rectangle: warm and cool, mostly on, in rows. */
function windows(g: CanvasRenderingContext2D, r: () => number, x: number, y: number, w: number, h: number, lit = 0.45, size = 3) {
  const gap = size * 2.2;
  for (let wy = y + gap; wy < y + h - gap; wy += gap) {
    // Whole floors dark now and then, like a real tower at night.
    if (r() < 0.12) continue;
    for (let wx = x + gap * 0.6; wx < x + w - gap * 0.6; wx += gap) {
      if (r() > lit) continue;
      const warm = r() < 0.7;
      const v = 0.55 + r() * 0.45;
      g.fillStyle = warm ? `rgba(255,${190 + r() * 40},${120 + r() * 50},${v})` : `rgba(${170 + r() * 40},${210 + r() * 30},255,${v})`;
      g.fillRect(wx, wy, size, size * 1.3);
    }
  }
}

function block(g: CanvasRenderingContext2D, r: () => number, x: number, w: number, h: number, fill: string, lit: number, size: number) {
  g.fillStyle = fill;
  g.fillRect(x, H - h, w, h);
  windows(g, r, x, H - h, w, h, lit, size);
  // A rooftop water tank on some of the older, shorter blocks.
  if (h < H * 0.42 && r() < 0.35) {
    const tx = x + w * (0.2 + r() * 0.5);
    g.fillStyle = fill;
    g.fillRect(tx, H - h - 22, 16, 16);
    g.beginPath();
    g.moveTo(tx - 2, H - h - 22);
    g.lineTo(tx + 8, H - h - 32);
    g.lineTo(tx + 18, H - h - 22);
    g.fill();
    g.fillRect(tx + 2, H - h - 6, 2, 6);
    g.fillRect(tx + 12, H - h - 6, 2, 6);
  }
}

/** The far layer: the sky, the moon, the landmarks, a haze of distant blocks. */
function farLayer() {
  const [c, g] = canvas();
  const r = rng(7);
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#05060f");
  sky.addColorStop(0.55, "#16123a");
  sky.addColorStop(0.82, "#4a2350");
  sky.addColorStop(1, "#c2506a");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.5})`;
    g.fillRect(r() * W, r() * H * 0.5, 1.5, 1.5);
  }
  // Moon, with a soft halo.
  const mx = W * 0.82;
  const my = H * 0.18;
  const halo = g.createRadialGradient(mx, my, 10, mx, my, 120);
  halo.addColorStop(0, "rgba(255,240,220,0.5)");
  halo.addColorStop(1, "rgba(255,240,220,0)");
  g.fillStyle = halo;
  g.fillRect(mx - 120, my - 120, 240, 240);
  g.fillStyle = "#fff4e2";
  g.beginPath();
  g.arc(mx, my, 26, 0, Math.PI * 2);
  g.fill();

  const far = "#1a1830";
  for (let x = 0; x < W; x += 30 + r() * 50) block(g, r, x, 40 + r() * 70, H * (0.18 + r() * 0.2), far, 0.25, 2);

  // The stepped tower: setbacks, a lit crown in three colours, and the mast.
  const ex = W * 0.3;
  const tiers: [number, number][] = [[150, 0.42], [118, 0.52], [92, 0.6], [64, 0.66], [40, 0.71]];
  g.fillStyle = "#14132a";
  for (const [w, h] of tiers) g.fillRect(ex - w / 2, H - H * h, w, H * h);
  windows(g, r, ex - 70, H - H * 0.52, 140, H * 0.5, 0.5, 2.5);
  const crown = H - H * 0.71;
  ["#ff4a5a", "#ffffff", "#4a7aff"].forEach((col, i) => {
    g.fillStyle = col;
    g.globalAlpha = 0.85;
    g.fillRect(ex - 20 + i * 2, crown - 14 - i * 10, 40 - i * 4, 10);
  });
  g.globalAlpha = 1;
  g.fillStyle = "#14132a";
  g.fillRect(ex - 6, crown - 70, 12, 40);
  g.fillRect(ex - 2, crown - 120, 4, 50);
  g.fillStyle = "#ff3b3b";
  g.fillRect(ex - 2, crown - 124, 4, 4);

  // The art-deco tower: a crown of nested arches with triangular windows, then a needle.
  const cx = W * 0.47;
  const ch = H * 0.6;
  g.fillStyle = "#16142c";
  g.fillRect(cx - 50, H - ch, 100, ch);
  windows(g, r, cx - 45, H - ch, 90, ch, 0.5, 2.5);
  for (let i = 0; i < 6; i++) {
    const w = 46 - i * 7;
    const top = H - ch - 18 - i * 16;
    g.fillStyle = "#16142c";
    g.beginPath();
    g.ellipse(cx, top + 18, w, 22, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = "rgba(255,236,190,0.85)";
    for (let k = -2; k <= 2; k++) {
      const tx = cx + k * (w / 3);
      g.beginPath();
      g.moveTo(tx - 3, top + 12);
      g.lineTo(tx, top + 4);
      g.lineTo(tx + 3, top + 12);
      g.fill();
    }
  }
  g.fillStyle = "#16142c";
  g.fillRect(cx - 2, H - ch - 160, 4, 70);

  // The tapered glass spire on the right, and the pencil tower beside it.
  const wx = W * 0.68;
  g.fillStyle = "#121a2e";
  g.beginPath();
  g.moveTo(wx - 60, H);
  g.lineTo(wx - 34, H - H * 0.78);
  g.lineTo(wx + 34, H - H * 0.78);
  g.lineTo(wx + 60, H);
  g.fill();
  windows(g, r, wx - 50, H - H * 0.74, 100, H * 0.72, 0.35, 2);
  g.fillRect(wx - 2, H - H * 0.78 - 90, 4, 90);
  g.fillStyle = "#e8f4ff";
  g.fillRect(wx - 2, H - H * 0.78 - 94, 4, 4);
  g.fillStyle = "#151628";
  g.fillRect(W * 0.58 - 14, H - H * 0.7, 28, H * 0.7);
  windows(g, r, W * 0.58 - 14, H - H * 0.7, 28, H * 0.7, 0.4, 2);
  return texture(c);
}

/** Midtown: denser, closer, brighter. Transparent sky. */
function midLayer() {
  const [c, g] = canvas();
  const r = rng(19);
  const fills = ["#0d0d1c", "#11111f", "#0f1220", "#141222"];
  for (let x = -20; x < W; ) {
    const w = 50 + r() * 110;
    const h = H * (0.16 + r() * 0.3);
    block(g, r, x, w, h, fills[Math.floor(r() * fills.length)]!, 0.5, 3);
    // A few antennas with red lights.
    if (r() < 0.2) {
      g.fillStyle = "#0d0d1c";
      g.fillRect(x + w / 2, H - h - 40, 2, 40);
      g.fillStyle = "#ff3b3b";
      g.fillRect(x + w / 2 - 1, H - h - 42, 4, 4);
    }
    x += w - 4 + r() * 10;
  }
  return texture(c);
}

/** The river, and a gothic-arched suspension bridge strung with lights. Transparent above the bridge. */
function nearLayer() {
  const [c, g] = canvas();
  const r = rng(31);
  const river = g.createLinearGradient(0, H * 0.82, 0, H);
  river.addColorStop(0, "#0a0c1c");
  river.addColorStop(1, "#05060c");
  g.fillStyle = river;
  g.fillRect(0, H * 0.82, W, H * 0.18);
  // City light on the water.
  for (let i = 0; i < 400; i++) {
    const x = r() * W;
    const y = H * 0.83 + r() * H * 0.16;
    g.fillStyle = r() < 0.7 ? `rgba(255,200,140,${0.08 + r() * 0.25})` : `rgba(160,190,255,${0.08 + r() * 0.2})`;
    g.fillRect(x, y, 6 + r() * 18, 1.5);
  }
  // The deck.
  const deck = H * 0.8;
  g.fillStyle = "#07070f";
  g.fillRect(0, deck, W, 10);
  // Towers with twin gothic arches.
  for (const tx of [W * 0.2, W * 0.62]) {
    g.fillStyle = "#0a0a14";
    g.fillRect(tx - 34, deck - 260, 68, 270);
    g.fillStyle = "rgba(0,0,0,0)";
    g.globalCompositeOperation = "destination-out";
    for (const ax of [-16, 16]) {
      g.beginPath();
      g.moveTo(tx + ax - 9, deck - 30);
      g.lineTo(tx + ax - 9, deck - 170);
      g.quadraticCurveTo(tx + ax, deck - 195, tx + ax + 9, deck - 170);
      g.lineTo(tx + ax + 9, deck - 30);
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
  }
  // Main cables: sagging curves between the towers and out to the shores, strung with lights.
  const spans: [number, number][] = [[-W * 0.1, W * 0.2], [W * 0.2, W * 0.62], [W * 0.62, W * 1.05]];
  g.strokeStyle = "#1a1a2a";
  g.lineWidth = 2;
  for (const [a, b] of spans) {
    const top = deck - 255;
    const sag = a < 0 || b > W ? 120 : 210;
    const pt = (u: number) => [a + (b - a) * u, top + Math.sin(u * Math.PI) * sag * (a < 0 ? u : b > W ? 1 - u : 1)] as const;
    g.beginPath();
    for (let u = 0; u <= 1; u += 0.02) {
      const [x, y] = pt(u);
      if (u === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // Suspenders and the string of lights.
    for (let u = 0.04; u < 1; u += 0.04) {
      const [x, y] = pt(u);
      g.strokeStyle = "rgba(40,40,60,0.8)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, deck);
      g.stroke();
      g.fillStyle = "rgba(255,236,190,0.95)";
      g.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    g.strokeStyle = "#1a1a2a";
    g.lineWidth = 2;
  }
  // Deck lights.
  for (let x = 0; x < W; x += 14) {
    g.fillStyle = "rgba(255,220,160,0.9)";
    g.fillRect(x, deck + 3, 4, 2);
  }
  return texture(c);
}

/** One material for the window: three layers with parallax, a little twinkle in the windows, and a tint uniform the club lights can push. */
export function skylineMaterial() {
  return new ShaderMaterial({
    uniforms: {
      uFar: { value: farLayer() },
      uMid: { value: midLayer() },
      uNear: { value: nearLayer() },
      uTime: { value: 0 },
      uTint: { value: new Color("#000000") },
      uBright: { value: 1.25 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        // View direction in the plane's own frame (x right, y up, z out of the window).
        vec3 toCam = cameraPosition - world.xyz;
        mat3 toLocal = transpose(mat3(modelMatrix));
        vView = normalize(toLocal * toCam);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uFar;
      uniform sampler2D uMid;
      uniform sampler2D uNear;
      uniform float uTime;
      uniform vec3 uTint;
      uniform float uBright;
      varying vec2 vUv;
      varying vec3 vView;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec4 layer(sampler2D t, float depth) {
        vec2 shift = -vView.xy / max(vView.z, 0.25) * depth;
        vec2 uv = vUv * vec2(0.86, 0.9) + vec2(0.07, 0.05) + shift * vec2(0.06, 0.12);
        return texture2D(t, uv);
      }
      void main() {
        vec4 far = layer(uFar, 1.0);
        vec4 mid = layer(uMid, 0.55);
        vec4 near = layer(uNear, 0.25);
        vec3 col = far.rgb;
        col = mix(col, mid.rgb, mid.a);
        col = mix(col, near.rgb, near.a);
        // A few windows switch on and off over time.
        vec2 cell = floor(vUv * vec2(520.0, 190.0));
        float tw = step(0.996, hash(cell + floor(uTime * 0.25)));
        col += tw * vec3(1.0, 0.8, 0.55) * 0.6 * (mid.a + near.a * 0.5);
        col = col * uBright + uTint * (1.0 - near.a * 0.5);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    toneMapped: false,
  });
}
