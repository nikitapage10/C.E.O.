import { Environment, Lightformer } from "@react-three/drei";
import { useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";

/**
 * Studio lighting for the Lattice. An image-based environment built from soft light panels gives every
 * metal, lacquer and glass surface something real to reflect; one key light casts the shadows.
 */
export function Lighting() {
  const quality = useWorld((s) => s.quality);
  const high = quality === "high";
  return (
    <>
      <Environment resolution={high ? 512 : 256} frames={1} background={false}>
        {/* Overhead softboxes */}
        <Lightformer form="rect" intensity={2.2} color="#eef4ff" scale={[30, 8, 1]} position={[0, 30, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <Lightformer form="rect" intensity={1.2} color="#eef4ff" scale={[12, 40, 1]} position={[-20, 22, 0]} rotation={[Math.PI / 2, 0, 0]} />
        {/* Cool rim strips */}
        <Lightformer form="rect" intensity={3} color={PALETTE.ice} scale={[60, 1.2, 1]} position={[0, 6, -40]} />
        <Lightformer form="rect" intensity={1.6} color={PALETTE.violet} scale={[60, 1, 1]} position={[0, 3, 40]} rotation={[0, Math.PI, 0]} />
        {/* Warm low bounce */}
        <Lightformer form="ring" intensity={1.4} color="#ffcf9e" scale={14} position={[40, 2, 10]} rotation={[0, -Math.PI / 2, 0]} />
        <Lightformer form="rect" intensity={0.6} color="#9fb6d6" scale={[80, 80, 1]} position={[0, -12, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      </Environment>
      <hemisphereLight args={["#cfe0ff", "#05070b", 0.35]} />
      <directionalLight
        position={[28, 46, 22]}
        intensity={1.6}
        color="#f2f5ff"
        castShadow
        shadow-mapSize={high ? [4096, 4096] : [1024, 1024]}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
    </>
  );
}
