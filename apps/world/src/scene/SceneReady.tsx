import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { markBoot, useBoot } from "../boot.ts";
import { compileScene } from "../fx/compile.ts";

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
    // The canvas doesn't draw until this resolves (boot.ts, drawing): a frame drawn before a program has linked stops
    // and waits for it, one program at a time, where compileAsync lets the browser link them all at once on its own
    // threads (#327). The cap only guards against a driver that never reports back.
    const timeout = new Promise((r) => setTimeout(r, 30000));
    // Everything, hidden things included (dice before a roll, lasers before a set, the club's show): anything
    // compiled later stalls the frame it first appears in. fx/compile.ts keeps the page moving while it runs.
    const compile = compileScene(gl, scene, camera, scene);
    void Promise.race([compile, timeout]).then(() => {
      if (cancelled) return;
      markBoot("compiled");
      useBoot.getState().startDrawing();
      // A handful of real frames, on a timer so a busy main thread can't stall it forever.
      setTimeout(() => !cancelled && useBoot.getState().setSceneReady(), 450);
    });
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera]);
  return null;
}
