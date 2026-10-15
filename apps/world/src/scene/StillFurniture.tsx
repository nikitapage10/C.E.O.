import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Matrix4, Mesh, Sphere, type BufferGeometry, type Material, type Object3D } from "three";
import { castsShadow, layerMask } from "./DetailLevels.tsx";
import { MERGED_LAYER, STILL_TAG, mergeBar, mergePiece, mergeable, pieceKey, sphereIn } from "./stillFurniture.ts";

/**
 * Still furniture (#136): each room's walls, floors, shelves and props that never move are baked into a few big
 * meshes as the Lattice loads, so the graphics card draws a room in far fewer calls. The look stays the same: the
 * merged pieces use the same materials and shadow flags, and level of detail treats each one like its largest,
 * nearest member (so a small prop may stay drawn a little longer than it would alone, never shorter).
 *
 * How it goes, per room (the group Rooms.tsx marks with `userData.stillRoot`):
 * - Every second the room is scanned for meshes that may merge (stillFurniture.ts, `mergeable`). One that has kept
 *   the same place, material and geometry for SETTLE_MS joins its piece: the piece is rebuilt with it, and the
 *   original moves to MERGED_LAYER, where no camera draws it (its children, if any, are untouched). Library props
 *   stream in late, so pieces grow as they arrive. A mesh with nothing to merge with draws as itself.
 * - Every frame each member is checked. If it moves, changes material or geometry, hides, or leaves the scene, it is
 *   handed back at once (back on layer 0 with its own shadow flag), its piece is rebuilt without it, and it is never
 *   merged again.
 * - Merged pieces hang in the room's clickable group, so a click on a wall still focuses the room.
 *
 * Opt out with `userData.merge = false` on a mesh or any group above it (DetailLevels.tsx lists it next to
 * `userData.lod`).
 */

const SCAN_MS = 1000;
const SETTLE_MS = 3000;
/** Members baked per frame, about, while rooms fill in (a hand-back rebuilds its piece at once). */
const BAKES_PER_FRAME = 400;

interface Member {
  mesh: Mesh;
  material: Material;
  geometry: BufferGeometry;
  world: Matrix4;
  /** Room-space matrix the piece baked. */
  local: Matrix4;
  cast: boolean;
  key: string;
  /** In a built piece (its original moved to MERGED_LAYER), not just waiting for one. */
  built: boolean;
}

interface Room {
  root: Object3D;
  inverse: Matrix4;
  members: Map<Mesh, Member>;
  pieces: Map<string, Mesh>;
  dirty: Set<string>;
}

interface Candidate {
  world: Matrix4;
  material: Material;
  geometry: BufferGeometry;
  since: number;
  scan: number;
}

const sameMatrix = (a: Matrix4, b: Matrix4) => {
  const x = a.elements;
  const y = b.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(x[i]! - y[i]!) > 1e-6) return false;
  return true;
};

/** Whether a member still draws exactly as it did when it was baked. */
function unchanged(m: Member, root: Object3D): boolean {
  const mesh = m.mesh;
  if (mesh.material !== m.material || mesh.geometry !== m.geometry || m.material.transparent) return false;
  if (m.built && mesh.layers.mask >>> 0 !== layerMask(MERGED_LAYER)) return false;
  if (!sameMatrix(mesh.matrixWorld, m.world)) return false;
  for (let p: Object3D | null = mesh; p !== root; p = p.parent) if (!p || !p.visible) return false;
  return true;
}

function release(m: Member) {
  if (!m.built) return;
  m.mesh.layers.set(0);
  m.mesh.castShadow = m.cast;
}

