import type { Prop } from "@ceo/core";
import { PBR } from "../fx/pbr.ts";
import { Block } from "../rooms/primitives.tsx";
import { PALETTE } from "../theme.ts";

/** What agents carry. Small, readable, real materials; held between the hands, centred at the origin. */
export function PropMesh({ prop }: { prop: Prop }) {
  switch (prop) {
    case "crate":
      return <Block size={[0.42, 0.32, 0.32]} material={PBR.wood("oak")} radius={0.03} />;
    case "cube":
      return (
        <mesh material={PBR.light(PALETTE.ice, 3)}>
          <boxGeometry args={[0.18, 0.18, 0.18]} />
        </mesh>
      );
    case "envelope":
      return <Block size={[0.36, 0.24, 0.02]} rotation={[0.3, 0, 0]} material={PBR.matte("#efe8d8", 0.9)} radius={0.005} />;
    case "ball":
      return (
        <mesh material={PBR.lacquer("#7a3f22", 0.5)} scale={[1, 0.62, 0.62]} castShadow>
          <sphereGeometry args={[0.16, 20, 14]} />
        </mesh>
      );
    case "book":
      return <Block size={[0.3, 0.4, 0.07]} material={PBR.lacquer("#3a2a5c", 0.5)} radius={0.01} />;
    case "coin":
      return (
        <mesh material={PBR.brass()} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.13, 0.03, 28]} />
        </mesh>
      );
    case "mug":
      return (
        <mesh material={PBR.lacquer("#e8e4dc", 0.3)} castShadow>
          <cylinderGeometry args={[0.07, 0.065, 0.15, 20]} />
        </mesh>
      );
    case "chart":
      return <Block size={[0.4, 0.3, 0.015]} material={PBR.lacquer("#f2f2f0", 0.4)} radius={0.005} />;
  }
}
