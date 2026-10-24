import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  SkinnedMesh,
} from "three";
import { describe, expect, it } from "vitest";
import { DETAIL_LAYER, HIDDEN_LAYER, projectedPx } from "./DetailLevels.tsx";
import { MERGED_LAYER, STILL_TAG, baked, mergePiece, mergeable, pieceKey, sphereIn } from "./stillFurniture.ts";

const wood = new MeshStandardMaterial({ color: "#7a5230" });
const steel = new MeshStandardMaterial({ color: "#2b3038" });

/** A room's clickable group with one mesh inside it, matrices up to date. */
function inRoom(mesh: Mesh, between?: Group) {
  const root = new Group();
  root.position.set(30, 0, -10);
  if (between) {
    root.add(between);
    between.add(mesh);
  } else root.add(mesh);
  root.updateMatrixWorld(true);
  return { root, mesh };
}

const box = (m: Material = wood) => new Mesh(new BoxGeometry(1, 1, 1), m);

describe("which meshes may merge (#136)", () => {
  it("takes a plain opaque mesh inside the room", () => {
    const { root, mesh } = inRoom(box());
    expect(mergeable(mesh, root)).toBe(true);
    // ...wherever level of detail has put it for now.
    for (const layer of [DETAIL_LAYER, HIDDEN_LAYER]) {
      mesh.layers.set(layer);
      expect(mergeable(mesh, root)).toBe(true);
    }
  });

  it("leaves out a mesh with no real place yet (NaN in its matrix)", () => {
    const { root, mesh } = inRoom(box());
    mesh.matrixWorld.elements[12] = Number.NaN;
    expect(mergeable(mesh, root)).toBe(false);
  });

  it("leaves a moving part's meshes to its own root (a podium, #373)", () => {
    const raft = new Group();
    raft.userData.stillRoot = "foundry-podium";
    const { root, mesh } = inRoom(box(), raft);
    expect(mergeable(mesh, root)).toBe(false);
    expect(mergeable(mesh, raft)).toBe(true);
  });

  it("leaves out anything opted out, on the mesh or a group above it", () => {
    const a = inRoom(box());
    a.mesh.userData.merge = false;
    expect(mergeable(a.mesh, a.root)).toBe(false);
    const group = new Group();
    group.userData.merge = false;
    const b = inRoom(box(), group);
    expect(mergeable(b.mesh, b.root)).toBe(false);
    const c = inRoom(box());
    c.mesh.userData.lod = false;
    expect(mergeable(c.mesh, c.root)).toBe(false);
  });

  it("leaves out hover and click targets, and anything inside one", () => {
    const a = inRoom(box());
    (a.mesh as unknown as { __r3f: { eventCount: number } }).__r3f = { eventCount: 1 };
    expect(mergeable(a.mesh, a.root)).toBe(false);
    const group = new Group();
    (group as unknown as { __r3f: { eventCount: number } }).__r3f = { eventCount: 2 };
    const b = inRoom(box(), group);
    expect(mergeable(b.mesh, b.root)).toBe(false);
    // The room's own click handler (on the root) is where pieces live, so it doesn't count.
    const c = inRoom(box());
    (c.root as unknown as { __r3f: { eventCount: number } }).__r3f = { eventCount: 1 };
    expect(mergeable(c.mesh, c.root)).toBe(true);
  });

  it("leaves out transparent, shader, customised and multi-material meshes", () => {
    const glass = new MeshStandardMaterial({ transparent: true, opacity: 0.3 });
    const custom = new MeshStandardMaterial();
    custom.onBeforeCompile = () => {};
    for (const m of [glass, new ShaderMaterial(), custom]) {
      const { root, mesh } = inRoom(box(m));
      expect(mergeable(mesh, root)).toBe(false);
    }
    const multi = inRoom(new Mesh(new BoxGeometry(), [wood, steel]));
    expect(mergeable(multi.mesh, multi.root)).toBe(false);
  });

  it("leaves out skinned, instanced and morphing meshes", () => {
    const skinned = inRoom(new SkinnedMesh(new BoxGeometry(), wood));
    expect(mergeable(skinned.mesh, skinned.root)).toBe(false);
    const inst = inRoom(new InstancedMesh(new BoxGeometry(), wood, 4));
    expect(mergeable(inst.mesh, inst.root)).toBe(false);
    const g = new BoxGeometry();
    g.morphAttributes.position = [g.attributes.position!.clone()];
    const morph = inRoom(new Mesh(g, wood));
    expect(mergeable(morph.mesh, morph.root)).toBe(false);
  });

  it("leaves out hidden, mirrored, sorted, custom-drawn and already merged meshes", () => {
    const hidden = new Group();
    hidden.visible = false;
    const a = inRoom(box(), hidden);
    expect(mergeable(a.mesh, a.root)).toBe(false);
    const mirrored = box();
    mirrored.scale.x = -1;
    const b = inRoom(mirrored);
    expect(mergeable(b.mesh, b.root)).toBe(false);
    const sorted = box();
    sorted.renderOrder = 2;
    const c = inRoom(sorted);
    expect(mergeable(c.mesh, c.root)).toBe(false);
    const hooked = box();
    hooked.onBeforeRender = () => {};
    const d = inRoom(hooked);
    expect(mergeable(d.mesh, d.root)).toBe(false);
    const piece = box();
    piece.userData[STILL_TAG] = true;
    const e = inRoom(piece);
    expect(mergeable(e.mesh, e.root)).toBe(false);
  });

  it("leaves out meshes on other layers, its own merged layer included", () => {
    for (const layer of [5, MERGED_LAYER]) {
      const { root, mesh } = inRoom(box());
      mesh.layers.set(layer);
      expect(mergeable(mesh, root)).toBe(false);
    }
  });

  it("leaves out a mesh outside the room", () => {
    const { mesh } = inRoom(box());
    expect(mergeable(mesh, new Group())).toBe(false);
  });
});

