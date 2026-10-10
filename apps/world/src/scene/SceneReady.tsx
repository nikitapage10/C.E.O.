import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { useBoot } from "../boot.ts";

/**
 * Mounts once everything inside the scene's Suspense has loaded. Compiles every shader up front, so the
 * first look around doesn't stutter or pop, then lets a few frames render before declaring the world ready.
 */
export function SceneReady() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let cancelled = false;
    const timeout = new Promise((r) => setTimeout(r, 8000));
    const compile = gl.compileAsync ? gl.compileAsync(scene, camera).catch(() => undefined) : Promise.resolve();
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
