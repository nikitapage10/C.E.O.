import { BufferAttribute, BufferGeometry, Material, Matrix4, Object3D, Sphere, Vector3, type Mesh } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DETAIL_LAYER, HIDDEN_LAYER, layerMask } from "./DetailLevels.tsx";

/**
 * Still furniture (#136): the rules for baking a room's meshes that never move into a few big ones. StillFurniture.tsx
 * runs them as the Lattice loads; this file is the part that can be tested without a renderer.
 *
 * A mesh can be merged when it is a plain, opaque mesh drawn the ordinary way, inside a room, with no event handler
 * on it or between it and the room (those must stay pickable on their own), and nothing on it or above it set to
 * `userData.merge = false` (characters and anything else that must stay separate). Meshes that turn out to move,
 * change material or hide later are handed back by StillFurniture.tsx and never merged again.
 *
 * Members merge by material, shadow flags and vertex layout, and by size (bands a doubling of radius apart), so each
 * merged piece holds similar-sized things from across one room. Level of detail then treats a piece as its largest
 * member at its nearest point (DetailLevels.tsx, `userData.lodSphere`): a piece is drawn, casts a shadow and shows in the
 * floor mirror whenever one of its members would on its own.
 */

/** The layer a merged mesh's original moves to: seen by no camera, and left alone by level of detail. */
export const MERGED_LAYER = 30;

/** Merged pieces carry this on userData; the scan skips them. */
export const STILL_TAG = "still";

const LOD_MASKS = new Set([layerMask(0), layerMask(DETAIL_LAYER), layerMask(HIDDEN_LAYER)]);
const plainBeforeRender = Object3D.prototype.onBeforeRender;
const plainAfterRender = Object3D.prototype.onAfterRender;
const plainCompile = Material.prototype.onBeforeCompile;

type R3F = { __r3f?: { eventCount?: number } };
const hasHandlers = (o: Object3D) => ((o as R3F).__r3f?.eventCount ?? 0) > 0;

/** Why this geometry can't be drawn as part of a merge (null when it can): it must be whole, not instanced, no morphs. */
function geometryBar(g: BufferGeometry | undefined): string | null {
  if (!g?.isBufferGeometry || (g as { isInstancedBufferGeometry?: boolean }).isInstancedBufferGeometry) return "instanced geometry";
  const pos = g.attributes.position;
  if (!pos || pos.count === 0) return "empty";
  if (Object.keys(g.morphAttributes).length) return "morphs";
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return "draw range";
  if (g.groups.length) {
    // A single-material mesh with groups draws each group: merge only when they cover the whole thing, once.
    const total = g.index ? g.index.count : pos.count;
    const sorted = [...g.groups].sort((a, b) => a.start - b.start);
    let at = 0;
    for (const grp of sorted) {
      if (grp.start !== at) return "partial groups";
      at += grp.count;
    }
    if (at !== total) return "partial groups";
  }
  return null;
}

/** Why a material can't be shared by a merged piece (null when it can): opaque, built in, its shader not customised. */
function materialBar(m: Material | Material[]): string | null {
  if (Array.isArray(m)) return "several materials";
  if (!m?.isMaterial) return "no material";
  if (m.transparent) return "transparent";
  if (!m.visible) return "invisible material";
  if ((m as { isShaderMaterial?: boolean }).isShaderMaterial) return "shader material";
  if (m.onBeforeCompile !== plainCompile) return "customised shader";
  if (((m as { transmission?: number }).transmission ?? 0) > 0) return "transmission";
  return null;
}

/**
 * Why `o` can't be baked into `root`'s merged pieces, or null when it can, judged by what it is and where it hangs
 * (not yet whether it stays still: StillFurniture.tsx watches that).
 */
