import { Stats } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense } from "react";
import { NoToneMapping, SRGBColorSpace } from "three";
import { Agents } from "../agents/Agents.tsx";
import { clock } from "../clock.ts";
import { tickMaterials } from "../fx/materials.ts";
import { PostFX } from "../fx/PostFX.tsx";
import { GlitchStage } from "../glitches/GlitchStage.tsx";
import { PARAMS } from "../params.ts";
import { Rooms } from "../rooms/Rooms.tsx";
import { pumpSimulator, useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";
import { Callouts } from "./Callouts.tsx";
import { CameraRig } from "./CameraRig.tsx";
import { Floor, FloorRings, Motes } from "./Environment.tsx";
import { Kernel } from "./Kernel.tsx";
import { Lighting } from "./Lighting.tsx";
import { Streams } from "./Streams.tsx";

/** Advances Lattice time, runs the simulator and animates every shader, once per frame. */
function Heartbeat() {
  useFrame(({ clock: three }, dt) => {
    clock.sim += Math.min(dt, 0.1) * 1000 * useWorld.getState().timeScale;
    pumpSimulator();
    tickMaterials(three.elapsedTime);
  }, -1);
  return null;
}

export function Scene() {
  const quality = useWorld((s) => s.quality);
  const setFocus = useWorld((s) => s.setFocus);
  const selectAgent = useWorld((s) => s.selectAgent);
  return (
    <Canvas
      dpr={quality === "high" ? [1, 2] : [1, 1.25]}
      camera={{ position: [0, 66, 96], fov: 38, near: 0.5, far: 600 }}
      shadows="soft"
      gl={{ antialias: false, powerPreference: "high-performance", toneMapping: NoToneMapping, outputColorSpace: SRGBColorSpace }}
      onPointerMissed={() => {
        if (useWorld.getState().selectedAgent) selectAgent(null);
        else setFocus(null);
      }}
    >
      <color attach="background" args={[PALETTE.void]} />
      <fogExp2 attach="fog" args={[PALETTE.void, 0.0055]} />
      <Lighting />
      <Heartbeat />
      <Suspense fallback={null}>
        <Kernel />
        <Streams />
        <Rooms />
        <Agents />
        <GlitchStage />
        <Callouts />
        <Floor />
        <FloorRings />
        <Motes count={quality === "high" ? 1600 : 600} />
      </Suspense>
      <CameraRig />
      <PostFX />
      {PARAMS.debug && <Stats />}
    </Canvas>
  );
}
