import { ROOMS, WALK_SPEED, getStation, placeToWorld, roomAngle, roomToWorld, routeBetween, sampleRoute, worldToRoom, type Place, type RoomId, type Route } from "@ceo/core";
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useMemo, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import { useCast } from "../cast/castStore.ts";
import { agentPositions, clock } from "../clock.ts";
import { unlock } from "../achievements/achievements.ts";
import { KERNEL } from "../kernel/lines.ts";
import { facingDir } from "../rooms/primitives.tsx";
import { useWorld } from "../store.ts";
import { LIBRARY_PETS, LibraryPet } from "./LibraryPet.tsx";
import { Brogu } from "./Brogu.tsx";
import { Myshka } from "./Myshka.tsx";
import { Owlbear } from "./Owlbear.tsx";
import { useStreaming } from "../scene/roomScope.ts";
import { brogu, useEyes } from "../eyes/eyes.ts";
import { floorAt } from "../eyes/walk.ts";
import { PETS, petOrders, petStart, wanderSpots, type PetDef } from "./pets.ts";
import type { PetDrive, PetMode } from "./types.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const between = (a: number, b: number) => a + Math.random() * (b - a);

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface PetState {
  place: Place;
  /** Each visit gets its own jitter, so a pet doesn't always stop on the same spot. */
  spot: string;
  route: Route | null;
  routeStart: number;
  mode: PetMode;
  until: number;
  /** Rooms crossed since the Kernel last mentioned it. */
  hops: number;
}

const tmp = new Vector3();

/** Someone in `room` who isn't walking, to say hello. */
function greeter(room: Place["room"]) {
  const { lattice } = useWorld.getState();
  const here = Object.values(lattice.agents).filter((a) => a.place.room === room && (!a.motion || clock.sim >= a.motion.startTs + a.motion.duration));
  return here.length ? pick(here).agent.id : null;
}

