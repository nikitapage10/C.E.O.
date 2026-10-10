import { CostumePiece } from "../agents/Costume.tsx";
import { useBoot } from "../boot.ts";
import { LetterEnvelope } from "../letters/LetterFlight.tsx";
import type { Costume } from "../store.ts";
import { Pumpkins } from "../veil/Pumpkins.tsx";

const ALL: Costume[] = ["wizard-hat", "helm", "hood", "crown", "horns", "feather-cap", "witch-hat", "pumpkin", "devil-horns", "bat-band", "ghost-sheet"];

/**
 * Everything that only turns up for an event (costume pieces, the costume party's jack-o'-lanterns, a letter
 * in flight), mounted out of sight while the world loads, so <SceneReady> compiles their shaders with the rest.
 * Without it, the first costume party or campaign stalls the frame while the GPU compiles them. Gone once the
 * world is ready.
 */
export function Wardrobe() {
  const ready = useBoot((s) => s.sceneReady);
  if (ready) return null;
  return (
    <group position={[0, -60, 0]} name="wardrobe">
      {ALL.map((kind, i) => (
        <group key={kind} position={[i, 0, 0]}>
          <CostumePiece kind={kind} />
        </group>
      ))}
      <LetterEnvelope />
      <Pumpkins />
    </group>
  );
}
