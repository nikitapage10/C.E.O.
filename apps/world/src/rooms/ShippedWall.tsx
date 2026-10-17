import { FOUNDRY_FLOOR } from "@ceo/core";
import { Html, Text } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { MeshStandardMaterial, Vector3 } from "three";
import { PBR } from "../fx/pbr.ts";
import { CREW, plaqueTitle, shippedThisWeek, type Change } from "../foundry.ts";
import { useFoundry } from "../foundry.ts";
import { useWorld } from "../store.ts";
import { Block, FONTS } from "./primitives.tsx";

const WALL = FOUNDRY_FLOOR.shippedWall;
/** The board's size, and where its plaques hang (wall-local, from the floor up). */
const BOARD = { w: 1.3, h: 1.66, y: 0.25 };
const PLAQUE = { w: 1.18, h: 0.118, pitch: 0.15 };
/** The first plaque's middle: under the brass header. */
const TOP_ROW = BOARD.y + BOARD.h - 0.33;
const FONT = 0.058;
/**
 * Level of detail measures a mesh once, when it first sees it (scene/DetailLevels.tsx), and troika's text has no size
 * until its glyphs are laid out, so it would be judged a speck and hidden for good: the engravings opt out.
 */
const TEXT_LOD = { lod: false };
const ENGRAVED = "#2a1d0c";

let brass: MeshStandardMaterial | null = null;
/** Polished brass with a little warmth of its own, so the plaques read in the hall's half light. Shared by every plaque. */
const plaqueBrass = () =>
  (brass ??= new MeshStandardMaterial({ color: "#d4ab62", metalness: 0.85, roughness: 0.32, emissive: "#7a5418", emissiveIntensity: 0.55 }));

const rowY = (i: number) => TOP_ROW - i * PLAQUE.pitch;
const DAY_MS = 24 * 60 * 60 * 1000;
const day = (at: number, now: number) => (now - at < DAY_MS && new Date(at).getDate() === new Date(now).getDate() ? "Today" : new Date(at).toLocaleDateString(undefined, { weekday: "short" }));

