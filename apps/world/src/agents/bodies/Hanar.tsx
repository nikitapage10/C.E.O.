import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Euler, Quaternion, type Bone, type Group, type Mesh, type Object3D } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { preloadLib, useLib } from "../../fx/library.ts";
import { smooth } from "./limbs.ts";
import { fitScale } from "./Rigged.tsx";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

const MODEL = "custom/Blasto";

/** The tentacles: every chain of five or more bones hanging off the body, root first, with its rest pose. */
function chainsOf(model: Object3D) {
  const chains: { bone: Bone; rest: Quaternion }[][] = [];
  model.traverse((o) => {
    const b = o as Bone;
    if (!b.isBone) return;
    // A chain starts at a bone whose parent branches (has several bone children).
    const siblings = b.parent?.children.filter((c) => (c as Bone).isBone) ?? [];
    if (siblings.length < 2) return;
    const chain: Bone[] = [];
    let k: Object3D | undefined = b;
    while (k && (k as Bone).isBone) {
      chain.push(k as Bone);
      const next: Object3D[] = k.children.filter((c) => (c as Bone).isBone);
      k = next.length === 1 ? next[0] : undefined;
    }
    if (chain.length >= 5) chains.push(chain.map((bone) => ({ bone, rest: bone.quaternion.clone() })));
  });
  return chains;
}

const e = new Euler();
const q = new Quaternion();

/**
 * A hanar: a floating jellyfish who drifts rather than walks. The model ships without animation, so the six
 * tentacles undulate in code, each a travelling wave down its bones: slow and lazy at rest, longer strides when
 * gliding, a flourish to celebrate, the front pair curling to work, and a slow sink to the floor to nap.
 */
export function Hanar({ drive, phase }: BodyProps) {
  const gltf = useLib(MODEL);
  const float = useRef<Group>(null);
  const model = useMemo(() => {
    const m = cloneSkinned(gltf.scene);
    m.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
    return m;
  }, [gltf.scene]);
  const chains = useMemo(() => chainsOf(model), [model]);
  const scale = fitScale(gltf.scene, BODY_HEIGHT.hanar);
  const s = useRef({ amp: 0.12, freq: 0.9, curl: 0, sink: 0, tilt: 0 });

  useFrame(() => {
    const d = drive.current;
    if (!d || !float.current) return;
    const { mode, t } = d;
    const gliding = mode === "walking" || mode === "carrying";
    const st = s.current;
    st.amp = smooth(st.amp, gliding ? 0.26 : mode === "celebrating" ? 0.36 : mode === "napping" ? 0.05 : mode === "slumped" ? 0.06 : 0.12, 0.05);
    st.freq = smooth(st.freq, gliding ? 1.7 : mode === "celebrating" ? 2.6 : 0.8, 0.05);
    st.curl = smooth(st.curl, mode === "typing" || mode === "working" ? 1 : 0, 0.08);
    st.sink = smooth(st.sink, mode === "napping" ? 1 : mode === "slumped" ? 0.35 : 0, 0.03);
    st.tilt = smooth(st.tilt, gliding ? 0.12 : mode === "slumped" ? 0.22 : 0, 0.05);

    // Drift: a slow bob, leaning into the glide, settling down to nap.
    float.current.position.y = 0.18 + Math.sin(t * 1.1 + phase) * 0.06 - st.sink * 0.42;
    float.current.rotation.x = st.tilt;

    chains.forEach((chain, k) => {
      const front = k < 2;
      chain.forEach(({ bone, rest }, i) => {
        const along = (i + 1) / chain.length;
        const w = t * st.freq - i * 0.65 + k * 1.05 + phase;
        const a = st.amp * (0.35 + along);
        // Front tentacles curl forward to handle things; napping splays everything out on the floor.
        const curl = (front ? st.curl * 0.38 : 0) + st.sink * 0.22;
        e.set(Math.sin(w) * a + curl, Math.sin(w * 0.7 + k) * a * 0.3, Math.cos(w) * a * 0.6);
        bone.quaternion.copy(rest).multiply(q.setFromEuler(e));
      });
    });
  });

  return (
    <group ref={float}>
      {/* The model was built facing away from its front. */}
      <primitive object={model} scale={scale} rotation={[0, Math.PI, 0]} />
    </group>
  );
}

preloadLib(MODEL);
