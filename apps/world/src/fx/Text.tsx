import { Text as DreiText } from "@react-three/drei";
import { Suspense, type ComponentProps } from "react";

/**
 * drei's Text, loading on its own (#327). drei's Text suspends until its font and glyphs are ready, and the rooms are
 * full of signs and labels, so every room (and the whole scene's first compile) used to wait for every glyph of every
 * sign. Here each sign has its own Suspense: the room shows at once and a sign appears when its glyphs are in.
 * Glyphs are drawn by troika's workers rather than on the page's own WebGL (gpuAccelerateSDF off): the GPU path reads
 * each glyph back to the page, which stalled the main thread for most of the Lattice's boot.
 */
// troika's own prop, passed through to its mesh; drei's types don't list it.
const NO_GPU_SDF = { gpuAccelerateSDF: false } as object;

export function Text(props: ComponentProps<typeof DreiText>) {
  return (
    <Suspense fallback={null}>
      <DreiText {...NO_GPU_SDF} {...props} />
    </Suspense>
  );
}
