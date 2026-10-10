import { useFrame } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Glitch, N8AO, Noise, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { BlendFunction, GlitchMode, ToneMappingMode, type ChromaticAberrationEffect, type GlitchEffect } from "postprocessing";
import { useMemo, useRef } from "react";
import { Vector2 } from "three";
import { useWorld } from "../store.ts";

/**
 * Bloom, a whisper of chromatic aberration, grain and vignette; a brief glitch when the Lattice hiccups.
 * The effect chain is built once and never re-rendered: toggling effects through React state rebuilds the
 * composer's passes and recompiles shaders, which shows up as black frames. Effects are flipped via refs.
 */
export function PostFX() {
  const quality = useWorld((s) => s.quality);
  const ca = useRef<ChromaticAberrationEffect>(null);
  const offset = useMemo(() => new Vector2(0.0006, 0.0004), []);
  const glitch = useRef<GlitchEffect>(null);

  useFrame(() => {
    const flashing = useWorld.getState().flashUntil > performance.now();
    if (glitch.current) glitch.current.mode = flashing ? GlitchMode.CONSTANT_MILD : GlitchMode.DISABLED;
    const target = flashing ? 0.006 : 0.00025;
    offset.x += (target - offset.x) * 0.3;
    offset.y = offset.x * 0.7;
    if (ca.current) ca.current.offset = offset;
  });

  const high = quality === "high";
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {high ? <N8AO halfRes aoRadius={1.6} distanceFalloff={0.6} intensity={2.2} quality="medium" /> : <></>}
      <Bloom mipmapBlur intensity={0.75} luminanceThreshold={1} luminanceSmoothing={0.2} radius={0.7} />
      <ChromaticAberration ref={ca} offset={offset} radialModulation={false} modulationOffset={0} />
      <Glitch ref={glitch} mode={GlitchMode.DISABLED} delay={new Vector2(0, 0)} duration={new Vector2(0.05, 0.12)} strength={new Vector2(0.03, 0.09)} columns={0.02} ratio={0.4} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.08} />
      <Vignette offset={0.3} darkness={0.6} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <SMAA />
    </EffectComposer>
  );
}
