import { getStation } from "@ceo/core";
import { Text } from "../fx/Text.tsx";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, CanvasTexture, Color, DoubleSide, InstancedMesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, ShaderMaterial, type Group } from "three";
import { moveTone, startPolymarket, usePolymarket, type PmMarket } from "../desk/exchange/polymarket.ts";
import { startPositions, usePositions } from "../desk/exchange/positions.ts";
import { HIDE_KEY, readHide, useHide } from "../desk/hide.ts";
import { useDeskAuth } from "../desk/signin.ts";
import { Dust, Haze } from "../fx/atmos.tsx";
import { screenMaterial } from "../fx/materials.ts";
import { Model } from "../fx/Model.tsx";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";
import { tickerChunks } from "./exchangeTicker.ts";
import { bookieLine, bookieWorldLine, chunkTone, marqueeChunks } from "./liveBoards.ts";
import { useLiveLines } from "./liveLines.ts";
import { Block, FONTS, LightBar, Monitor, Plinth, ahead, facingDir } from "./primitives.tsx";

function tickerTexture(chunks: string[]) {
  const c = document.createElement("canvas");
  c.width = 4096;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#020403";
  g.fillRect(0, 0, c.width, c.height);
  g.font = "500 52px 'IBM Plex Mono', monospace";
  g.textBaseline = "middle";
  let x = 20;
  for (let i = 0; x < c.width; i++) {
    const chunk = chunks[i % chunks.length]!;
    const up = chunk.includes("▲");
    const down = chunk.includes("▼");
    g.fillStyle = up ? "#7dffc4" : down ? "#ff8a9e" : "#d8e6f2";
    g.fillText(chunk, x, 50);
    x += g.measureText(chunk + "    ").width;
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * The marquee's strip: amber lettering on black, each chunk coloured by its move. Wider than the ring's, since the
 * position lines are longer, and a chunk is never repeated mid-strip so a short book doesn't stutter.
 */
const STRIP_W = 4096;
const FONT = "500 64px 'IBM Plex Mono', monospace";

function marqueeTexture(chunks: string[]) {
  const c = document.createElement("canvas");
  const probe = c.getContext("2d")!;
  probe.font = FONT;
  // One pass of the chunks, with a diamond between each; the strip is as long as a whole number of passes (at least
  // the plane's width, at most 16k), and the plane shows a 4096-pixel window of it, so the loop is seamless.
  const widths = chunks.map((ch) => probe.measureText(ch).width);
  const gap = probe.measureText("   ◆   ").width;
  const pass = Math.ceil(widths.reduce((a, w) => a + w + gap, 0)) || 1;
  const reps = Math.max(1, Math.ceil(STRIP_W / pass));
  c.width = Math.min(16384, pass * reps);
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#050302";
  g.fillRect(0, 0, c.width, c.height);
  g.font = FONT;
  g.textBaseline = "middle";
  // A very long book is squeezed to fit the largest texture rather than cut off.
  g.setTransform(c.width / (pass * reps), 0, 0, 1, 0, 0);
  let x = 0;
  for (let r = 0; r < reps; r++) {
    chunks.forEach((chunk, i) => {
      const tone = chunkTone(chunk);
      g.fillStyle = i === 0 ? "#ffcf7a" : tone === "up" ? "#7dffc4" : tone === "down" ? "#ff8a9e" : "#f2e6cf";
      g.fillText(chunk, x, 66);
      x += widths[i]!;
      g.fillStyle = "#8a7448";
      g.fillText("   ◆   ", x, 66);
      x += gap;
    });
  }
  const tex = new CanvasTexture(c);
  tex.wrapS = RepeatWrapping;
  tex.repeat.x = STRIP_W / c.width;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Follows the Desk's Hide from other tabs: the Lattice masks the book the moment the Desk does. */
function useHideAcrossTabs() {
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key === null || e.key === HIDE_KEY) useHide.setState({ on: readHide() });
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
}

/**
 * The marquee over the back wall (Nikita, 2026-10-22): the C.E.O.'s Polymarket positions scrolling past, market, side,
 * odds now and P/L %, read from the passkey-only /api/exchange-positions. Only a signed-in Desk session gets them,
 * and Hide masks them; everyone else, and every public page, sees the public odds. Never a dollar figure.
 */
function Marquee({ top }: { top: readonly PmMarket[] }) {
  useHideAcrossTabs();
  useEffect(() => {
    // The Lattice doesn't run the Desk's sign-in; one quiet check says whether this browser holds the session.
    if (useDeskAuth.getState().auth.status === "checking") void useDeskAuth.getState().check();
    return startPositions();
  }, []);
  const status = usePositions((s) => s.status);
  const positions = usePositions((s) => s.data?.positions ?? null);
  const hidden = useHide((s) => s.on);
  const chunks = useMemo(() => marqueeChunks({ status, positions, hidden }, top), [status, positions, hidden, top]);
  const key = chunks.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tex = useMemo(() => marqueeTexture(chunks), [key]);
  useEffect(() => () => tex.dispose(), [tex]);
  const mat = useMemo(() => new MeshStandardMaterial({ color: "#000", emissive: "#ffffff", emissiveIntensity: 1.6, toneMapped: false }), []);
  useEffect(() => {
    mat.emissiveMap = tex;
    mat.needsUpdate = true;
  }, [mat, tex]);
  useFrame(({ clock }) => {
    // The same speed on the wall however long the strip is.
    tex.offset.x = (clock.elapsedTime * 0.012 * tex.repeat.x) % 1;
  });
  return (
    <group position={[0, 5.2, -6.3]}>
      <Block size={[15.6, 0.62, 0.12]} position={[0, 0, -0.02]} material={PBR.blackMetal()} radius={0.02} />
      <mesh position={[0, 0, 0.05]} material={mat}>
        <planeGeometry args={[15.2, 0.46]} />
      </mesh>
      <LightBar length={15.4} position={[0, -0.34, 0.06]} color={PALETTE.amber} intensity={1.4} thickness={0.018} />
    </group>
  );
}

/** A curved trading desk with a bank of monitors. */
function TradingDesk({ stand, facing, seed }: { stand: [number, number]; facing: number; seed: number }) {
  const [dx, dz] = facingDir(facing);
  return (
    <group position={[stand[0] + dx * 0.85, 0, stand[1] + dz * 0.85]} rotation={[0, Math.atan2(dx, dz), 0]}>
      <Block size={[2.4, 0.06, 0.85]} position={[0, 0.76, 0]} material={PBR.blackFloor([1, 1])} radius={0.03} />
      <Block size={[2.3, 0.72, 0.7]} position={[0, 0.37, 0.05]} material={PBR.lacquer("#15181d", 0.3)} radius={0.04} />
      <LightBar length={2.2} position={[0, 0.06, -0.31]} color={PALETTE.mint} intensity={2} thickness={0.02} />
      {[-0.8, 0, 0.8].map((x, i) => (
        <Monitor key={x} position={[x, 1.24, 0.22]} rotation={Math.PI + x * 0.4} size={[0.72, 0.44]} color={i === 1 ? PALETTE.mint : PALETTE.amber} seed={seed + i} />
      ))}
    </group>
  );
}

/** The vault: a round steel door that eases open while a trade is waiting on you. */
function Vault({ position, yaw, open }: { position: [number, number]; yaw: number; open: boolean }) {
  const door = useRef<Group>(null);
  const wheel = useRef<Group>(null);
  useFrame(({ clock }, dt) => {
    if (door.current) {
      const target = open ? -0.55 : 0;
      door.current.rotation.y += (target - door.current.rotation.y) * Math.min(1, dt * 2);
    }
    if (wheel.current) wheel.current.rotation.z = open ? clock.elapsedTime * 0.8 : wheel.current.rotation.z;
  });
  return (
    <group position={[position[0], 0, position[1]]} rotation={[0, yaw, 0]}>
      <Block size={[3, 3.4, 0.7]} position={[0, 1.7, -0.3]} material={PBR.matte("#14171c", 0.6)} radius={0.06} />
      <mesh position={[0, 1.6, 0.06]} rotation={[Math.PI / 2, 0, 0]} material={PBR.steel()}>
        <torusGeometry args={[1.08, 0.1, 16, 64]} />
      </mesh>
      <group ref={door} position={[-1, 1.6, 0.12]}>
        <group position={[1, 0, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={PBR.aluminium()} castShadow>
            <cylinderGeometry args={[0.98, 0.98, 0.22, 64]} />
          </mesh>
          {Array.from({ length: 12 }, (_, i) => (
            <mesh key={i} position={[Math.cos((i / 12) * Math.PI * 2) * 0.82, Math.sin((i / 12) * Math.PI * 2) * 0.82, 0.12]} rotation={[Math.PI / 2, 0, 0]} material={PBR.chrome()}>
              <cylinderGeometry args={[0.05, 0.05, 0.06, 16]} />
            </mesh>
          ))}
          <group ref={wheel} position={[0, 0, 0.18]}>
            <mesh material={PBR.chrome()}>
              <torusGeometry args={[0.36, 0.03, 12, 40]} />
            </mesh>
            {[0, 1, 2].map((i) => (
              <mesh key={i} rotation={[0, 0, (i * Math.PI) / 3]} material={PBR.chrome()}>
                <boxGeometry args={[0.72, 0.04, 0.04]} />
              </mesh>
            ))}
          </group>
        </group>
      </group>
      <Text font={FONTS.mono} fontSize={0.12} position={[0, 3.15, 0.06]} letterSpacing={0.24} color="#c9d2dc">
        APPROVAL VAULT
      </Text>
    </group>
  );
}

const EMPTY: readonly PmMarket[] = [];

/** The Exchange: a sunken trading pit in black glass, odds circling overhead. */
export function Exchange() {
  useEffect(() => startPolymarket(), []);
  const top = usePolymarket((s) => s.board?.top);
  const world = usePolymarket((s) => s.board?.world);
  // The Bookie reads the real board out loud now and then (public odds only), and more often than not an aside on a
  // world-moving market instead (#345: geopolitics, politics, pop culture; no sports).
  useLiveLines("ticker", () => (world?.length && Math.random() < 0.6 ? bookieWorldLine(world, Math.random(), Math.random()) : bookieLine(top ?? [], Math.random(), Math.random())));
  const chunks = useMemo(() => tickerChunks(top ?? []), [top]);
  const key = chunks.join("|");
  // A new texture only when the words change (about once a minute at most); the old one is let go.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tex = useMemo(() => tickerTexture(chunks), [key]);
  useEffect(() => () => tex.dispose(), [tex]);
  const ledMat = useMemo(() => new MeshStandardMaterial({ color: "#000", emissive: "#ffffff", emissiveIntensity: 1.8, toneMapped: false }), []);
  useEffect(() => {
    ledMat.emissiveMap = tex;
    ledMat.needsUpdate = true;
  }, [ledMat, tex]);
  const wall = useMemo(() => screenMaterial(PALETTE.mint, { speed: 0.3, density: 22 }), []);
  const ring = useRef<Group>(null);
  const pendingTrade = useWorld((s) => Object.values(s.lattice.approvals).some((a) => a.status === "pending" && a.request.action === "trade.place"));
  const desks = ["desk-n", "desk-e", "desk-w"].map((id) => getStation("exchange", id));
  const term = ahead(getStation("exchange", "terminal"), 0.8);
  const vault = ahead(getStation("exchange", "vault"), 1.05);

  useFrame(({ clock }) => {
    tex.offset.x = (clock.elapsedTime * 0.02) % 1;
    if (ring.current) ring.current.rotation.y = clock.elapsedTime * 0.06;
  });

  return (
    <group>
      <Plinth floor={PBR.blackFloor([6, 5])} edge={PBR.steel()} accent={PALETTE.mint} />
      {/* The pit: concentric brushed-steel inlays and a raised kerb */}
      {[1.4, 4.6].map((r) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0.4]} material={PBR.aluminium()}>
          <ringGeometry args={[r, r + 0.05, 96]} />
        </mesh>
      ))}
      <mesh position={[0, 0.06, 0.4]} material={PBR.lacquer("#101318", 0.3)} receiveShadow castShadow>
        <cylinderGeometry args={[1.35, 1.4, 0.12, 64]} />
      </mesh>
      {/* Ticker ring, in a proper housing */}
      <group ref={ring} position={[0, 4.4, 0.4]}>
        <mesh material={PBR.blackMetal()}>
          <cylinderGeometry args={[3.3, 3.3, 0.7, 96, 1, true]} />
        </mesh>
        <mesh material={ledMat}>
          <cylinderGeometry args={[3.32, 3.32, 0.42, 96, 1, true]} />
        </mesh>
        {[0.37, -0.37].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={PBR.aluminium()}>
            <torusGeometry args={[3.31, 0.035, 8, 96]} />
          </mesh>
        ))}
      </group>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.sin((i / 3) * Math.PI * 2) * 3.2, 5.6, 0.4 + Math.cos((i / 3) * Math.PI * 2) * 3.2]} material={PBR.blackMetal()}>
          <cylinderGeometry args={[0.012, 0.012, 2.2, 4]} />
        </mesh>
      ))}
      {desks.map((d, i) => (
        <TradingDesk key={d.id} stand={[d.x, d.z]} facing={d.facing} seed={20 + i * 3} />
      ))}
      {/* Research terminal: a standing kiosk */}
      <group position={[term.pos[0], 0, term.pos[1]]} rotation={[0, term.yaw, 0]}>
        <Block size={[0.7, 1.1, 0.5]} position={[0, 0.55, 0]} material={PBR.lacquer("#15181d", 0.3)} radius={0.05} />
        <Monitor position={[0, 1.55, 0.05]} rotation={0} size={[0.8, 0.5]} color={PALETTE.mint} seed={31} />
      </group>
      <Vault position={vault.pos} yaw={vault.yaw} open={pendingTrade} />
      {/* Back wall: black stone with a wall-sized market display */}
      <group position={[0, 0, -6.5]}>
        <Block size={[16.2, 5.6, 0.3]} position={[0, 2.8, 0]} material={PBR.lacquer("#0b0d10", 0.15)} radius={0.04} />
        <mesh position={[-3.2, 3, 0.16]} material={wall}>
          <planeGeometry args={[7.6, 3.4]} />
        </mesh>
        <Block size={[7.8, 3.6, 0.04]} position={[-3.2, 3, 0.13]} material={PBR.blackMetal()} radius={0.01} />
        <LightBar length={16} position={[0, 0.12, 0.2]} color={PALETTE.mint} intensity={1.6} thickness={0.025} />
      </group>
      <ExchangeFloor top={top ?? null} />
      <Marquee top={top ?? EMPTY} />
      <pointLight position={[0, 5, 1]} color="#cfeee0" intensity={22} distance={16} decay={1.6} />
    </group>
  );
}