export function StillFurniture() {
  const scene = useThree((s) => s.scene);
  const rooms = useRef(new Map<Object3D, Room>());
  const candidates = useRef(new Map<Mesh, Candidate>());
  const restless = useRef(new WeakSet<Mesh>());
  const lastScan = useRef(-Infinity);
  const scans = useRef(0);

  const enabled = useRef(true);

  useEffect(() => {
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    const all = rooms.current;
    const cands = candidates.current;
    const undo = () => {
      for (const r of all.values()) {
        for (const m of r.members.values()) release(m);
        for (const p of r.pieces.values()) {
          p.removeFromParent();
          p.geometry.dispose();
        }
      }
      all.clear();
      cands.clear();
    };
    api.still = () => {
      let merged = 0;
      let pieces = 0;
      for (const r of all.values()) {
        for (const m of r.members.values()) if (m.built) merged++;
        pieces += r.pieces.size;
      }
      return { on: enabled.current, rooms: all.size, merged, pieces };
    };
    // Why the rest of each room's meshes stay separate, counted by reason.
    api.stillWhy = () => {
      const why: Record<string, number> = {};
      for (const r of all.values())
        r.root.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh || m.userData[STILL_TAG]) return;
          const member = r.members.get(m);
          const bar = member
            ? member.built
              ? "merged"
              : "alone in its piece"
            : restless.current.has(m)
              ? "moved"
              : (mergeBar(m, r.root) ?? "moving or settling");
          why[bar] = (why[bar] ?? 0) + 1;
        });
      return why;
    };
    // For before/after comparisons: __ceo.stillMerge(false) hands every member back; true merges again.
    api.stillMerge = (on: boolean) => {
      enabled.current = on;
      if (!on) undo();
    };
    return undo;
  }, []);

  /** Rebuilds one piece from its members; returns how many it baked. */
  function rebuild(room: Room, key: string): number {
    const old = room.pieces.get(key);
    if (old) {
      old.removeFromParent();
      old.geometry.dispose();
      room.pieces.delete(key);
    }
    const members: Member[] = [];
    for (const m of room.members.values()) {
      if (m.key !== key) continue;
      // One that changed while it waited for its piece stays out.
      if (m.built || unchanged(m, room.root)) members.push(m);
      else {
        room.members.delete(m.mesh);
        if (m.mesh.parent) restless.current.add(m.mesh);
      }
    }
    if (members.length < 2) {
      // Nothing to merge it with (yet): it draws as itself.
      for (const m of members) {
        release(m);
        m.built = false;
      }
      return 0;
    }
    const piece = mergePiece(members);
    if (!piece) {
      // Didn't fit together after all: hand them back for good.
      for (const m of members) {
        release(m);
        room.members.delete(m.mesh);
        restless.current.add(m.mesh);
      }
      return members.length;
    }
    const first = members[0]!;
    const mesh = new Mesh(piece.geometry, first.material);
    mesh.name = `still-${room.root.userData.stillRoot as string}-${room.pieces.size}`;
    mesh.castShadow = first.cast;
    mesh.receiveShadow = first.mesh.receiveShadow;
    mesh.userData[STILL_TAG] = true;
    mesh.userData.lodSphere = piece.lodSphere;
    mesh.userData.members = members.length;
    room.root.add(mesh);
    mesh.updateMatrixWorld(true);
    room.pieces.set(key, mesh);
    for (const m of members) {
      m.built = true;
      m.mesh.layers.set(MERGED_LAYER);
    }
    return members.length;
  }

  function scan(now: number) {
    const scanNo = ++scans.current;
    const known = rooms.current;
    for (const root of known.keys()) if (!root.parent) known.delete(root);
    scene.traverse((o) => {
      if (typeof o.userData.stillRoot === "string" && !known.has(o)) {
        known.set(o, { root: o, inverse: new Matrix4(), members: new Map(), pieces: new Map(), dirty: new Set() });
      }
    });
    const cands = candidates.current;
    const sphere = new Sphere();
    for (const room of known.values()) {
      room.root.updateWorldMatrix(true, false);
      room.inverse.copy(room.root.matrixWorld).invert();
      room.root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || room.members.has(mesh) || restless.current.has(mesh)) return;
        if (!mergeable(mesh, room.root)) {
          cands.delete(mesh);
          return;
        }
        const c = cands.get(mesh);
        if (!c || c.material !== mesh.material || c.geometry !== mesh.geometry || !sameMatrix(c.world, mesh.matrixWorld)) {
          cands.set(mesh, {
            world: mesh.matrixWorld.clone(),
            material: mesh.material as Material,
            geometry: mesh.geometry,
            since: now,
            scan: scanNo,
          });
          return;
        }
        c.scan = scanNo;
        if (now - c.since < SETTLE_MS) return;
        cands.delete(mesh);
        const cast = castsShadow(mesh);
        const key = pieceKey(mesh, cast, sphereIn(mesh, room.inverse, sphere).radius);
        room.members.set(mesh, {
          mesh,
          material: c.material,
          geometry: c.geometry,
          world: c.world,
          local: new Matrix4().multiplyMatrices(room.inverse, c.world),
          cast,
          key,
          built: false,
        });
        room.dirty.add(key);
      });
    }
    for (const [mesh, c] of cands) if (c.scan !== scanNo) cands.delete(mesh);
  }

  useFrame(() => {
    // Hand back anything that changed since it was baked, and rebuild its piece now, so it never shows twice.
    for (const room of rooms.current.values()) {
      let changed: Set<string> | null = null;
      for (const m of room.members.values()) {
        if (unchanged(m, room.root)) continue;
        release(m);
        room.members.delete(m.mesh);
        if (m.mesh.parent) restless.current.add(m.mesh);
        (changed ??= new Set()).add(m.key);
      }
      if (changed) for (const key of changed) rebuild(room, key);
    }

    const now = performance.now();
    if (enabled.current && now - lastScan.current > SCAN_MS) {
      lastScan.current = now;
      scan(now);
    }

    let budget = BAKES_PER_FRAME;
    for (const room of rooms.current.values()) {
      for (const key of room.dirty) {
        if (budget <= 0) return;
        room.dirty.delete(key);
        budget -= rebuild(room, key);
      }
    }
  });

  return null;
}