export function mergeBar(o: Object3D, root: Object3D): string | null {
  const m = o as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean; isBatchedMesh?: boolean };
  if (!m.isMesh) return "not a mesh";
  if (m.isSkinnedMesh) return "skinned";
  if (m.isInstancedMesh || m.isBatchedMesh) return "instanced";
  if (m.userData[STILL_TAG]) return "merged piece";
  if (m.userData.lod === false) return "lod off";
  if (!LOD_MASKS.has(m.layers.mask >>> 0)) return "own layer";
  if (m.morphTargetInfluences?.length) return "morphs";
  if (m.renderOrder !== 0) return "render order";
  if (!m.frustumCulled) return "not frustum culled";
  if (m.onBeforeRender !== plainBeforeRender || m.onAfterRender !== plainAfterRender) return "render hook";
  if (m.customDepthMaterial || m.customDistanceMaterial) return "custom depth";
  const bar = materialBar(m.material) ?? geometryBar(m.geometry);
  if (bar) return bar;
  // Mirrored meshes would come out inside out; one not placed anywhere yet (NaN in its matrix, a scale still being
  // worked out) would poison its whole piece's bounds.
  const det = m.matrixWorld.determinant();
  if (Number.isNaN(det)) return "not placed";
  if (det <= 0) return "mirrored";
  // Inside the room, visible, with no handler or opt-out on the way up.
  for (let p: Object3D | null = m; p !== root; p = p.parent) {
    if (!p) return "outside the room";
    // A part that moves as one (a podium) is a root of its own: it merges there, riding along (#373).
    if (typeof p.userData.stillRoot === "string") return "own root";
    if (!p.visible) return "hidden";
    if (p.userData.merge === false) return "opted out";
    if (hasHandlers(p)) return "pickable";
  }
  return null;
}

/** Whether `o` can be baked into `root`'s merged pieces (see mergeBar). */
export const mergeable = (o: Object3D, root: Object3D): o is Mesh => mergeBar(o, root) === null;

/** A mesh's bounding sphere in `root`'s space: centre and radius. */
export function sphereIn(m: Mesh, rootInverse: Matrix4, out = new Sphere()): Sphere {
  const g = m.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return out.copy(g.boundingSphere!).applyMatrix4(new Matrix4().multiplyMatrices(rootInverse, m.matrixWorld));
}

/** The layout of a geometry's vertices, which must match to merge. */
export function layoutOf(g: BufferGeometry): string {
  return Object.keys(g.attributes)
    .sort()
    .map((k) => `${k}${g.attributes[k]!.itemSize}`)
    .join(",");
}

/**
 * Which merged piece of its room a member goes in: same material, shadow flags and vertex layout, and the same size
 * band (each a doubling of `radius`, its bounding radius in room space), so level of detail, which judges a piece by
 * its largest member, never keeps a small prop on for much smaller than it would on its own.
 */
export function pieceKey(m: Mesh, cast: boolean, radius: number): string {
  const mat = m.material as Material;
  const band = Math.max(-6, Math.floor(Math.log2(Math.max(radius, 1e-3))));
  return `${mat.uuid}|${cast ? 1 : 0}${m.receiveShadow ? 1 : 0}|${layoutOf(m.geometry)}|b${band}`;
}

/** A copy of `g` in plain float attributes, indexed, with `matrix` baked in. */
export function baked(g: BufferGeometry, matrix: Matrix4): BufferGeometry {
  const out = new BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const n = attr.count;
    const s = attr.itemSize;
    const arr = new Float32Array(n * s);
    for (let i = 0; i < n; i++) {
      const o = i * s;
      arr[o] = attr.getX(i);
      if (s > 1) arr[o + 1] = attr.getY(i);
      if (s > 2) arr[o + 2] = attr.getZ(i);
      if (s > 3) arr[o + 3] = attr.getW(i);
    }
    out.setAttribute(name, new BufferAttribute(arr, s));
  }
  const count = g.attributes.position!.count;
  const index = new Uint32Array(g.index ? g.index.count : count);
  if (g.index) for (let i = 0; i < index.length; i++) index[i] = g.index.getX(i);
  else for (let i = 0; i < count; i++) index[i] = i;
  out.setIndex(new BufferAttribute(index, 1));
  out.applyMatrix4(matrix);
  return out;
}

export interface Piece {
  geometry: BufferGeometry;
  /** For level of detail: the largest member's radius, and how far members' centres sit from the piece's centre. */
  lodSphere: { radius: number; spread: number };
}

/** Merges members (mesh plus its matrix in room space) into one geometry; null when they don't fit together. */
export function mergePiece(members: readonly { mesh: Mesh; local: Matrix4 }[]): Piece | null {
  const parts = members.map(({ mesh, local }) => baked(mesh.geometry, local));
  const geometry = parts.length === 1 ? parts[0]! : mergeGeometries(parts, false);
  if (parts.length > 1) parts.forEach((p) => p.dispose());
  if (!geometry) return null;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  const centre = geometry.boundingSphere!.center;
  let radius = 0;
  let spread = 0;
  const s = new Sphere();
  const c = new Vector3();
  for (const { mesh, local } of members) {
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    s.copy(mesh.geometry.boundingSphere!).applyMatrix4(local);
    radius = Math.max(radius, s.radius);
    spread = Math.max(spread, c.copy(s.center).distanceTo(centre));
  }
  return { geometry, lodSphere: { radius, spread } };
}
