import { ROOMS, roomAngle, roomCenter, roomToWorld, sampleRoute, worldToRoom, type RoomId } from "@ceo/core";
import { BROGU_EYES_KERNEL, BROGU_RIDE_KERNEL, BROGU_STEERED_QUIPS } from "@ceo/simulator";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, BackSide, DoubleSide, Plane, ShaderMaterial, Vector2, Vector3, type Mesh, type PerspectiveCamera } from "three";
import { agentPositions } from "../clock.ts";
import { darkness, hourNow } from "../night/dayCycle.ts";
import { useWorld } from "../store.ts";
import { brogu, eyesInput, eyesTap, eyesView, useEyes } from "./eyes.ts";
import {
  BODY_RADIUS,
  BOUNDS,
  EYE_HEIGHT,
  STEP_LENGTH,
  WALK_SPEED,
  arrival,
  atGate,
  blocked,
  clampPitch,
  floorAt,
  gateSpot,
  headBob,
  move,
  rideRoute,
  seek,
  velocity,
  yawToward,
} from "./walk.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
/** No head bob for anyone who has asked the browser for less motion (read once, at load). */
const STILL = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const roomName = (room: RoomId) => ROOMS[room].name;

/** The first-person camera: wider than the overview's, and with a near plane for a desk leg at arm's length. */
const EYES_FOV = 72;
const EYES_NEAR = 0.05;
/** How close an agent can be before he's nudged round them, and how close before they notice him. */
const AGENT_RADIUS = 0.42;
const NOTICE_DISTANCE = 1.8;
const NOTICE_EVERY_MS = 7000;

function keyDrive() {
  const k = eyesInput.keys;
  const forward = (k.has("w") || k.has("arrowup") ? 1 : 0) - (k.has("s") || k.has("arrowdown") ? 1 : 0) + eyesInput.stick.y;
  const strafe = (k.has("d") ? 1 : 0) - (k.has("a") ? 1 : 0) + eyesInput.stick.x;
  const turn = (k.has("arrowright") || k.has("e") ? 1 : 0) - (k.has("arrowleft") || k.has("q") ? 1 : 0);
  const run = eyesInput.run || Math.hypot(eyesInput.stick.x, eyesInput.stick.y) > 0.92;
  return { forward: Math.max(-1, Math.min(1, forward)), strafe: Math.max(-1, Math.min(1, strafe)), turn, run };
}

/**
 * Drives Brogu and the camera while Nikita is behind his eyes: walking with collisions, the head bob, the look,
 * tap-to-walk, the stream ride between rooms, and the agents noticing him. Does nothing otherwise.
 */
