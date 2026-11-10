import { describe, expect, it } from "vitest";
import { Bone, BufferGeometry, Euler, Float32BufferAttribute, Group, MeshBasicMaterial, Quaternion, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from "three";
import { bakePose, BENCH_NOD, turnHead } from "./benchBake.ts";

/** A small rig: hips, a spine, a head with a top, and a mesh whose vertices lean on them in shares. */
function rig() {
  const hips = new Bone();
  const spine = new Bone();
  spine.position.set(0, 1, 0);
  const head = new Bone();
  head.position.set(0, 0.6, 0.05);
  const top = new Bone();
  top.position.set(0, 0.3, 0);
  hips.add(spine);
  spine.add(head);
  head.add(top);
  const g = new BufferGeometry();
  const pts = [
    [0.2, 0.1, 0],
    [0.1, 1.2, 0.1],
    [0, 1.7, 0.2],
    [-0.1, 1.9, -0.1],
    [0.15, 1.55, 0.12],
  ];
  g.setAttribute("position", new Float32BufferAttribute(pts.flat(), 3));
  g.setAttribute("normal", new Float32BufferAttribute(pts.flatMap(() => [0, 0, 1]), 3));
  // bones: 0 hips, 1 spine, 2 head, 3 top
  g.setAttribute("skinIndex", new Uint16BufferAttribute([0, 1, 0, 0, 1, 2, 0, 0, 2, 3, 0, 0, 3, 2, 1, 0, 1, 2, 3, 0], 4));
  g.setAttribute("skinWeight", new Float32BufferAttribute([0.7, 0.3, 0, 0, 0.6, 0.4, 0, 0, 0.8, 0.2, 0, 0, 0.5, 0.3, 0.2, 0, 0.5, 0.3, 0.2, 0], 4));
  const mesh = new SkinnedMesh(g, new MeshBasicMaterial());
  const root = new Group();
  root.position.set(3, -1, 2);
  root.scale.setScalar(0.5);
  root.add(mesh, hips);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([hips, spine, head, top]));
  return { root, mesh, spine, head };
}

describe("the bench's baked figures (#973)", () => {
  it("bakes the pose and turns the head exactly as three's skinning does", () => {
    const { root, mesh, spine, head } = rig();
    // A pose of its own (as the bench's arms are), then baked.
    spine.quaternion.setFromEuler(new Euler(0.2, 0.1, -0.15));
    root.updateMatrixWorld(true);
    const baked = bakePose(mesh, head);
    const pos = baked.geometry.getAttribute("position");
    const bind = head.quaternion.clone();
    for (const yaw of [0, 0.4, -0.75]) {
      head.quaternion.copy(bind).multiply(new Quaternion().setFromEuler(new Euler(BENCH_NOD, yaw, 0)));
      root.updateMatrixWorld(true);
      mesh.skeleton.update();
      for (let i = 0; i < pos.count; i++) {
        // three's own CPU skinning, in the mesh's space (applyBoneTransform answers in it).
        const want = mesh.applyBoneTransform(i, new Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position"), i));
        const got = turnHead([pos.getX(i), pos.getY(i), pos.getZ(i)], baked.geometry.getAttribute("aHead").getX(i), yaw, baked.head);
        expect(got[0]).toBeCloseTo(want.x, 5);
        expect(got[1]).toBeCloseTo(want.y, 5);
        expect(got[2]).toBeCloseTo(want.z, 5);
      }
    }
  });

  it("marks how much of each vertex follows the head", () => {
    const { root, mesh, head } = rig();
    root.updateMatrixWorld(true);
    const h = bakePose(mesh, head).geometry.getAttribute("aHead");
    expect([0, 1, 2, 3, 4].map((i) => Math.round(h.getX(i) * 100) / 100)).toEqual([0, 0.4, 1, 0.8, 0.5]);
  });
});
