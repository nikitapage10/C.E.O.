import { Stats } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import { NoToneMapping, SRGBColorSpace } from "three";
import { Agents } from "../agents/Agents.tsx";
import { Pets } from "../pets/Pets.tsx";
import { BroguEyes } from "../eyes/BroguEyes.tsx";
import { useEyes } from "../eyes/eyes.ts";
import { clock } from "../clock.ts";
import { tickMaterials } from "../fx/materials.ts";
import { PostFX } from "../fx/PostFX.tsx";
import { GlitchStage } from "../glitches/GlitchStage.tsx";
import { PARAMS } from "../params.ts";
import { Rooms } from "../rooms/Rooms.tsx";
import { pumpSimulator, useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";
import { Callouts } from "./Callouts.tsx";
import { AdaptiveResolution, canvasDpr } from "./AdaptiveResolution.tsx";
import { CameraRig } from "./CameraRig.tsx";
import { DetailLevels, ShadowFocus } from "./DetailLevels.tsx";
import { Floor, FloorRings, Motes } from "./Environment.tsx";
import { Kernel } from "./Kernel.tsx";
import { Lighting } from "./Lighting.tsx";
import { SceneReady } from "./SceneReady.tsx";
import { StillFurniture } from "./StillFurniture.tsx";
import { Streams } from "./Streams.tsx";
import { Wardrobe } from "./Wardrobe.tsx";
import {
  GuardNote,
  SceneGuard,
  watchContext,
  watchLoopErrors,
} from "./SceneGuard.tsx";
import { LetterFlight } from "../letters/LetterFlight.tsx";
import { Pumpkins } from "../veil/Pumpkins.tsx";
import { COSTUME_PARTY, VEIL } from "../veil/veil.ts";

/** Advances Lattice time, runs the simulator and animates every shader, once per frame. */
function Heartbeat() {
  useFrame(({ clock: three }, dt) => {
    clock.sim += Math.min(dt, 0.1) * 1000 * useWorld.getState().timeScale;
    pumpSimulator();
    tickMaterials(three.elapsedTime);
  }, -1);
  return null;
}

/** Whole-frame renderer counts (shadow and post passes included) for window.__ceo.renderInfo(). */
function RenderInfo() {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.info.autoReset = false;
    const api = ((
      window as unknown as { __ceo?: Record<string, unknown> }
    ).__ceo ??= {});
    api.renderInfo = () => ({
      ...gl.info.render,
      ...gl.info.memory,
      programs: gl.info.programs?.length ?? 0,
    });
    // Every compiled shader program, to spot what compiles late (and stalls a frame) after boot.
    api.programs = () =>
      (gl.info.programs ?? []).map((p) => `${p.name} ${p.cacheKey}`);
  }, [gl]);
  useFrame(() => gl.info.reset(), -1000);
  return null;
}

export function Scene() {
  const quality = useWorld((s) => s.quality);
  // Jack-o'-lanterns only while the C.E.O.'s costume party is on.
  const party = useWorld((s) =>
    s.gatherings.some((g) => g.id === COSTUME_PARTY),
  );
  const setFocus = useWorld((s) => s.setFocus);
  const selectAgent = useWorld((s) => s.selectAgent);
  useEffect(watchLoopErrors, []);
  return (
    <>
      <SceneGuard>
        <Canvas
          dpr={canvasDpr(quality)}
          camera={{ position: [0, 66, 96], fov: 38, near: 0.5, far: 600 }}
          shadows="soft"
          gl={{
            antialias: false,
            powerPreference: "high-performance",
            toneMapping: NoToneMapping,
            outputColorSpace: SRGBColorSpace,
          }}
          onCreated={({ gl }) => watchContext(gl.domElement)}
          onPointerMissed={() => {
            if (useEyes.getState().active) return;
            if (useWorld.getState().selectedAgent) selectAgent(null);
            else setFocus(null);
          }}
        >
          <color attach="background" args={[PALETTE.void]} />
          <fogExp2 attach="fog" args={[PALETTE.void, 0.0055]} />
          <Lighting />
          <Heartbeat />
          <RenderInfo />
          <Suspense fallback={null}>
            <Kernel />
            <Streams />
            <Rooms />
            <Agents />
            <Pets />
            <GlitchStage />
            <LetterFlight />
            {(VEIL || party) && <Pumpkins />}
            <Callouts />
            <Floor />
            <FloorRings />
            <Motes count={quality === "high" ? 1600 : 600} />
            <Wardrobe />
            <SceneReady />
          </Suspense>
          <CameraRig />
          <BroguEyes />
          <AdaptiveResolution quality={quality} />
          <StillFurniture />
          <DetailLevels />
          <ShadowFocus />
          <PostFX />
          {PARAMS.debug && <Stats />}
        </Canvas>
      </SceneGuard>
      <GuardNote />
    </>
  );
}
