import { Stats } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import { NoToneMapping, SRGBColorSpace, Texture } from "three";
import { useBoot } from "../boot.ts";
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
import { AdaptiveResolution, canvasDpr, lowPower } from "./AdaptiveResolution.tsx";
import { Backstage, TripTimer } from "./Backstage.tsx";
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
import { COUNTDOWN_SPOTS, Pumpkins } from "../veil/Pumpkins.tsx";
import { useVeilCountdown } from "../veil/useVeilCountdown.ts";
import { COSTUME_PARTY, VEIL } from "../veil/veil.ts";

// Sharp textures at a slant (#327): the floors, desks and crate tops seen from the camera's height. Every texture made
// from here on, the models' included, filters anisotropically (three.js clamps it to what the card supports).
Texture.DEFAULT_ANISOTROPY = lowPower() ? 4 : 8;

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
  // The week before Halloween, one lantern by the club's front, counting down; the Veil's own take over when it opens.
  const countdown = useVeilCountdown();
  const setFocus = useWorld((s) => s.setFocus);
  // No frame until the first shader compile is done (scene/SceneReady.tsx, boot.ts), and none behind the Desk (#373):
  // the simulator ticks in the frame loop, so it pauses with it.
  const drawing = useBoot((s) => s.drawing);
  const active = useBoot((s) => s.active);
  const selectAgent = useWorld((s) => s.selectAgent);
  useEffect(watchLoopErrors, []);
  return (
    <>
      <SceneGuard>
        <Canvas
          dpr={canvasDpr(quality)}
          frameloop={drawing && active ? "always" : "never"}
          camera={{ position: [0, 66, 96], fov: 38, near: 0.5, far: 600 }}
          shadows="soft"
          gl={{
            antialias: false,
            powerPreference: "high-performance",
            toneMapping: NoToneMapping,
            outputColorSpace: SRGBColorSpace,
          }}
          onCreated={({ gl }) => {
            // Checking each shader for errors reads its compile log straight after linking, which makes the browser
            // wait for the compile right there; in production the compile runs on its own threads instead (#327).
            gl.debug.checkShaderErrors = import.meta.env.DEV;
            watchContext(gl.domElement);
          }}
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
          <Backstage />
          <TripTimer />
          <Suspense fallback={null}>
            <Kernel />
            <Streams />
            <Rooms />
            <Agents />
            <Pets />
            <GlitchStage />
            <LetterFlight />
            {VEIL || party ? <Pumpkins key="veil" /> : countdown !== null && <Pumpkins key="countdown" spots={COUNTDOWN_SPOTS} name="veil-countdown" />}
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
