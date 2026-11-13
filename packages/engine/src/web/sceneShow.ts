import type { Light, Object3D } from "three";

/**
 * Showing and hiding part of a 3D scene without a stall. Setting `visible = false` on a group also drops every light
 * inside it from the frame, so the scene's light count changes and three recompiles every lit material: a one-to-two
 * second freeze each time (the Senate's pods, #1110; the Exchange's "soon" posts). `showParts` hides the group's
 * meshes by their render layers instead, and dims its lights to nothing, so the light count never moves.
 *
 * Read the state back with `isShown`, not `visible`, which stays true.
 */
interface Kept {
  mask?: number;
  lit?: number;
}

const kept = (o: Object3D) => o.userData as Kept & { shown?: boolean };

export function showParts(root: Object3D, on: boolean): void {
  const u = kept(root);
  if ((u.shown ?? true) === on) return;
  u.shown = on;
  root.traverse((o) => {
    const k = kept(o);
    if ((o as Light).isLight) {
      const l = o as Light;
      if (on) {
        l.intensity = k.lit ?? l.intensity;
        delete k.lit;
      } else {
        k.lit = l.intensity;
        l.intensity = 0;
      }
      return;
    }
    if (on) {
      if (k.mask !== undefined) o.layers.mask = k.mask;
      delete k.mask;
    } else {
      k.mask = o.layers.mask;
      o.layers.disableAll();
    }
  });
}

/** Whether `showParts` last left `root` shown (true when it never touched it). */
export function isShown(root: Object3D): boolean {
  return kept(root).shown ?? true;
}