function EyesController() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const raycaster = useThree((s) => s.raycaster);
  const active = useEyes((s) => s.active);
  const floorY = useRef(0);
  const edgeFor = useRef(0);
  const lastNotice = useRef(0);
  const noticed = useRef(new Map<string, number>());
  const noticeClock = useRef(0);
  const camYaw = useRef(0);

  // Into first person, and back out: the lens, and Skippy's line.
  useEffect(() => {
    if (!active) return;
    const saved = { fov: camera.fov, near: camera.near, order: camera.rotation.order };
    camera.fov = EYES_FOV;
    camera.near = EYES_NEAR;
    camera.rotation.order = "YXZ";
    camera.updateProjectionMatrix();
    const room = useEyes.getState().room;
    floorY.current = room ? floorAt(room, brogu.x, brogu.z) : 0;
    camYaw.current = room ? brogu.yaw + roomAngle(room) : 0;
    if (room) useWorld.getState().announce(pick(BROGU_EYES_KERNEL).replace("{room}", roomName(room)), "status", room);
    return () => {
      camera.fov = saved.fov;
      camera.near = saved.near;
      camera.rotation.order = saved.order;
      camera.updateProjectionMatrix();
    };
  }, [active, camera]);

  useEffect(() => {
    eyesView.camera = () => [camera.position.x, camera.position.z];
    return () => {
      eyesView.camera = null;
    };
  }, [camera]);

  // Tap-to-walk: a tap on screen becomes a spot on the floor.
  useEffect(() => {
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    const hit = new Vector3();
    const ndc = new Vector2();
    eyesTap.at = (x, y) => {
      const { room, riding } = useEyes.getState();
      if (!room || riding) return;
      plane.constant = -(ROOMS[room].y + floorAt(room, brogu.x, brogu.z));
      ndc.set(x, y);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      const [lx, lz] = worldToRoom(room, hit.x, hit.z);
      const inside = lx > BOUNDS.x0 - 0.5 && lx < BOUNDS.x1 + 0.5 && lz > BOUNDS.z0 - 0.5 && lz < BOUNDS.z1 + 0.5;
      if (!inside || Math.hypot(lx - brogu.x, lz - brogu.z) > 16) {
        useEyes.setState({ note: "tap-far" });
        return;
      }
      brogu.target = [Math.min(BOUNDS.x1, Math.max(BOUNDS.x0, lx)), Math.min(BOUNDS.z1, Math.max(BOUNDS.z0, lz))];
    };
    return () => {
      eyesTap.at = null;
    };
  }, [camera, raycaster]);

  useFrame((_, rawDt) => {
    const eyes = useEyes.getState();
    if (!eyes.active || !eyes.room) return;
    const dt = Math.min(rawDt, 0.1);
    const room = eyes.room;
    const now = performance.now();
    const world = useWorld.getState();

    // Look: drags since last frame, plus the turn keys.
    const drive = keyDrive();
    brogu.yaw += eyesInput.look.yaw - drive.turn * 1.9 * dt;
    brogu.pitch = clampPitch(brogu.pitch + eyesInput.look.pitch);
    eyesInput.look.yaw = eyesInput.look.pitch = 0;

    // The stream: from the gate, up to the Kernel and down into another room.
    if (eyes.riding) {
      if (!brogu.route) {
        brogu.route = rideRoute(room, brogu.x, brogu.z, eyes.riding);
        brogu.routeStart = now;
        world.announce(pick(BROGU_RIDE_KERNEL).replace("{room}", roomName(eyes.riding)), "status", null, "lattice");
      }
      const sample = sampleRoute(brogu.route, now - brogu.routeStart);
      const [hx, hz] = sample.heading;
      if (hx || hz) camYaw.current = lerpAngle(camYaw.current, Math.atan2(-hx, -hz), 1 - Math.exp(-dt * 4));
      camera.position.set(sample.position[0], sample.position[1] + EYE_HEIGHT, sample.position[2]);
      camera.rotation.set(brogu.pitch, camYaw.current, 0);
      brogu.speed = sample.kind === "walk" ? WALK_SPEED : 0;
      if (sample.done) {
        const to = eyes.riding;
        Object.assign(brogu, arrival(to), { route: null, target: null });
        brogu.yaw = camYaw.current - roomAngle(to);
        floorY.current = floorAt(to, brogu.x, brogu.z);
        if (world.focus !== to) world.setFocus(to);
        useEyes.setState({ room: to, riding: null });
      }
      return;
    }

    // Walking: keys and the stick first; otherwise toward a tapped spot.
    let v: [number, number] | null = null;
    if (drive.forward || drive.strafe) {
      brogu.target = null;
      v = velocity(brogu.yaw, drive);
    } else if (brogu.target) {
      v = seek(brogu.x, brogu.z, brogu.target[0], brogu.target[1]);
      if (v) brogu.yaw = lerpAngle(brogu.yaw, yawToward(brogu.x, brogu.z, brogu.target[0], brogu.target[1]), 1 - Math.exp(-dt * 6));
      else brogu.target = null;
    }
    let moved = 0;
    if (v) {
      const step = move(room, brogu.x, brogu.z, v[0] * dt, v[1] * dt);
      moved = Math.hypot(step.x - brogu.x, step.z - brogu.z);
      brogu.x = step.x;
      brogu.z = step.z;
      // Walked into the drop: say so, once he's been leaning on it a moment.
      edgeFor.current = step.atEdge ? edgeFor.current + dt : 0;
      if (edgeFor.current > 0.35 && eyes.note !== "edge") useEyes.setState({ note: "edge" });
      // A tapped spot he can't reach: give up rather than push at the furniture.
      if (brogu.target && step.bumped && moved < 0.002) brogu.target = null;
    } else edgeFor.current = 0;

    // Agents are solid too: step round anyone he walks into, and now and then they look down at him.
    const me = roomToWorld(room, brogu.x, 0, brogu.z);
    noticeClock.current += dt;
    const checkNotice = noticeClock.current > 0.4;
    if (checkNotice) noticeClock.current = 0;
    let nearest: string | null = null;
    let nearestD = NOTICE_DISTANCE;
    for (const [id, p] of agentPositions) {
      if (Math.abs(p.y - me[1]) > 1.6) continue;
      const d = Math.hypot(p.x - me[0], p.z - me[2]);
      if (d < AGENT_RADIUS + BODY_RADIUS && d > 1e-3) {
        const [ax, az] = worldToRoom(room, p.x, p.z);
        const push = AGENT_RADIUS + BODY_RADIUS - d;
        const nx = brogu.x + ((brogu.x - ax) / d) * push;
        const nz = brogu.z + ((brogu.z - az) / d) * push;
        if (!blocked(room, nx, nz)) {
          brogu.x = nx;
          brogu.z = nz;
        }
      }
      if (checkNotice && d < nearestD && now - (noticed.current.get(id) ?? 0) > 40_000) {
        nearest = id;
        nearestD = d;
      }
    }
    if (nearest && now - lastNotice.current > NOTICE_EVERY_MS && world.lattice.agents[nearest]?.place.room === room) {
      lastNotice.current = now;
      noticed.current.set(nearest, now);
      world.override(nearest, "stare", 2600);
      if (Math.random() < 0.6) world.say(nearest, pick(BROGU_STEERED_QUIPS));
    }

    const here = atGate(room, brogu.x, brogu.z);
    if (here !== eyes.atGate) useEyes.setState({ atGate: here });
    if (eyes.note === "edge" && edgeFor.current === 0 && v) useEyes.setState({ note: null });

    // The camera: his eyes, with a toddler's bob.
    brogu.speed = dt > 0 ? moved / dt : 0;
    brogu.phase += (moved / STEP_LENGTH) * Math.PI;
    const bob = STILL ? { y: 0, roll: 0 } : headBob(brogu.phase, Math.min(1, brogu.speed / WALK_SPEED));
    floorY.current += (floorAt(room, brogu.x, brogu.z) - floorY.current) * (1 - Math.exp(-dt * 8));
    const eye = roomToWorld(room, brogu.x, floorY.current + EYE_HEIGHT + bob.y, brogu.z);
    camera.position.set(eye[0], eye[1], eye[2]);
    camYaw.current = brogu.yaw + roomAngle(room);
    camera.rotation.set(brogu.pitch, camYaw.current, bob.roll);
  });

  return null;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * The sky over the Lattice, seen from the floor: a deep navy dome that lightens to a cold glow at the horizon,
 * the far city of Ilyr standing along it in silhouette with a few windows lit, stars, a slow violet aurora, and
 * faint meridians, one for each room's bearing. All in one shader; nothing downloaded. Darker, starrier at night.
 */
function skyMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uNight: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uNight;
      varying vec3 vDir;
      float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
      float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      // One row of towers round the horizon: cells of azimuth, each a tower (or a gap) of its own height.
      float towers(float az, float el, float cells, float tall, float seed, out float lit) {
        float n = (az / 6.2831853 + 0.5) * cells;
        float id = floor(n) + seed;
        float f = fract(n);
        float h = (0.006 + pow(h1(id * 1.37), 3.0) * tall) * step(0.22, h1(id * 3.11));
        // Spires: a few taper to a needle.
        float spire = step(0.86, h1(id * 7.7));
        float w = mix(0.38, 0.08 + 0.3 * clamp((h - el) / max(h, 1e-4), 0.0, 1.0), spire);
        float inside = step(abs(f - 0.5), w) * step(el, h + spire * 0.012 * (1.0 - abs(f - 0.5) * 8.0));
        // Windows: rows and columns, a few lit.
        vec2 win = vec2(floor(f * 9.0), floor(el / 0.0032));
        float on = step(0.9, h3(vec3(win, id))) * step(0.25, fract(f * 9.0)) * step(0.35, fract(el / 0.0032));
        lit = inside * on * step(0.002, el);
        return inside;
      }
      void main() {
        vec3 d = normalize(vDir);
        float el = d.y;
        float az = atan(d.x, d.z);
        vec3 zenith = mix(vec3(0.016, 0.026, 0.060), vec3(0.006, 0.010, 0.026), uNight);
        vec3 horizon = mix(vec3(0.060, 0.098, 0.190), vec3(0.030, 0.048, 0.110), uNight);
        vec3 below = vec3(0.012, 0.017, 0.032);
        vec3 col = mix(horizon, zenith, pow(clamp(el, 0.0, 1.0), 0.42));
        col = mix(col, below, smoothstep(0.0, -0.06, el));
        // The cold glow along the horizon.
        col += vec3(0.07, 0.17, 0.27) * exp(-abs(el - 0.012) * 34.0) * (0.6 - 0.25 * uNight);
        // A slow aurora, high up.
        float a = 0.5 + 0.5 * sin(az * 3.0 + uTime * 0.025 + sin(az * 7.0 + uTime * 0.01) * 0.7);
        col += vec3(0.17, 0.12, 0.40) * a * exp(-pow((el - 0.38) * 5.0, 2.0)) * (0.12 + 0.1 * uNight);
        // Meridians at each room's bearing, and rings of latitude: the Lattice, drawn on the sky.
        float mer = smoothstep(0.004, 0.0, abs(fract(az / 6.2831853 * 9.0 + 0.5) - 0.5) / 9.0 * 6.2831853 * sqrt(max(1.0 - el * el, 0.0)));
        float lat = smoothstep(0.003, 0.0, abs(fract(el * 6.0 + 0.5) - 0.5) / 6.0);
        float pulse = 0.5 + 0.5 * sin(el * 40.0 - uTime * 0.6);
        col += vec3(0.30, 0.65, 0.85) * (mer + lat * 0.5) * step(0.03, el) * (0.02 + 0.022 * pulse) * (1.0 - el);
        // Stars.
        vec3 p = d * 320.0;
        vec3 cell = floor(p);
        float s = h3(cell);
        float star = step(0.9965 - uNight * 0.0025, s) * smoothstep(0.32, 0.0, length(fract(p) - 0.5));
        float tw = 0.65 + 0.35 * sin(uTime * (1.0 + s * 3.0) + s * 40.0);
        col += vec3(0.85, 0.92, 1.0) * star * tw * smoothstep(0.02, 0.12, el) * (0.8 + 0.9 * fract(s * 91.0));
        // The far city: two rows of towers, the nearer taller and darker, a few windows lit.
        float lit1, lit2;
        float far = towers(az, el, 150.0, 0.035, 11.0, lit1);
        float near = towers(az, el, 70.0, 0.07, 3.0, lit2);
        col = mix(col, horizon * 0.55 + vec3(0.004, 0.008, 0.02), far * 0.85);
        col = mix(col, vec3(0.010, 0.016, 0.034), near);
        vec3 warm = vec3(1.0, 0.78, 0.5);
        vec3 cold = vec3(0.55, 0.85, 1.0);
        col += mix(cold, warm, step(0.5, fract(az * 37.0))) * (lit1 * (1.0 - near) * 0.35 + lit2 * 0.7) * (0.6 + 0.6 * uNight);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
}

