import { useThree } from "@react-three/fiber";
import { Suspense, useLayoutEffect, useRef, type ReactNode } from "react";
import type { Group } from "three";
import { compileScene, warming } from "./compile.ts";

/**
 * Streamed-in models arrive with materials the graphics card hasn't compiled yet. Drawn straight away, each new
 * shader program is compiled and linked in the middle of a frame, and the browser waits for it there: on Windows
 * (ANGLE on Direct3D) that is a tenth of a second or more per program, and the Lattice has about 170 of them, which
 * is most of the 30 to 50 seconds "Enter the Lattice" used to take (#327).
 *
 * Warm holds what it wraps out of sight until its shaders are compiled (fx/compile.ts: on the browser's own threads
 * where it can, while frames keep drawing), then shows it. It shows it
 * anyway after WARM_MS, so nothing can stay hidden.
 */
const WARM_MS = 4000;

export function Warm({ children }: { children: ReactNode }) {
  const group = useRef<Group>(null);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      g.visible = true;
    };
    g.visible = false;
    let pending = true;
    warming.count += 1;
    const settle = () => {
      if (!pending) return;
      pending = false;
      warming.count -= 1;
    };
    const compiled = compileScene(gl, g, camera, scene);
    void compiled.then(() => {
      settle();
      show();
    });
    const t = setTimeout(show, WARM_MS);
    return () => {
      done = true;
      settle();
      clearTimeout(t);
    };
  }, [gl, scene, camera]);
  return (
    <group ref={group}>
      {children}
    </group>
  );
}

/** A streamed part of the scene: it loads on its own (the rest doesn't wait for it) and shows once it's compiled. */
export function StreamIn({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <Warm>{children}</Warm>
    </Suspense>
  );
}