/** A plaque's card: the change, when it shipped, who built it, and links to its pull request and issue. */
function PlaqueCard({ change, onClose }: { change: Change; onClose: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const when = new Date(change.at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  return (
    <div style={{ position: "relative" }}>
      <div className="taskcard" role="dialog" aria-label={`Shipped: ${change.title}`} onPointerDown={stop} onClick={stop} style={{ borderTopColor: "#d4ab62" }}>
        <div className="taskcard__body" style={{ borderTopColor: "#d4ab62" }}>
          <div className="taskcard__head">
            <span className="taskcard__num" style={{ color: "#d4ab62" }}>
              {change.issue ? `#${change.issue.number}` : (change.landed?.label ?? "Shipped")}
            </span>
            <span className="taskcard__status">Shipped · {when}</span>
          </div>
          <div className="taskcard__title">{change.title.trim()}</div>
          <div className="taskcard__foot">
            <span>{change.by ? CREW[change.by].name : change.kind}</span>
            <span style={{ display: "flex", gap: 10 }}>
              {change.landed && (
                <a href={change.landed.url} target="_blank" rel="noreferrer" onClick={stop}>
                  {change.landed.label} ↗
                </a>
              )}
              {change.issue && (
                <a href={change.issue.url} target="_blank" rel="noreferrer" onClick={stop}>
                  Issue ↗
                </a>
              )}
              <a href="#" onClick={(e) => (e.preventDefault(), e.stopPropagation(), onClose())} aria-label="Close">
                ✕
              </a>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

const local = new Vector3();

/**
 * The shipped wall (#182), beside Rusty's idea board: a brass plaque for each change shipped this week, newest on
 * top, from the same live Changelog the Desk reads (titles only). The board and plaques are plain still furniture;
 * one unseen pane over the plaques takes the clicks, and a click opens that change's card, like a pet's or an agent's.
 */
export function ShippedWall() {
  const changelog = useFoundry((s) => s.data.changelog);
  const connected = useFoundry((s) => s.connected);
  const focused = useWorld((s) => s.focus === "foundry");
  // The week rolls over slowly: the hour is plenty fine for which plaques hang.
  const [hour, setHour] = useState(() => Math.floor(Date.now() / 3_600_000));
  useEffect(() => {
    const t = window.setInterval(() => setHour(Math.floor(Date.now() / 3_600_000)), 600_000);
    return () => clearInterval(t);
  }, []);
  const { plaques, more } = useMemo(() => shippedThisWeek(changelog, (hour + 1) * 3_600_000), [changelog, hour]);
  const titles = useMemo(() => plaques.map((c) => plaqueTitle(c.title, 28)).join("\n"), [plaques]);
  const days = useMemo(() => plaques.map((c) => day(c.at, Date.now())).join("\n"), [plaques]);
  const [open, setOpen] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const opened = focused ? plaques.findIndex((c) => c.key === open) : -1;
  useEffect(() => {
    if (!focused) setOpen(null);
  }, [focused]);

  const rowAt = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    e.object.parent!.worldToLocal(local.copy(e.point));
    const i = Math.round((TOP_ROW - local.y) / PLAQUE.pitch);
    return i >= 0 && i < plaques.length && Math.abs(local.x) <= PLAQUE.w / 2 ? i : null;
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!focused) return;
    const i = rowAt(e);
    if (i !== hover) setHover(i);
    document.body.style.cursor = i === null ? "" : "pointer";
  };
  const out = () => {
    setHover(null);
    document.body.style.cursor = "";
  };
  const click = (e: ThreeEvent<MouseEvent>) => {
    // Out of the room, a click focuses it, the way any click on the room does.
    if (!focused) return;
    const i = rowAt(e);
    if (i === null) return;
    e.stopPropagation();
    const key = plaques[i]!.key;
    setOpen((o) => (o === key ? null : key));
  };

  const rail = PBR.blackMetal();
  return (
    <group position={[WALL.x, 0, WALL.z]} name="shipped-wall">
      {/* Two blackened-steel legs on feet, and the walnut board between them in a steel frame. */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <Block size={[0.06, BOARD.y + BOARD.h + 0.04, 0.06]} position={[s * (BOARD.w / 2 + 0.03), (BOARD.y + BOARD.h + 0.04) / 2, -0.03]} material={rail} radius={0.01} />
          <Block size={[0.12, 0.04, 0.32]} position={[s * (BOARD.w / 2 + 0.03), 0.02, -0.03]} material={rail} radius={0.01} />
        </group>
      ))}
      <Block size={[BOARD.w, BOARD.h, 0.05]} position={[0, BOARD.y + BOARD.h / 2, -0.03]} material={PBR.wood("walnut")} radius={0.015} />
      <Block size={[BOARD.w + 0.04, 0.04, 0.07]} position={[0, BOARD.y + BOARD.h, -0.03]} material={rail} radius={0.01} shadows={false} />
      <Block size={[BOARD.w + 0.04, 0.04, 0.07]} position={[0, BOARD.y, -0.03]} material={rail} radius={0.01} shadows={false} />
      {/* The header: a brass strip with the wall's name engraved. */}
      <Block size={[0.92, 0.13, 0.014]} position={[0, BOARD.y + BOARD.h - 0.12, 0]} material={plaqueBrass()} radius={0.004} shadows={false} />
      <Text userData={TEXT_LOD} font={FONTS.mono} fontSize={0.06} letterSpacing={0.14} position={[0, BOARD.y + BOARD.h - 0.12, 0.009]} color={ENGRAVED} anchorX="center" anchorY="middle">
        SHIPPED THIS WEEK
      </Text>
      {/* One plaque per change, newest on top. */}
      {plaques.map((c, i) => (
        <Block key={c.key} size={[PLAQUE.w, PLAQUE.h, 0.012]} position={[0, rowY(i), 0]} material={plaqueBrass()} radius={0.004} shadows={false} />
      ))}
      {plaques.length > 0 && (
        <>
          <Text userData={TEXT_LOD} font={FONTS.mono} fontSize={FONT} lineHeight={PLAQUE.pitch / FONT} position={[-PLAQUE.w / 2 + 0.04, TOP_ROW + PLAQUE.pitch / 2, 0.009]} color={ENGRAVED} anchorX="left" anchorY="top" whiteSpace="nowrap">
            {titles}
          </Text>
          <Text userData={TEXT_LOD} font={FONTS.mono} fontSize={FONT * 0.72} lineHeight={PLAQUE.pitch / (FONT * 0.72)} position={[PLAQUE.w / 2 - 0.04, TOP_ROW + PLAQUE.pitch / 2, 0.009]} color="#5a4220" anchorX="right" anchorY="top" whiteSpace="nowrap">
            {days}
          </Text>
        </>
      )}
      {/* Below the plaques: how many more shipped than hang here, or, on a quiet week, a line engraved in the wood. */}
      {(more > 0 || (connected && plaques.length === 0)) && (
        <Text userData={TEXT_LOD} font={FONTS.serif} fontSize={0.075} position={[0, plaques.length ? rowY(plaques.length) + 0.01 : TOP_ROW - 0.5, 0.0]} color="#d4ab62" anchorX="center" anchorY="middle">
          {more > 0 ? `and ${more} more this week` : "Nothing shipped yet this week"}
        </Text>
      )}
      {/* The pane that takes the clicks: unseen, over the plaques. */}
      {plaques.length > 0 && (
        <mesh position={[0, TOP_ROW - ((plaques.length - 1) * PLAQUE.pitch) / 2, 0.03]} visible={false} onPointerMove={move} onPointerOut={out} onClick={click} userData={{ merge: false }}>
          <planeGeometry args={[PLAQUE.w, plaques.length * PLAQUE.pitch]} />
          <meshBasicMaterial />
        </mesh>
      )}
      {opened >= 0 && (
        <Html position={[0, rowY(opened) + PLAQUE.h / 2, 0.03]} zIndexRange={[40, 0]}>
          <PlaqueCard change={plaques[opened]!} onClose={() => setOpen(null)} />
        </Html>
      )}
    </group>
  );
}
