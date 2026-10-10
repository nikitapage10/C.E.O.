import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, type Group } from "three";
import { unlock } from "../achievements/achievements.ts";
import { useCast } from "../cast/castStore.ts";
import { agentPositions } from "../clock.ts";
import { PBR } from "../fx/pbr.ts";
import { useWorld } from "../store.ts";
import { BLASTO_DEPARTS, KERNEL_LETTER, replyTo, useLetters } from "./letters.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const nameOf = (id: string) => useCast.getState().cast.profiles[id]?.name ?? id;

/** Who carries a letter to `to`: Blasto, unless it's for Blasto, in which case his partner Dialtone does. */
export function courierFor(to: string) {
  return to === "postmaster" ? "dialtone" : "postmaster";
}

/** Post a letter from the C.E.O.: Blasto announces it, the Kernel logs it, and the envelope takes off. */
export function sendLetter(to: string, text: string): boolean {
  const from = courierFor(to);
  const letter = useLetters.getState().post(to, text);
  if (!letter) return false;
  useLetters.setState((s) => ({ inFlight: s.inFlight && { ...s.inFlight, from } }));
  const w = useWorld.getState();
  w.say(from, pick(BLASTO_DEPARTS).replace("{to}", nameOf(to)));
  w.emote(from, "✉", 4000);
  w.announce(pick(KERNEL_LETTER).replace("{to}", nameOf(to)), "status", w.lattice.agents[to]?.place.room ?? null);
  unlock("pen-pal");
  return true;
}

const a = new Vector3();
const b = new Vector3();

/**
 * The envelope in flight: a sealed letter arcing high over the Lattice from the courier to the recipient. When it
 * lands, the recipient turns to you, reads it and answers. One small mesh while a letter flies; nothing otherwise.
 */
export function LetterFlight() {
  const env = useRef<Group>(null);
  const inFlight = useLetters((s) => s.inFlight);
  useFrame(({ clock }) => {
    const f = useLetters.getState().inFlight;
    if (!f || !env.current) return;
    const t = Math.min(1, (performance.now() - f.startedAt) / f.durationMs);
    const from = agentPositions.get(f.from);
    const to = agentPositions.get(f.letter.to);
    if (!from || !to) {
      if (t >= 1) useLetters.getState().land();
      return;
    }
    a.copy(from).setY(from.y + 1.8);
    b.copy(to).setY(to.y + 1.8);
    const e = t * t * (3 - 2 * t);
    env.current.position.lerpVectors(a, b, e);
    env.current.position.y += Math.sin(t * Math.PI) * Math.min(14, 2 + a.distanceTo(b) * 0.35);
    env.current.rotation.set(Math.sin(clock.elapsedTime * 6) * 0.25, clock.elapsedTime * 3, 0);
    if (t >= 1) arrive(f.letter.id, f.letter.to, f.letter.text);
  });
  if (!inFlight) return null;
  return (
    <group ref={env} name="letter">
      <LetterEnvelope />
    </group>
  );
}

/** A sealed letter with a faint glow. */
export function LetterEnvelope() {
  return (
    <>
      <mesh material={PBR.matte("#f4ecd8", 0.7)} castShadow>
        <boxGeometry args={[0.36, 0.24, 0.03]} />
      </mesh>
      <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]} material={PBR.lacquer("#b8221e", 0.3)}>
        <cylinderGeometry args={[0.045, 0.045, 0.015, 12]} />
      </mesh>
      <mesh scale={[1.25, 1.35, 0.6]}>
        <octahedronGeometry args={[0.2, 0]} />
        <meshBasicMaterial color="#ffe2a0" transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </>
  );
}

function arrive(id: string, to: string, text: string) {
  useLetters.getState().land();
  const w = useWorld.getState();
  // A seed from the letter, so a re-read never changes the answer.
  let seed = 0;
  for (const c of text) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
  const reply = replyTo(to, text, seed);
  useLetters.getState().answer(id, reply);
  w.emote(to, "✉", 2500);
  w.override(to, "stare", 5000);
  setTimeout(() => {
    useWorld.getState().say(to, reply);
    useWorld.getState().emote(to, "♥", 3500);
  }, 1200);
}
