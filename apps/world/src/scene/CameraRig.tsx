import { roomToWorld } from "@ceo/core";
import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { topOf } from "../agents/bodies/Body.tsx";
import { useCast } from "../cast/castStore.ts";
import { agentPositions } from "../clock.ts";
import { PARAMS } from "../params.ts";
import { useWorld } from "../store.ts";

const OVERVIEW = { pos: [0, 66, 96] as const, target: [0, -2, 4] as const };

/** Flies between the overview and each room; drifts slowly around the Lattice when left alone. */
export function CameraRig() {
  const controls = useRef<CameraControls>(null);
  const focus = useWorld((s) => s.focus);
  const studio = useCast((s) => s.studio);
  const lastInput = useRef(performance.now());
  const getThree = useThree((s) => s.get);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const p = studio ? agentPositions.get(studio) : undefined;
    if (studio && p && focus) {
      // A portrait framing for the Agent Studio, from the room's camera side, offset to clear the panel.
      const cam = roomToWorld(focus, 0, 8.5, 16.5);
      const dx = cam[0] - p.x;
      const dz = cam[2] - p.z;
      const len = Math.hypot(dx, dz) || 1;
      // Frame the whole body, however tall it is.
      const look = useCast.getState().cast.profiles[studio]?.look;
      const top = look ? topOf(look, 1.9) : 1.9;
      // Short bodies stand on a platform at their desks; look over the monitors at them.
      const lift = top < 1.35 ? 0.5 : 0;
      const dist = 1.8 + top * 1.4;
      c.minDistance = 1.2;
      void c.setLookAt(
        p.x + (dx / len) * dist,
        p.y + Math.max(top * 0.75 + 0.6, top + lift + 1.5),
        p.z + (dz / len) * dist,
        p.x + (dz / len) * top * 0.45,
        p.y + top * 0.5 + lift,
        p.z - (dx / len) * top * 0.45,
        !PARAMS.instant,
      );
      return;
    }
    if (focus) {
      const pos = roomToWorld(focus, 0, 10.5, 20.5);
      const target = roomToWorld(focus, 0, 0.6, -0.4);
      void c.setLookAt(...pos, ...target, !PARAMS.instant);
      c.minDistance = 6;
      c.maxDistance = 34;
    } else {
      c.minDistance = 20;
      c.maxDistance = 140;
      void c.setLookAt(...OVERVIEW.pos, ...OVERVIEW.target, !PARAMS.instant);
    }
  }, [focus, studio]);

  useEffect(() => {
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.three = getThree;
    api.camera = () => {
      const c = controls.current;
      return c ? { position: c.camera.position.toArray(), distance: c.distance } : null;
    };
  }, [getThree]);

  useEffect(() => {
    const mark = () => (lastInput.current = performance.now());
    window.addEventListener("pointerdown", mark);
    window.addEventListener("wheel", mark);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("wheel", mark);
    };
  }, []);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || focus) return;
    if (performance.now() - lastInput.current > 6000) c.azimuthAngle += dt * 0.025;
  });

  return (
    <CameraControls
      ref={controls}
      makeDefault
      smoothTime={0.9}
      draggingSmoothTime={0.15}
      maxPolarAngle={Math.PI * 0.47}
      minPolarAngle={0.15}
    />
  );
}