describe("how members group into pieces", () => {
  const keyOf = (mesh: Mesh, radius: number, cast = true) => pieceKey(mesh, cast, radius);

  it("keeps materials, shadow flags and vertex layouts apart", () => {
    const a = box(wood);
    expect(keyOf(a, 0.5)).toBe(keyOf(box(wood), 0.6));
    expect(keyOf(a, 0.5)).not.toBe(keyOf(box(steel), 0.5));
    expect(keyOf(a, 0.5, true)).not.toBe(keyOf(a, 0.5, false));
    const noUv = new BoxGeometry();
    noUv.deleteAttribute("uv");
    expect(keyOf(a, 0.5)).not.toBe(keyOf(new Mesh(noUv, wood), 0.5));
    const unlit = box();
    unlit.receiveShadow = true;
    expect(keyOf(a, 0.5)).not.toBe(keyOf(unlit, 0.5));
  });

  it("keeps sizes a doubling apart in separate pieces", () => {
    const a = box();
    // A book and a cabinet: different pieces.
    expect(keyOf(a, 0.1)).not.toBe(keyOf(a, 0.9));
    // Two books, or two walls: one piece each.
    expect(keyOf(a, 0.1)).toBe(keyOf(a, 0.12));
    expect(keyOf(a, 4)).toBe(keyOf(a, 6));
  });

  it("groups a room's members into one piece per key", () => {
    const meshes = [box(wood), box(wood), box(steel), box(wood)];
    const radii = [0.3, 0.35, 0.3, 3];
    const pieces = new Set(meshes.map((m, i) => keyOf(m, radii[i]!)));
    expect(pieces.size).toBe(3);
  });

  it("measures members in room space", () => {
    const { root, mesh } = inRoom(box());
    mesh.position.set(2, 0, 3);
    root.updateMatrixWorld(true);
    const s = sphereIn(mesh, root.matrixWorld.clone().invert());
    expect(s.center.x).toBeCloseTo(2);
    expect(s.center.z).toBeCloseTo(3);
  });
});

describe("baking and merging", () => {
  it("bakes quantised and unindexed geometry into indexed floats", () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true));
    const out = baked(g, new Matrix4().makeTranslation(1, 2, 3));
    expect(out.attributes.position!.array).toBeInstanceOf(Float32Array);
    expect(out.index!.count).toBe(3);
    expect(out.attributes.position!.getX(1)).toBeCloseTo(2);
    expect(out.attributes.position!.getY(2)).toBeCloseTo(3);
  });

  it("merges members into one geometry with every triangle, and sizes it for level of detail", () => {
    const a = box();
    const b = box();
    const piece = mergePiece([
      { mesh: a, local: new Matrix4().makeTranslation(-2, 0, 0) },
      { mesh: b, local: new Matrix4().makeTranslation(2, 0, 0) },
    ])!;
    expect(piece.geometry.index!.count).toBe(a.geometry.index!.count * 2);
    expect(piece.lodSphere.radius).toBeCloseTo(a.geometry.boundingSphere!.radius);
    expect(piece.lodSphere.spread).toBeCloseTo(2);
  });

  it("refuses members whose layouts don't match", () => {
    const noUv = new BoxGeometry();
    noUv.deleteAttribute("uv");
    expect(
      mergePiece([
        { mesh: box(), local: new Matrix4() },
        { mesh: new Mesh(noUv, new MeshBasicMaterial()), local: new Matrix4() },
      ]),
    ).toBeNull();
  });
});

describe("level of detail for merged pieces", () => {
  it("judges a piece by its largest member at its nearest point", () => {
    // A plain mesh: radius over distance.
    expect(projectedPx(1, 0, 1, 50, 1000)).toBeCloseTo(20);
    // A piece whose members spread 10 units from its centre: as if 10 units closer, so never smaller than any member.
    expect(projectedPx(1, 10, 1, 50, 1000)).toBeCloseTo(25);
    // The camera inside the piece's spread: as close as can be.
    expect(projectedPx(1, 10, 1, 5, 1000)).toBeGreaterThan(1000);
  });
});