const CHART_FS = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uColor;
  varying vec2 vUv;
  float hash(float x) { return fract(sin(x * 127.1 + uSeed * 31.7) * 43758.5453); }
  float price(float x) {
    float i = floor(x), f = fract(x);
    float a = hash(i), b = hash(i + 1.0);
    return mix(a, b, f * f * (3.0 - 2.0 * f)) * 0.55 + sin(x * 0.7 + uSeed) * 0.15 + 0.3;
  }
  void main() {
    vec2 uv = vUv;
    float x = uv.x * 12.0 + uTime * 0.8;
    float p = price(x);
    float line = smoothstep(0.02, 0.0, abs(uv.y - p));
    float fill = step(uv.y, p) * 0.12 * uv.y;
    float grid = (step(0.97, fract(uv.x * 8.0)) + step(0.95, fract(uv.y * 5.0))) * 0.08;
    float frame = step(uv.x, 0.01) + step(0.99, uv.x) + step(uv.y, 0.015) + step(0.985, uv.y);
    // Candles along the bottom: volume bars.
    float bar = step(fract(uv.x * 24.0), 0.55) * step(uv.y, hash(floor(uv.x * 24.0 + uTime * 2.0)) * 0.18);
    float a = clamp(line + fill + grid + frame * 0.5 + bar * 0.35, 0.0, 1.0) * 0.85;
    gl_FragColor = vec4(uColor * 1.6, a);
  }
