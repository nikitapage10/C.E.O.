import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { DirectionalLight, MathUtils, Matrix4, Mesh, Vector3, type Object3D } from "three";
import { roomCenter } from "@ceo/core";
import { useWorld } from "../store.ts";

/**
 * Level of detail, the way games do it: the world is drawn in full where the camera is looking closely, and
 * gets cheaper as it zooms out.
 *
 * - Small-feature culling. Every few frames each mesh's size on screen is estimated from its bounding sphere.
 *   Anything only a couple of pixels across is moved to a hidden layer (no draw, no shadow, no clicks), and
 *   small things stop casting shadows. Close up, a room keeps every prop; from the overview the trims, buttons,
 *   books and name plates drop out.
 * - The floor mirror only reflects the larger shapes: small meshes live on DETAIL, which the main camera and
 *   the raycaster see but the reflector's camera (layer 0 only) does not.
 * - Far rooms trim harder while the camera is inside a room. With a room in focus, anything more than FAR_FROM
 *   units from the camera and outside the viewed room drops out below a larger size (FAR_HIDE_PX): the next
 *   rooms' small props, which are only a few pixels at the edge of the frame. The viewed room keeps the normal
 *   cut-off, so its picture doesn't change.
 * - Shadows follow the camera: the key light's shadow map covers what the camera is looking at, sized to the
 *   zoom, so a single room gets a tight, sharp shadow map and the rooms behind it cast nothing.
 * - Merged still furniture (StillFurniture.tsx, #136) counts as its largest member at its nearest point: a merged
 *   piece carries `userData.lodSphere` (that member's radius, and how far members sit from the piece's centre), so
 *   it is drawn, casts a shadow and shows in the mirror whenever one of its members would on its own.
 *
 * Nothing here touches `visible`, so components that animate visibility keep working.
 *
 * Flags on a mesh's userData:
 * - `lod = false`: level of detail leaves it alone; it always shows (and it is never merged).
 * - `merge = false`: never baked into a room's merged still furniture (StillFurniture.tsx). Set it on a group and it
 *   covers everything inside: characters' bodies carry it. Moving, hoverable, clickable, transparent, skinned and
 *   morphing meshes are kept separate without it.
 *
 * Layers 1 (DETAIL_LAYER), 30 (MERGED_LAYER, stillFurniture.ts: originals of merged meshes) and 31 (HIDDEN_LAYER) are
 * reserved. Compare masks with `layerMask()`.
 */

/** Visible to the main camera, raycaster and shadows, but not to the floor reflection. */
export const DETAIL_LAYER = 1;
/** Seen by no camera: culled from drawing, shadows, reflections and picking. */
export const HIDDEN_LAYER = 31;

/** Projected radius, in CSS pixels, below which a mesh is not drawn / casts no shadow / stays out of the mirror. */
const HIDE_PX = { high: 1.5, low: 2.5 };
const SHADOW_PX = { high: 5, low: 9 };
const REFLECT_PX = 14;
/** In a room: beyond this distance from the camera, and outside the viewed room, small meshes go sooner. */
const FAR_FROM = 40;
const FAR_HIDE_PX = { high: 4, low: 6 };
/** Horizontal radius around the viewed room's centre that always keeps the normal cut-off (rooms are 16 x 13). */
const ROOM_KEEP = 13;
/** Hysteresis so meshes near a threshold don't flicker as the camera drifts. */
const BAND = 1.25;

const RESCAN_MS = 1500;
const UPDATE_EVERY = 3;

type Tracked = {
  mesh: Mesh;
  radius: number;
  /** Merged pieces: how far their members sit from the centre (0 for a plain mesh). */
  spread: number;
  center: Vector3;
  castShadow: boolean;
  hidden: boolean;
  shadowOff: boolean;
};

const tmp = new Vector3();

