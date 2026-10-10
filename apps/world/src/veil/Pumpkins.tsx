import { ROOM_IDS, roomAngle, roomToWorld } from "@ceo/core";
import { useLayoutEffect, useMemo, useRef } from "react";
import { InstancedMesh, Object3D, SphereGeometry } from "three";
import { PBR } from "../fx/pbr.ts";

/** Where the jack-o'-lanterns sit in every room (room-local x, z, size): the front corners, out of everyone's way. */
const SPOTS: [number, number, number][] = [
  [-7.2, 5.85, 1.25],
  [-6.55, 6.1, 0.8],
  [7.25, 5.9, 1],
];

/**
 * The Hallowed Veil's jack-o'-lanterns: three in each room, lit from inside. Three instanced meshes for the lot
 * (shells, stems, grins), and no lights: the grins glow through the bloom.
 */
export function Pumpkins() {
  const shells = useRef<InstancedMesh>(null);
  const stems = useRef<InstancedMesh>(null);
  const grins = useRef<InstancedMesh>(null);
  const shellGeo = useMemo(() => {
    // A ribbed pumpkin: a sphere pushed in along eight lobes.
    const g = new SphereGeometry(0.22, 24, 14);
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 - 0.07 * Math.pow(Math.abs(Math.cos(a * 4)), 3);
      p.setXYZ(i, x * k, p.getY(i) * 0.78, z * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const count = ROOM_IDS.length * SPOTS.length;

  useLayoutEffect(() => {
    const o = new Object3D();
    let i = 0;
    for (const room of ROOM_IDS) {
      for (const [x, z, s] of SPOTS) {
        const [wx, wy, wz] = roomToWorld(room, x, 0, z);
        // Face the room's front, toward the camera, turned a little each.
        const yaw = roomAngle(room) + (x < 0 ? 0.5 : -0.5);
        o.position.set(wx, wy + 0.17 * s, wz);
        o.rotation.set(0, yaw, 0);
        o.scale.setScalar(s);
        o.updateMatrix();
        shells.current?.setMatrixAt(i, o.matrix);
        o.position.set(wx, wy + 0.36 * s, wz);
        o.updateMatrix();
        stems.current?.setMatrixAt(i, o.matrix);
        // The grin, just proud of the shell's face.
        o.position.set(wx + Math.sin(yaw) * 0.2 * s, wy + 0.16 * s, wz + Math.cos(yaw) * 0.2 * s);
        o.scale.set(s, s * 0.45, s * 0.3);
        o.updateMatrix();
        grins.current?.setMatrixAt(i, o.matrix);
        i++;
      }
    }
    for (const m of [shells, stems, grins]) if (m.current) m.current.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group name="hallowed-veil">
      <instancedMesh ref={shells} args={[shellGeo, PBR.lacquer("#e8701e", 0.45), count]} castShadow receiveShadow />
      <instancedMesh ref={stems} args={[undefined, PBR.matte("#3d5a1e", 0.8), count]}>
        <cylinderGeometry args={[0.025, 0.035, 0.1, 8]} />
      </instancedMesh>
      <instancedMesh ref={grins} args={[undefined, PBR.light("#ffb54a", 3.5), count]}>
        <sphereGeometry args={[0.09, 12, 6]} />
      </instancedMesh>
    </group>
  );
}