function Sky() {
  const ref = useRef<Mesh>(null);
  const material = useMemo(skyMaterial, []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ camera, clock }) => {
    ref.current?.position.copy(camera.position);
    material.uniforms.uTime!.value = clock.elapsedTime;
    material.uniforms.uNight!.value = darkness(hourNow());
  });
  return (
    <mesh ref={ref} material={material} renderOrder={-1000} frustumCulled={false} userData={{ lod: false }}>
      <sphereGeometry args={[280, 48, 24]} />
    </mesh>
  );
}

/**
 * Where he can't go: a low hologram rail round the platform that shows only near him, so the drop reads as an edge
 * before he's walked into it. And the foot of the light stream: a ring on the floor and a column of light, so he
 * can find his way to the other rooms.
 */
function fenceMaterial() {
  return new ShaderMaterial({
    uniforms: { uPos: { value: new Vector2() }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec2 uPos;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec2 vUv;
      void main() {
        float d = length(vWorld.xz - uPos);
        float near = smoothstep(1.6, 0.25, d);
        float grid = smoothstep(0.06, 0.0, abs(fract((vWorld.x + vWorld.z) * 4.0) - 0.5) - 0.44);
        float scan = 0.5 + 0.5 * sin(vUv.y * 40.0 - uTime * 3.0);
        float top = smoothstep(0.05, 0.0, 1.0 - vUv.y);
        float a = near * (pow(1.0 - vUv.y, 2.0) * 0.16 + grid * 0.18 + top * 0.7) * (0.75 + 0.25 * scan);
        gl_FragColor = vec4(vec3(0.56, 0.91, 1.0) * 1.4 * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

function gateMaterial() {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHere: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uHere;
      varying vec2 vUv;
      void main() {
        float rise = fract(vUv.y * 3.0 - uTime * 0.5);
        float a = pow(1.0 - vUv.y, 1.6) * (0.25 + 0.35 * smoothstep(0.0, 0.2, rise) * smoothstep(0.6, 0.2, rise)) * (0.6 + 0.8 * uHere);
        gl_FragColor = vec4(vec3(0.82, 0.92, 1.0) * 1.6 * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

function RoomDressing({ room }: { room: RoomId }) {
  const fence = useMemo(fenceMaterial, []);
  const gate = useMemo(gateMaterial, []);
  useEffect(
    () => () => {
      fence.dispose();
      gate.dispose();
    },
    [fence, gate],
  );
  const ring = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const [wx, , wz] = roomToWorld(room, brogu.x, 0, brogu.z);
    fence.uniforms.uPos!.value.set(wx, wz);
    fence.uniforms.uTime!.value = t;
    gate.uniforms.uTime!.value = t;
    const here = useEyes.getState().atGate ? 1 : 0;
    gate.uniforms.uHere!.value += (here - gate.uniforms.uHere!.value) * 0.1;
    if (ring.current) ring.current.scale.setScalar(1 + Math.sin(t * 2.2) * 0.06 + gate.uniforms.uHere!.value * 0.15);
  });
  const [gx, gz] = gateSpot(room);
  const gy = floorAt(room, gx, gz);
  const r = BODY_RADIUS;
  const H = 0.5;
  const x0 = BOUNDS.x0 - r;
  const x1 = BOUNDS.x1 + r;
  const z0 = BOUNDS.z0 - r;
  const z1 = BOUNDS.z1 + r;
  const sides: { pos: [number, number, number]; rot: number; len: number }[] = [
    { pos: [(x0 + x1) / 2, H / 2, z1], rot: 0, len: x1 - x0 },
    { pos: [(x0 + x1) / 2, H / 2, z0], rot: 0, len: x1 - x0 },
    { pos: [x1, H / 2, (z0 + z1) / 2], rot: Math.PI / 2, len: z1 - z0 },
    { pos: [x0, H / 2, (z0 + z1) / 2], rot: Math.PI / 2, len: z1 - z0 },
  ];
  return (
    <group position={roomCenter(room)} rotation={[0, roomAngle(room), 0]}>
      {sides.map((s, i) => (
        <mesh key={i} position={s.pos} rotation={[0, s.rot, 0]} material={fence} renderOrder={4} userData={{ lod: false }}>
          <planeGeometry args={[s.len, H]} />
        </mesh>
      ))}
      <group position={[gx, gy, gz]}>
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} renderOrder={4} userData={{ lod: false }}>
          <ringGeometry args={[0.55, 0.62, 48]} />
          <meshBasicMaterial color={[1.1, 1.7, 2.0]} transparent opacity={0.85} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh position={[0, 1.4, 0]} material={gate} renderOrder={4} userData={{ lod: false }}>
          <cylinderGeometry args={[0.5, 0.58, 2.8, 32, 1, true]} />
        </mesh>
      </group>
    </group>
  );
}

/** Brogu's eyes, inside the canvas: the controller always (it idles), the sky and the room's dressing only while it's on. */
export function BroguEyes() {
  const active = useEyes((s) => s.active);
  const room = useEyes((s) => s.room);
  return (
    <>
      <EyesController />
      {active && <Sky />}
      {active && room && <RoomDressing key={room} room={room} />}
    </>
  );
}
