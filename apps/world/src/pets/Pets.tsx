import { ROOMS, getStation, placeToWorld, roomAngle, routeBetween, sampleRoute, type Place, type Route } from "@ceo/core";
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useMemo, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import { useCast } from "../cast/castStore.ts";
import { agentPositions, clock } from "../clock.ts";
import { KERNEL } from "../kernel/lines.ts";
import { facingDir } from "../rooms/primitives.tsx";
import { useWorld } from "../store.ts";
import { LIBRARY_PETS, LibraryPet } from "./LibraryPet.tsx";
import { Foundling } from "./Foundling.tsx";
import { Kitten } from "./Kitten.tsx";
import { PETS, wanderSpots, type PetDef } from "./pets.ts";
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
  const [room, setRoom] = useState(def.homes[def.id === "myshka" ? def.homes.length - 1 : 0]!);
  const state = useRef<PetState | null>(null);
  const spotKey = useRef(0);

  const init = useMemo(() => {
    const r = def.homes[def.id === "myshka" ? def.homes.length - 1 : 0]!;
    return { room: r, station: pick(wanderSpots(r)) };
  }, [def]);

  useFrame(({ clock: three }, dt) => {
    if (!root.current || !model.current) return;
    const now = performance.now();
    const t = three.elapsedTime;
    if (!state.current) state.current = { place: init, spot: `${def.id}-0`, route: null, routeStart: now, mode: "sit", until: now + between(2000, 6000), hops: 0 };
    const s = state.current;
    const world = useWorld.getState();

    let moving = false;
    let streaming = false;
    let heading: [number, number] = [0, 0];
    if (s.route) {
      const sample = sampleRoute(s.route, (now - s.routeStart) * def.speed * Math.max(1, world.timeScale * 0.5));
      root.current.position.set(...sample.position);
      heading = sample.heading;
      streaming = sample.kind === "stream" && !sample.done;
      moving = !sample.done;
      if (sample.done) {
        const crossed = s.route.points.length > 2;
        s.route = null;
        s.mode = Math.random() < 0.5 ? "sit" : "idle";
        s.until = now + between(4000, 11000);
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
        const r = Math.random();
        const rooms = def.homes.filter((x) => x !== s.place.room);
        let next: Place | null = null;
        if (rooms.length && r < 0.14) {
          // Prefer the room you're looking at.
          const dest = world.focus && rooms.includes(world.focus) && Math.random() < 0.5 ? world.focus : pick(rooms);
          next = { room: dest, station: pick(wanderSpots(dest)) };
        } else if (r < 0.62) {
          next = { room: s.place.room, station: pick(wanderSpots(s.place.room)) };
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

  const inRoom = focus === room;
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
    setOpen((o) => !o);
  };
  const tagY = def.kind === "foundling" ? 1.15 : def.kind === "kitten" ? 0.85 : 0.7;

  return (
    <group ref={root} name={`pet-${def.id}`}>
      <group ref={model}>
        {def.kind === "kitten" && <Kitten drive={drive} />}
        {def.kind === "foundling" && <Foundling drive={drive} />}
        {(def.kind === "shiba" || def.kind === "mushnub") && (
          <Suspense fallback={null}>
            <LibraryPet def={LIBRARY_PETS[def.kind]} drive={drive} />
          </Suspense>
        )}
      </group>
      <mesh position={[0, tagY / 2, 0]} visible={false} onPointerOver={over} onPointerOut={out} onClick={click}>
        <boxGeometry args={[0.7, tagY, 0.8]} />
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
  return (
    <group>
      {PETS.map((p) => (
        <Pet key={p.id} def={p} />
      ))}
    </group>
  );
}
