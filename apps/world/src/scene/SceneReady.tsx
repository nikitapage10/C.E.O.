import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { Object3D } from "three";
import { useBoot } from "../boot.ts";

/**
 * Mounts once everything inside the scene's Suspense has loaded. Compiles every shader up front, hidden things
 * included, so the first look around (or the first gathering) doesn't stutter or pop, then lets a few frames render before declaring the world ready.
 */
export function SceneReady() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let cancelled = false;
    const timeout = new Promise((r) => setTimeout(r, 8000));
    // Include what's hidden right now (dice before a roll, lasers before a set, the club's show): compile only
    // walks visible objects, and anything compiled later stalls the frame it first appears in.
    const hidden: Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const compile = gl.compileAsync ? gl.compileAsync(scene, camera).catch(() => undefined) : Promise.resolve();
    // compileAsync gathers its materials synchronously, so they can go back out of sight straight away.
    for (const o of hidden) o.visible = false;
    void Promise.race([compile, timeout]).then(() => {
      // A handful of real frames, on a timer so a busy main thread can't stall it forever.
      setTimeout(() => !cancelled && useBoot.getState().setSceneReady(), 450);
    });
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera]);
  return null;
}
