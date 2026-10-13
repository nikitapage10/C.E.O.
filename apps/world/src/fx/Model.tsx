import { Suspense, useEffect, useMemo, useRef } from "react";
import {
  AnimationMixer,
  Box3,
  Euler,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Group,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import bundles from "./bundles.gen.json";
import { useStreamedIn } from "../scene/roomScope.ts";
import { useLib } from "./library.ts";

const BUNDLED = bundles as Record<string, string>;

/**
 * A library model's scene graph. Static props come out of their pack's bundle (one file per kit, shared textures);
 * rigged ones have a file each. See scripts/vendor-models.mjs.
 */
function useModel(id: string): { scene: Object3D; animations: AnimationClip[] } {
  const pack = BUNDLED[id];
  const gltf = useLib(pack ?? id);
  return useMemo(() => {
    if (!pack) return gltf;
    const node = gltf.scene.getObjectByName(id.replace(/\//g, "__"));
    if (!node) throw new Error(`${id} is not in the ${pack} bundle; run scripts/vendor-models.mjs`);
    return { scene: node, animations: [] };
  }, [gltf, pack, id]);
}

type V3 = [number, number, number];

/** How big to make it: an absolute scale, or fit the model's height or its longest horizontal side. */
export type Fit = { scale: number } | { height: number } | { length: number };

interface Frame {
  /** Uniform scale that applies the fit. */
  s: number;
  /** Offset (model units) that puts the bottom centre of the bounds at the origin. */
  offset: Vector3;
}

const boundsCache = new WeakMap<Object3D, Box3>();
function frameOf(scene: Object3D, fit: Fit): Frame {
  let box = boundsCache.get(scene);
  if (!box) {
    box = new Box3().setFromObject(scene, true);
    boundsCache.set(scene, box);
  }
  const size = box.getSize(new Vector3());
  const s = "scale" in fit ? fit.scale : "height" in fit ? fit.height / Math.max(size.y, 1e-4) : fit.length / Math.max(size.x, size.z, 1e-4);
  const c = box.getCenter(new Vector3());
  return { s, offset: new Vector3(-c.x, -box.min.y, -c.z) };
}

function shadowsOn(o: Object3D, cast: boolean) {
  o.traverse((m) => {
    if ((m as Mesh).isMesh) {
      m.castShadow = cast;
      m.receiveShadow = true;
    }
  });
}

interface ModelProps {
  /** Library id, e.g. "fantasy-props/Chandelier". */
  id: string;
  fit?: Fit;
  position?: V3;
  /** Yaw in radians, or a full rotation. */
  rotation?: number | V3;
  /** Big pieces cast shadows; clutter only receives them. */
  cast?: boolean;
  /** Replace every material (a bronze statue, a glass memory). */
  material?: Material;
  /** Hold a skinned model in the first frame of this clip, as a statue. */
  pose?: string;
}

function ModelInner({ id, fit = { scale: 1 }, position, rotation = 0, cast = false, material, pose }: ModelProps) {
  const gltf = useModel(id);
  const object = useMemo(() => {
    let skinned = false;
    gltf.scene.traverse((o) => {
      if ((o as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = true;
    });
    const o = skinned ? cloneSkinned(gltf.scene) : gltf.scene.clone(true);
    shadowsOn(o, cast);
    if (material)
      o.traverse((m) => {
        if ((m as Mesh).isMesh) (m as Mesh).material = material;
      });
    return o;
  }, [gltf.scene, cast, material]);
  useEffect(() => {
    if (!pose) return;
    const clip = gltf.animations.find((c) => c.name === pose);
    if (!clip) return;
    const mixer = new AnimationMixer(object);
    mixer.clipAction(clip).play();
    mixer.update(0);
    return () => void mixer.stopAllAction();
  }, [gltf.animations, object, pose]);
  const { s, offset } = frameOf(gltf.scene, fit);
  return (
    <group position={position} rotation={typeof rotation === "number" ? [0, rotation, 0] : rotation}>
      <primitive object={object} scale={s} position={offset.clone().multiplyScalar(s).toArray()} />
    </group>
  );
}

/**
 * One library model, sat on the floor at `position`. Streams in on its own; the room doesn't wait for it. In a room
 * that isn't loading yet (another was opened first, scene/streaming.ts), it waits its turn.
 */
export function Model(props: ModelProps) {
  if (!useStreamedIn()) return null;
  return (
    <Suspense fallback={null}>
      <ModelInner {...props} />
    </Suspense>
  );
}

export interface Placement {
  position: V3;
  rotation?: number | V3;
  /** Multiplies the fit. */
  scale?: number;
}

const tmpM = new Matrix4();
const place = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const one = new Vector3(1, 1, 1);

function InstancesInner({ id, fit = { scale: 1 }, at, cast = false, material }: { id: string; fit?: Fit; at: Placement[]; cast?: boolean; material?: Material }) {
  const gltf = useModel(id);
  const group = useRef<Group>(null);
  // Callers pass literals; rebuild only when the values change.
  const key = JSON.stringify([fit, at]);
  const meshes = useMemo(() => {
    const { s, offset } = frameOf(gltf.scene, fit);
    gltf.scene.updateWorldMatrix(true, true);
    const toModel = new Matrix4().copy(gltf.scene.matrixWorld).invert();
    const base = new Matrix4().makeScale(s, s, s).multiply(new Matrix4().makeTranslation(offset.x, offset.y, offset.z));
    const out: InstancedMesh[] = [];
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const inst = new InstancedMesh(m.geometry, material ?? m.material, at.length);
      inst.castShadow = cast;
      inst.receiveShadow = true;
      const local = base.clone().multiply(toModel).multiply(m.matrixWorld);
      at.forEach((p, i) => {
        const r = p.rotation ?? 0;
        e.set(...(typeof r === "number" ? ([0, r, 0] as V3) : r));
        place.compose(new Vector3(...p.position), q.setFromEuler(e), one.clone().multiplyScalar(p.scale ?? 1));
        inst.setMatrixAt(i, tmpM.multiplyMatrices(place, local));
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      out.push(inst);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf.scene, key, cast, material]);
  useEffect(() => () => meshes.forEach((m) => m.dispose()), [meshes]);
  return (
    <group ref={group}>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  );
}

/** Many copies of one static library model, one draw call per mesh in it. Waits its turn like Model. */
export function ModelInstances(props: { id: string; fit?: Fit; at: Placement[]; cast?: boolean; material?: Material }) {
  if (!useStreamedIn()) return null;
  return (
    <Suspense fallback={null}>
      <InstancesInner {...props} />
    </Suspense>
  );
}