/** Each tracked mesh's own shadow flag, which level of detail may have switched off for now. */
const ownShadow = new WeakMap<Mesh, boolean>();
/** Whether a mesh casts a shadow when level of detail isn't trimming it. */
export const castsShadow = (m: Mesh) => ownShadow.get(m) ?? m.castShadow;

/**
 * Projected radius (CSS px) a tracked mesh is judged by. A merged piece (`lodSphere`) counts as its largest member
 * at the piece's nearest point, so it shows whenever one of its members would.
 */
export function projectedPx(radius: number, spread: number, scale: number, d: number, pxPerUnit: number): number {
  return ((radius * scale) / Math.max(0.01, d - spread * scale)) * pxPerUnit;
}

/**
 * The size (projected radius, CSS px) below which a mesh at world (x, z), `d` units from the camera, is hidden.
 * `room` is the centre of the room in focus, or null on the overview.
 */
export function hideCutoff(quality: "high" | "low", room: readonly number[] | null, x: number, z: number, d: number): number {
  const far = room !== null && d > FAR_FROM && Math.hypot(x - room[0]!, z - room[2]!) > ROOM_KEEP;
  return far ? FAR_HIDE_PX[quality] : HIDE_PX[quality];
}

/**
 * A layer's mask as three.js stores it: unsigned. (`1 << 31` alone is negative in JavaScript, so it never equals the
 * mask `layers.set(31)` leaves behind; comparing against it stopped tracking every mesh the moment it was hidden, and
 * the mesh stayed hidden for good. That is how Gary and his bucket vanished from the Boiler Room, #111.)
 */
export const layerMask = (layer: number) => (1 << layer) >>> 0;
const OUR_MASKS = new Set([layerMask(0), layerMask(DETAIL_LAYER), layerMask(HIDDEN_LAYER)]);

/** Whether level of detail manages this mesh: a plain mesh on the default layer, or one this module moved. */
export function trackable(o: Object3D): o is Mesh {
  const m = o as Mesh;
  if (!m.isMesh || (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh) return false;
  if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) return false;
  if (m.userData.lod === false) return false;
  // Only meshes on the default layer (or the two this module moves them to): anything placed on another layer on
  // purpose is left alone.
  return OUR_MASKS.has(m.layers.mask >>> 0);
}

/** Stops tracking a mesh, with its own shadow flag back. Its layer is left as is: whoever took it sets that. */
function untrack(map: Map<Mesh, Tracked>, t: Tracked) {
  t.mesh.castShadow = t.castShadow;
  ownShadow.delete(t.mesh);
  map.delete(t.mesh);
}