function Pet({ def }: { def: PetDef }) {
  const root = useRef<Group>(null);
  const model = useRef<Group>(null);
  const drive = useRef<PetDrive>({ mode: "idle", t: 0 });
  const yaw = useRef(Math.random() * Math.PI * 2);
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);
  const focus = useWorld((s) => s.focus);
  const studioOpen = useCast((s) => s.studio !== null);
  const [room, setRoom] = useState(petStart(def));
  const state = useRef<PetState | null>(null);
  const spotKey = useRef(0);
  // Brogu's eyes (#47): while Nikita steers him, he goes where he's walked and the camera is his head.
  const steering = useEyes((e) => e.active) && def.id === "brogu";
  const steeredIn = useRef<RoomId | null>(null);

  const init = useMemo(() => {
    const r = petStart(def);
    return { room: r, station: pick(wanderSpots(r, def.id)) };
  }, [def]);

  /** Steered: follow the eyes, hidden (the camera is inside him). Handed back: toddle off to the nearest spot. */
  const steer = (s: PetState, now: number, t: number): boolean => {
    const eyes = useEyes.getState();
    const r = root.current!;
    if (eyes.active && eyes.room) {
      const pos =
        eyes.riding && brogu.route
          ? sampleRoute(brogu.route, now - brogu.routeStart).position
          : roomToWorld(eyes.room, brogu.x, floorAt(eyes.room, brogu.x, brogu.z), brogu.z);
      r.position.set(...pos);
      r.rotation.y = yaw.current = brogu.yaw + roomAngle(eyes.room) + Math.PI;
      model.current!.scale.setScalar(0.0001);
      drive.current.mode = brogu.speed > 0.05 ? "walk" : "idle";
      drive.current.t = t;
      if (steeredIn.current !== eyes.room) {
        steeredIn.current = eyes.room;
        setRoom(eyes.room);
      }
      return true;
    }
    const last = steeredIn.current;
    if (!last) return false;
    steeredIn.current = null;
    // Handed back: off to the nearest spot he'd have stopped at anyway, from wherever he was left.
    const [lx, lz] = worldToRoom(last, r.position.x, r.position.z);
    const near = wanderSpots(last, def.id)
      .map((id) => getStation(last, id))
      .sort((a, c) => Math.hypot(a.x - lx, a.z - lz) - Math.hypot(c.x - lx, c.z - lz))[0]!;
    const spot = `${def.id}-${++spotKey.current}`;
    const next: Place = { room: last, station: near.id };
    const from: [number, number, number] = [r.position.x, r.position.y, r.position.z];
    const to = placeToWorld(next, spot);
    // Timed at an agent's pace, like routeBetween: the frame loop below scales it by the pet's own speed.
    const ms = (Math.hypot(to[0] - from[0], to[2] - from[2]) / WALK_SPEED) * 1000;
    s.route = { points: [from, to], kinds: ["walk"], ends: [ms], duration: ms };
    s.routeStart = now;
    s.place = next;
    s.spot = spot;
    s.mode = "walk";
    return false;
  };

  useFrame(({ clock: three }, dt) => {
    if (!root.current || !model.current) return;
    const now = performance.now();
    const t = three.elapsedTime;
    if (!state.current) state.current = { place: init, spot: `${def.id}-0`, route: null, routeStart: now, mode: "sit", until: now + between(2000, 6000), hops: 0 };
    const s = state.current;
    const world = useWorld.getState();
    if (def.id === "brogu" && steer(s, now, t)) return;
    const zoomies = def.id === "myshka" && now < petOrders.zoomiesUntil;
    // The zoomies wake him from anything.
    if (zoomies && !s.route && s.until > now + 600) s.until = now;

    let moving = false;
    let streaming = false;
    let heading: [number, number] = [0, 0];
    if (s.route) {
      const sample = sampleRoute(s.route, (now - s.routeStart) * def.speed * (zoomies ? 3.2 : 1) * Math.max(1, world.timeScale * 0.5));
      root.current.position.set(...sample.position);
      heading = sample.heading;
      streaming = sample.kind === "stream" && !sample.done;
      moving = !sample.done;
      if (sample.done) {
        const crossed = s.route.kinds.includes("stream");
        s.route = null;
        s.mode = Math.random() < 0.5 ? "sit" : "idle";
        s.until = now + (zoomies ? between(150, 600) : between(4000, 11000));
        if (crossed) {
          setRoom(s.place.room);
          s.hops++;
          if (def.id === "myshka" && s.hops >= 3 && (!world.focus || world.focus === s.place.room) && !world.announcement) {
            s.hops = 0;
            world.announce(pick(KERNEL.myshka).replace("{room}", ROOMS[s.place.room].name), "status", s.place.room);
          }
        }
        if ((crossed ? 0.6 : 0.12) > Math.random() && world.focus === s.place.room) {
          const who = greeter(s.place.room);
          if (who) world.say(who, pick(def.greetings));
        }
      }
    } else {
      root.current.position.set(...placeToWorld(s.place, s.spot));
      if (now > s.until) {
        // The zoomies: always off somewhere, often to another room.
        const r = zoomies ? Math.random() * 0.62 : Math.random();
        const rooms = def.homes.filter((x) => x !== s.place.room);
        let next: Place | null = null;
        if (rooms.length && r < (zoomies ? 0.3 : (def.roam ?? 0.14))) {
          // Prefer the room you're looking at.
          const dest = world.focus && rooms.includes(world.focus) && Math.random() < 0.5 ? world.focus : pick(rooms);
          next = { room: dest, station: pick(wanderSpots(dest, def.id)) };
        } else if (r < 0.62) {
          next = { room: s.place.room, station: pick(wanderSpots(s.place.room, def.id)) };
        } else if (r < 0.76) {
          s.mode = "nap";
          s.until = now + between(14000, 30000);
        } else if (r < 0.9) {
          s.mode = "sit";
          s.until = now + between(5000, 12000);
        } else {
          s.mode = "groom";
          s.until = now + between(3000, 7000);
        }
        if (next) {
          const spot = `${def.id}-${++spotKey.current}`;
          s.route = routeBetween(s.place, next, spot);
          // routeBetween jitters both ends by the same key; start from where we are.
          s.route.points[0] = [root.current.position.x, root.current.position.y, root.current.position.z];
          s.routeStart = now;
          s.place = next;
          s.spot = spot;
          s.mode = "walk";
        }
      }
    }

    // Face where it's going; at rest, face the nearest agent it likes the look of, or the room.
    let target = yaw.current;
    if (moving && (heading[0] || heading[1])) target = Math.atan2(heading[0], heading[1]);
    else if (!moving && s.mode !== "nap") {
      let best = Infinity;
      for (const p of agentPositions.values()) {
        const d = p.distanceToSquared(root.current.position);
        if (d < best && d < 9) {
          best = d;
          tmp.copy(p).sub(root.current.position);
          target = Math.atan2(tmp.x, tmp.z);
        }
      }
      if (best === Infinity) {
        const st = getStation(s.place.room, s.place.station);
        const [dx, dz] = facingDir(st.facing);
        target = Math.atan2(-dx, -dz) + roomAngle(s.place.room);
      }
    }
    yaw.current = lerpAngle(yaw.current, target, 1 - Math.exp(-dt * 5));
    root.current.rotation.y = yaw.current;
    model.current.scale.setScalar(streaming ? 0.0001 : 1);

    drive.current.mode = moving ? "walk" : s.mode;
    drive.current.t = t;
  });

  const inRoom = focus === room && !steering;
  const showTag = (hovered || open) && inRoom && !studioOpen;
  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = "pointer";
  };
  const out = () => {
    setHovered(false);
    document.body.style.cursor = "";
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (def.id === "myshka") unlock("good-boy");
    setOpen((o) => !o);
  };
  const tagY = def.kind === "owlbear" ? 1.15 : def.kind === "brogu" ? 0.9 : def.kind === "kitten" ? 0.8 : 0.7;
  const big = def.kind === "owlbear";

  return (
    <group ref={root} name={`pet-${def.id}`}>
      <group ref={model}>
        {def.kind === "kitten" && (
          <Suspense fallback={null}>
            <Myshka drive={drive} />
          </Suspense>
        )}
        {(def.kind === "shiba" || def.kind === "mushnub") && (
          <Suspense fallback={null}>
            <LibraryPet def={LIBRARY_PETS[def.kind]} drive={drive} />
          </Suspense>
        )}
        {def.kind === "owlbear" && (
          <Suspense fallback={null}>
            <Owlbear drive={drive} />
          </Suspense>
        )}
        {def.kind === "brogu" && (
          <Suspense fallback={null}>
            <Brogu drive={drive} />
          </Suspense>
        )}
      </group>
      <mesh position={[0, tagY / 2, 0]} visible={false} onPointerOver={over} onPointerOut={out} onClick={click}>
        <boxGeometry args={big ? [0.9, tagY, 1.3] : def.kind === "kitten" ? [0.5, tagY, 1.2] : [0.7, tagY, 0.8]} />
        <meshBasicMaterial />
      </mesh>
      {inRoom && !showTag && !studioOpen && (
        <Html position={[0, tagY, 0]} center distanceFactor={16} zIndexRange={[24, 0]}>
          <div className="nameplate nameplate--pet">{def.name}</div>
        </Html>
      )}
      {showTag && (
        <Html position={[0, tagY + 0.1, 0]} center distanceFactor={16} zIndexRange={[40, 0]}>
          <div className="tag tag--pet">
            <div className="tag__name">{def.name}</div>
            <div className="tag__role">{def.title}</div>
            <div className="tag__blurb">{def.blurb}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

/** The Lattice's pets. They aren't agents: nobody assigns them anything, and they wouldn't do it anyway. */
export function Pets() {
  // Opened on a room, only the pets starting there join at first; the rest follow once it's in (scene/streaming.ts).
  const first = useStreaming((s) => (s.all ? null : s.first));
  return (
    <group>
      {PETS.filter((p) => !first || petStart(p) === first).map((p) => (
        <Pet key={p.id} def={p} />
      ))}
    </group>
  );
}
