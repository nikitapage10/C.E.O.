import { ROOM_IDS, streamCurve, type RoomId } from "@ceo/core";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CatmullRomCurve3, InstancedMesh, Object3D, TubeGeometry, Vector3 } from "three";
import { emissive, streamMaterial } from "../fx/materials.ts";
import { PALETTE } from "../theme.ts";

const PACKETS_PER_STREAM = 5;
const dummy = new Object3D();

/** One room's light stream: a few long-exposure threads plus data packets riding them. */
function Stream({ room, index }: { room: RoomId; index: number }) {
  const { curve, threads } = useMemo(() => {
    const curve = new CatmullRomCurve3(streamCurve(room, 32).map((p) => new Vector3(...p)));
    const threads = [0, 1, 2].map((k) => {
      const offset = new Vector3((k - 1) * 0.16, (k - 1) * 0.1, 0);
      const pts = curve.getPoints(64).map((p, i, arr) => {
        const t = i / (arr.length - 1);
        // Threads braid apart mid-flight and converge at both ends.
        const spread = Math.sin(t * Math.PI);
        return p.clone().add(offset.clone().multiplyScalar(spread * (1 + Math.sin(t * 9 + k) * 0.6)));
      });
      return {
        geometry: new TubeGeometry(new CatmullRomCurve3(pts), 96, k === 1 ? 0.045 : 0.022, 5, false),
        material: streamMaterial(k === 2 ? "#cfe3f5" : PALETTE.silver, {
          speed: 0.18 + k * 0.08 + index * 0.01,
          dashes: 2 + k,
          intensity: k === 1 ? 1.9 : 1.2,
        }),
      };
    });
    return { curve, threads };
  }, [room, index]);

  const packets = useRef<InstancedMesh>(null);
  const offsets = useMemo(() => Array.from({ length: PACKETS_PER_STREAM }, (_, i) => i / PACKETS_PER_STREAM + Math.random() * 0.1), []);
  const inbound = index % 2 === 0;

  useFrame(({ clock }) => {
    const mesh = packets.current;
    if (!mesh) return;
    const t = clock.elapsedTime * 0.08;
    offsets.forEach((o, i) => {
      let u = (o + t) % 1;
      if (!inbound) u = 1 - u;
      curve.getPointAt(u, dummy.position);
      dummy.scale.setScalar(0.09 + 0.05 * Math.sin(u * Math.PI));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {threads.map((th, i) => (
        <mesh key={i} geometry={th.geometry} material={th.material} renderOrder={3} />
      ))}
      <instancedMesh ref={packets} args={[undefined, emissive(PALETTE.silver, 4), PACKETS_PER_STREAM]} frustumCulled={false}>
        <octahedronGeometry args={[1, 0]} />
      </instancedMesh>
    </group>
  );
}

export function Streams() {
  return (
    <group>
      {ROOM_IDS.map((r, i) => (
        <Stream key={r} room={r} index={i} />
      ))}
    </group>
  );
}