`;

/** A floating holographic chart: a price line scrolling through a grid, volume bars underneath. */
function HoloChart({ position, yaw, seed, color }: { position: [number, number, number]; yaw: number; seed: number; color: string }) {
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uColor: { value: new Color(color) } },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: CHART_FS,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        toneMapped: false,
      }),
    [seed, color],
  );
  const g = useRef<Group>(null);
  useFrame(({ clock }) => {
    mat.uniforms.uTime!.value = clock.elapsedTime;
    if (g.current) g.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.6 + seed) * 0.06;
  });
  return (
    <group ref={g} position={position} rotation={[0, yaw, 0]}>
      <mesh material={mat} raycast={() => null}>
        <planeGeometry args={[1.6, 0.8]} />
      </mesh>
    </group>
  );
}

/**
 * A split-flap odds board: one row per market on Polymarket's live board (#253), its odds as lit cells (a cell per
 * ten points, give or take), mint for a market up on the day, red for down, white for flat, flickering as the flaps
 * settle. Dark rows until the feed answers.
 */
function FlipBoard({ position, top }: { position: [number, number, number]; top: readonly PmMarket[] | null }) {
  const COLS = 10;
  const ROWS = 6;
  const cells = useRef<InstancedMesh>(null);
  const mat = useMemo(() => new MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), []);
  const dummy = useMemo(() => new Object3D(), []);
  const c = useMemo(() => new Color(), []);
  const rows = useMemo(
    () =>
      Array.from({ length: ROWS }, (_, r) => {
        const m = top?.[r];
        if (!m) return null;
        const tone = moveTone(m.change24h);
        return { lit: Math.max(1, Math.round(m.prob * (COLS - 1))), colour: tone === "up" ? "#7dffc4" : tone === "down" ? "#ff8a9e" : "#d8e6f2" };
      }),
    [top],
  );
  useFrame(({ clock }) => {
    const m = cells.current;
    if (!m) return;
    const step = Math.floor(clock.elapsedTime * 1.5);
    for (let i = 0; i < COLS * ROWS; i++) {
      const col = i % COLS;
      // Row 0 at the top: the busiest market first.
      const row = ROWS - 1 - Math.floor(i / COLS);
      dummy.position.set(col * 0.56 - (COLS - 1) * 0.28, Math.floor(i / COLS) * 0.36 - (ROWS - 1) * 0.18, 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      const h = Math.sin(i * 12.9898 + Math.floor((step + i * 7) / 5) * 78.233) * 43758.5453;
      const r = h - Math.floor(h);
      const live = rows[row];
      if (!live) c.set("#1c2328").multiplyScalar(0.8 + r * 0.2);
      else if (col === 0) c.set(live.colour).multiplyScalar(0.6);
      else if (col <= live.lit) c.set(live.colour).multiplyScalar(1.1 + r * 0.4);
      else c.set("#26303a").multiplyScalar(0.7 + r * 0.2);
      m.setColorAt(i, c);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  return (
    <group position={position}>
      <Block size={[COLS * 0.56 + 0.3, ROWS * 0.36 + 0.3, 0.06]} position={[0, 0, -0.04]} material={PBR.blackMetal()} radius={0.02} />
      <instancedMesh ref={cells} args={[undefined, mat, COLS * ROWS]} frustumCulled={false}>
        <planeGeometry args={[0.5, 0.28]} />
      </instancedMesh>
      <Text font={FONTS.mono} fontSize={0.13} position={[0, ROWS * 0.18 + 0.32, 0]} letterSpacing={0.24} color="#c9d2dc">
        {top?.length ? "ODDS BOARD · POLYMARKET LIVE" : "ODDS BOARD · WAITING ON THE FEED"}
      </Text>
    </group>
  );
}

/** Around the pit: more desks along the walls, data cabinets, floor light lines, holographic charts, a mint haze. */
function ExchangeFloor({ top }: { top: readonly PmMarket[] | null }) {
  return (
    <group>
      <FlipBoard position={[4.4, 3.0, -6.32]} top={top} />
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        return <HoloChart key={i} position={[Math.sin(a) * 2.7, 2.4, 0.4 + Math.cos(a) * 2.7]} yaw={a + Math.PI} seed={i * 3.1} color={i % 2 ? PALETTE.mint : "#8fd3ff"} />;
      })}
      {/* Side desks, unstaffed, monitors still running. */}
      <TradingDesk stand={[-7.3, -3.2]} facing={Math.PI / 2} seed={41} />
      <TradingDesk stand={[7.3, -3.2]} facing={-Math.PI / 2} seed={44} />
      {[-1.4, -0.6, 0.2].map((z) => (
        <Model key={z} id="scifi-modular/Props/Prop_Computer" fit={{ height: 1.9 }} position={[7.6, 0, z]} rotation={-Math.PI / 2} cast />
      ))}
      {[-5.2, 5.2].map((x) => (
        <Model key={x} id="scifi-modular/Props/Prop_AccessPoint" fit={{ height: 1.2 }} position={[x, 0, -5.9]} cast />
      ))}
      {/* Light lines radiating from the pit across the floor. */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        return (
          <mesh key={i} position={[Math.sin(a) * 3.0, 0.012, 0.4 + Math.cos(a) * 3.0]} rotation={[-Math.PI / 2, 0, -a]} material={PBR.light(PALETTE.mint, 1.2)}>
            <planeGeometry args={[0.025, 3.0]} />
          </mesh>
        );
      })}
      <Haze min={[-7, 0.2, -5.5]} size={[14, 2.2, 11]} count={30} puff={2.4} additive color="#3dd6a0" opacity={0.022} />
      <Dust min={[-6, 0.5, -5]} size={[12, 4, 10]} count={60} color="#8fffd0" opacity={0.55} />
    </group>
  );
}
