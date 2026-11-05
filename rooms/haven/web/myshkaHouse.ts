import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { modelUrl } from "../../../apps/world/src/modelUrl.ts";
import { MyshkaRig } from "../../../apps/world/src/pets/myshkaPose.ts";
import type { CatPose } from "./catBrain.ts";

/*
 * Myshka's body in the Haven's house (#729): the Lattice's own model and rig (pets/Myshka.tsx, myshkaPose.ts),
 * loaded only once the house is up (house.ts imports this file lazily, so the Desk's first load doesn't carry it),
 * scaled to the house, and posed from catBrain.ts each frame.
 */

/** Ears to floor, in the house's world units (a metre is one; the walls are cut away at 1.15). */
export const HOUSE_CAT_HEIGHT = 0.3;

export interface HouseCat {
  group: THREE.Group;
  /** Poses him from the brain's answer: x, y in plan units through `place`, his gait from his speed. */
  update(p: CatPose, t: number, dt: number, place: (x: number, y: number) => [number, number], unit: number): void;
  dispose(): void;
}

export async function loadHouseCat(): Promise<HouseCat> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(modelUrl("lib/custom/Myshka.glb"));
  const model = gltf.scene;
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // One skinned mesh: the bind pose's bounds don't cover a stretch or a walk.
    if (mesh.isMesh) mesh.frustumCulled = false;
  });
  const box = new THREE.Box3().setFromObject(model, true);
  const scale = HOUSE_CAT_HEIGHT / Math.max(0.01, box.max.y - box.min.y);
  const group = new THREE.Group();
  group.scale.setScalar(scale);
  group.add(model);
  group.name = "myshka";
  const rig = new MyshkaRig(model, gltf.animations);
  return {
    group,
    update(p, t, dt, place, unit) {
      const [x, z] = place(p.x, p.y);
      group.position.set(x, 0, z);
      group.rotation.y = p.heading;
      // The rig wants his speed in his own model's units a second.
      rig.update(p.mode, t, dt, p.speed / unit / scale);
    },
    dispose() {
      rig.dispose();
      model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of [mesh.material].flat()) {
          for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
          m.dispose();
        }
      });
    },
  };
}