export function DetailLevels() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const raycaster = useThree((s) => s.raycaster);
  const tracked = useRef(new Map<Mesh, Tracked>());
  const lastScan = useRef(-Infinity);
  const frame = useRef(0);

  useEffect(() => {
    camera.layers.enable(DETAIL_LAYER);
    raycaster.layers.enable(DETAIL_LAYER);
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.detail = () => {
      let hidden = 0;
      let shadowOff = 0;
      for (const t of tracked.current.values()) {
        if (t.hidden) hidden++;
        if (t.shadowOff) shadowOff++;
      }
      return { tracked: tracked.current.size, hidden, shadowOff };
    };
    const restore = tracked.current;
    return () => {
      for (const t of restore.values()) {
        t.mesh.layers.set(0);
        t.mesh.castShadow = t.castShadow;
      }
      restore.clear();
    };
  }, [camera, raycaster]);

  useFrame(({ size }) => {
    const now = performance.now();
    const map = tracked.current;

    if (now - lastScan.current > RESCAN_MS) {
      lastScan.current = now;
      const seen = new Set<Mesh>();
      scene.traverse((o) => {
        if (!trackable(o)) return;
        seen.add(o);
        if (map.has(o)) return;
        const geo = o.geometry;
        if (!geo) return;
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        const bs = geo.boundingSphere;
        if (!bs || !Number.isFinite(bs.radius)) return;
        const lod = o.userData.lodSphere as { radius: number; spread: number } | undefined;
        ownShadow.set(o, o.castShadow);
        map.set(o, {
          mesh: o,
          radius: lod?.radius ?? bs.radius,
          spread: lod?.spread ?? 0,
          center: bs.center.clone(),
          castShadow: o.castShadow,
          hidden: false,
          shadowOff: false,
        });
      });
      for (const t of map.values()) if (!seen.has(t.mesh)) untrack(map, t);
    }

    if (frame.current++ % UPDATE_EVERY) return;
    const { quality, focus } = useWorld.getState();
    const fov = (camera as { fov?: number }).fov ?? 38;
    // CSS pixels per world unit at distance 1.
    const pxPerUnit = size.height / 2 / Math.tan(MathUtils.degToRad(fov) / 2);
    const shadowPx = SHADOW_PX[quality];
    const room = focus ? roomCenter(focus) : null;

    for (const t of map.values()) {
      const m = t.mesh;
      // Moved off our layers since the last scan (merged into still furniture): hand it back as it was.
      if (!trackable(m)) {
        untrack(map, t);
        continue;
      }
      tmp.copy(t.center).applyMatrix4(m.matrixWorld);
      const d = Math.max(0.01, tmp.distanceTo(camera.position));
      const px = projectedPx(t.radius, t.spread, m.matrixWorld.getMaxScaleOnAxis(), d, pxPerUnit);

      const cut = hideCutoff(quality, room, tmp.x, tmp.z, d);
      t.hidden = px < (t.hidden ? cut * BAND : cut);
      t.shadowOff = px < (t.shadowOff ? shadowPx * BAND : shadowPx);
      m.layers.set(t.hidden ? HIDDEN_LAYER : px < REFLECT_PX ? DETAIL_LAYER : 0);
      m.castShadow = t.castShadow && !t.shadowOff;
    }
  });

  return null;
}

function findKeyLight(scene: Object3D): DirectionalLight | null {
  const found: DirectionalLight[] = [];
  scene.traverse((o) => {
    if ((o as DirectionalLight).isDirectionalLight && o.castShadow) found.push(o as DirectionalLight);
  });
  return found[0] ?? null;
}

/** Fits the key light's shadow map to what the camera is looking at, tighter as it zooms in. */
export function ShadowFocus() {
  const scene = useThree((s) => s.scene);
  const light = useRef<DirectionalLight | null>(null);
  const center = useRef(new Vector3());
  const half = useRef(50);
  const view = useRef(new Matrix4());

  useFrame(({ camera, controls }, dt) => {
    if (!light.current?.parent) {
      light.current = findKeyLight(scene);
      if (!light.current) return;
      const cam = light.current.shadow.camera;
      half.current = (cam.right - cam.left) / 2;
    }
    const l = light.current;

    // Where the camera is looking and how far away it is.
    // With no orbit controls (behind Brogu's eyes), a few metres ahead of the camera.
    const target =
      (controls as { getTarget?: (out: Vector3) => Vector3 } | null)?.getTarget?.(tmp) ??
      camera.getWorldDirection(tmp).multiplyScalar(5).add(camera.position);
    const distance = camera.position.distanceTo(target);
    const k = 1 - Math.exp(-dt * 4);
    center.current.lerp(target, k);
    half.current += (MathUtils.clamp(distance * 0.55, 14, 50) - half.current) * k;

    // Shift the shadow frustum's window, in the light's own view space, onto that point. The light itself is not
    // moved, so anything that animates it (time of day) keeps working.
    l.shadow.updateMatrices(l);
    const p = tmp.copy(center.current).applyMatrix4(view.current.copy(l.shadow.camera.matrixWorldInverse));
    const cam = l.shadow.camera;
    const h = half.current;
    cam.left = p.x - h;
    cam.right = p.x + h;
    cam.bottom = p.y - h;
    cam.top = p.y + h;
    cam.updateProjectionMatrix();
  });

  return null;
}
