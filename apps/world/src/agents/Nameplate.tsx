import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, type Group } from "three";
import { useWorld } from "../store.ts";
import { taskLine, type TaskIcon } from "./taskLine.ts";

/** Small line icons for the task line, drawn on a 16-unit grid in the agent's colour. */
const ICON: Record<TaskIcon, React.ReactNode> = {
  work: (
    <>
      <path d="M2.5 13.5 8.6 7.4" />
      <path d="m7 5 2.6-2.6 4 4L11 9z" />
    </>
  ),
  write: (
    <>
      <path d="m3 13 .9-3.4 7-7 2.5 2.5-7 7z" />
      <path d="m9.4 4.1 2.5 2.5" />
    </>
  ),
  carry: (
    <>
      <path d="M2.5 5.2 8 2.5l5.5 2.7v5.6L8 13.5l-5.5-2.7z" />
      <path d="M2.5 5.2 8 8l5.5-2.8M8 8v5.5" />
    </>
  ),
  walk: (
    <>
      <path d="M2.5 8h9.5" />
      <path d="M9 4.5 12.5 8 9 11.5" />
    </>
  ),
  wait: (
    <>
      <path d="M4.5 2.5h7M4.5 13.5h7" />
      <path d="M5.5 2.5V4L8 8l2.5-4V2.5M5.5 13.5V12L8 8l2.5 4v1.5" />
    </>
  ),
  rest: (
    <>
      <path d="M3 6.5h8v3.5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" />
      <path d="M11 7.5h1a1.5 1.5 0 0 1 0 3h-1M6 2.5v2M8.5 2.5v2" />
    </>
  ),
  look: (
    <>
      <path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  nap: <path d="M12.8 10.2A5.5 5.5 0 0 1 5.8 3.2a5.5 5.5 0 1 0 7 7z" />,
  stuck: (
    <>
      <path d="M8 2.5 14 13H2z" />
      <path d="M8 6.5v3M8 11.2v.2" />
    </>
  ),
  cheer: <path d="M8 1.8 9.4 6.6 14.2 8 9.4 9.4 8 14.2 6.6 9.4 1.8 8l4.8-1.4z" />,
  music: (
    <>
      <path d="M6 12V3.6l7-1.4v8.3" />
      <circle cx="4.4" cy="12" r="1.6" />
      <circle cx="11.4" cy="10.5" r="1.6" />
    </>
  ),
  game: (
    <>
      <rect x="2.8" y="2.8" width="10.4" height="10.4" rx="2" />
      <path d="M5.6 5.6h.1M10.4 10.4h.1M8 8h.1" />
    </>
  ),
  read: (
    <>
      <path d="M8 4.5C6.6 3.2 4.4 3 2.5 3.4v9c1.9-.4 4.1-.2 5.5 1.1 1.4-1.3 3.6-1.5 5.5-1.1v-9C11.6 3 9.4 3.2 8 4.5z" />
      <path d="M8 4.5v9" />
    </>
  ),
  post: (
    <>
      <rect x="2" y="3.8" width="12" height="8.4" rx="1" />
      <path d="m2.5 4.5 5.5 4.3 5.5-4.3" />
    </>
  ),
};

/** Camera distance (world units) where the task line starts to fade, and where it is gone. The name stays. */
const FADE_FROM = 34;
const FADE_TO = 46;

const at = new Vector3();

/**
 * The plate over an agent in a room: their name, and under it what they are doing right now (a task line with
 * an icon; see taskLine.ts). The task line fades as the camera pulls back so a crowd of plates stays readable.
 */
export function Nameplate({ id, name, accent, y }: { id: string; name: string; accent: string; y: number }) {
  const rt = useWorld((s) => s.lattice.agents[id]);
  const task = useWorld((s) => (rt?.taskId ? s.lattice.tasks[rt.taskId] : undefined));
  const anchor = useRef<Group>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const shown = useRef(-1);

  const line = rt ? taskLine({ activity: rt.activity, place: rt.place, prop: rt.prop, task }) : null;

  useFrame(({ camera }) => {
    const el = lineRef.current;
    if (!el || !anchor.current) return;
    anchor.current.getWorldPosition(at);
    const d = camera.position.distanceTo(at);
    const o = Math.min(1, Math.max(0, (FADE_TO - d) / (FADE_TO - FADE_FROM)));
    const q = Math.round(o * 20) / 20;
    if (q === shown.current) return;
    shown.current = q;
    el.style.opacity = String(q);
    el.style.visibility = q === 0 ? "hidden" : "";
  });

  return (
    <group ref={anchor} position={[0, y, 0]}>
      <Html center distanceFactor={16} zIndexRange={[25, 0]}>
        <div className="nameplate">
          <span style={{ color: accent }}>●</span> {name}
          {line && (
            <div ref={lineRef} className="nameplate__task" data-icon={line.icon}>
              <svg viewBox="0 0 16 16" aria-hidden="true" style={{ color: accent }}>
                {ICON[line.icon]}
              </svg>
              <span>{line.text}</span>
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}
