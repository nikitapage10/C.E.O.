import { roomToWorld } from "@ceo/core";
import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { topOf } from "../agents/bodies/Body.tsx";
import { useCast } from "../cast/castStore.ts";
import { agentPositions } from "../clock.ts";
import { PARAMS } from "../params.ts";
import { useWorld } from "../store.ts";
import { useEyes } from "../eyes/eyes.ts";
import { Vector3 } from "three";

const ahead = new Vector3();

const OVERVIEW = { pos: [0, 66, 96] as const, target: [0, -2, 4] as const };

/** Flies between the overview and each room; drifts slowly around the Lattice when left alone. */
export function CameraRig() {
  const controls = useRef<CameraControls>(null);
  const focus = useWorld((s) => s.focus);
  const studio = useCast((s) => s.studio);
  // Behind Brogu's eyes the camera is his head (eyes/BroguEyes.tsx); the orbit controls step aside until he's let go.
  const eyes = useEyes((s) => s.active);
  const wasEyes = useRef(false);
  const lastInput = useRef(performance.now());
  const getThree = useThree((s) => s.get);

  useEffect(() => {
    const c = controls.current;
    if (eyes) {
      wasEyes.current = true;
      return;
    }
    if (!c) return;
    if (wasEyes.current) {
      // Back out of his eyes: start the flight from where he was looking, not from wherever the controls last were.
      wasEyes.current = false;
      const cam = c.camera;
      cam.getWorldDirection(ahead);
      void c.setLookAt(cam.position.x, cam.position.y, cam.position.z, cam.position.x + ahead.x * 3, cam.position.y + ahead.y * 3, cam.position.z + ahead.z * 3, false);
    }
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
      // Short bodies can be tucked behind desks: look down over the monitors at them.
      const dist = 1.8 + top * 1.4;
      c.minDistance = 1.2;
      void c.setLookAt(
        p.x + (dx / len) * dist,
        p.y + Math.max(top * 0.75 + 0.6, top + 1.5),
        p.z + (dz / len) * dist,
        p.x + (dz / len) * top * 0.45,
        p.y + top * 0.5,
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
  }, [focus, studio, eyes]);

  useEffect(() => {
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.three = getThree;
    api.camera = () => {
      const c = controls.current;
      // Behind Brogu's eyes there are no orbit controls: report the camera itself.
      return c ? { position: c.camera.position.toArray(), distance: c.distance } : { position: getThree().camera.position.toArray(), distance: 0 };
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

  if (eyes) return null;
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
