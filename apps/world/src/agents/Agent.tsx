import { LINEAGES, PRESET_BY_ID, RELATIONSHIP_LABEL, getStation, placeToWorld, relationshipsOf, roomAngle, routeBetween, sampleRoute, type Look } from "@ceo/core";
import { Html } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Quaternion, LatheGeometry, LineBasicMaterial, LineSegments, MeshPhysicalMaterial, Vector2, Vector3, type Group, type Mesh } from "three";
import { useCast } from "../cast/castStore.ts";
import { agentPositions, clock } from "../clock.ts";
import { Flare } from "../fx/Flare.tsx";
import { emissive } from "../fx/materials.ts";
import { PBR } from "../fx/pbr.ts";
import { Block, facingDir } from "../rooms/primitives.tsx";
import { useWorld } from "../store.ts";
import { BUILD, BackProp, Face, HandProp, Hair, Hat, Head, Outfit, shellMaterial, sleeveMaterial } from "./Avatar.tsx";
import { poseFor, type PoseMode } from "./behavior.ts";
import { PropMesh } from "./Props.tsx";

/** A turned torso profile: narrow waist, rounded chest and shoulders. */
const TORSO = new LatheGeometry(
  [
    [0.0, 0.26], [0.1, 0.27], [0.16, 0.32], [0.19, 0.42], [0.2, 0.55], [0.22, 0.68], [0.26, 0.85],
    [0.27, 0.95], [0.25, 1.04], [0.18, 1.11], [0.08, 1.14], [0.0, 1.145],
  ].map(([x, y]) => new Vector2(x, y)),
  48,
);
TORSO.computeVertexNormals();

const handCache = new Map<string, MeshPhysicalMaterial>();
function handMaterial(shell: string) {
  let m = handCache.get(shell);
  if (!m) {
    const c = new MeshPhysicalMaterial({ color: shell, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
    c.color.lerp(c.color.clone().set("#ffffff"), 0.55);
    m = c;
    handCache.set(shell, m);
  }
  return m;
}

function hashPhase(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 1000) / 1000) * Math.PI * 2;
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const tmp = new Vector3();
const UP = new Vector3(0, 1, 0);
const shoulder = new Vector3();
const handPos = new Vector3();
const armQ = new Quaternion();

export interface Limbs {
  armL: React.RefObject<Mesh | null>;
  armR: React.RefObject<Mesh | null>;
  legL: React.RefObject<Group | null>;
  legR: React.RefObject<Group | null>;
}

const ARM = new CylinderGeometry(0.052, 0.045, 1, 12);
const SHOE = PBR.lacquer("#1a1715", 0.35);

/** The figure itself: build, torso, head, hair, face, hat, outfit, limbs, props and lineage signature. */
function Figure({
  look,
  lineage,
  headRef,
  handL,
  handR,
  core,
  caret,
  extraHands,
  limbs,
}: {
  look: Look;
  lineage: keyof typeof LINEAGES;
  headRef: React.RefObject<Group | null>;
  handL: React.RefObject<Mesh | null>;
  handR: React.RefObject<Mesh | null>;
  core: React.RefObject<Mesh | null>;
  caret: React.RefObject<Mesh | null>;
  extraHands: React.RefObject<Group | null>;
  limbs: Limbs;
}) {
  const b = BUILD[look.build];
  const shell = b.limbs ? PBR.fabric(look.shell) : shellMaterial(look.shell);
  const hand = b.limbs ? shellMaterial(look.skin) : handMaterial(look.shell);
  const hipY = b.lift + 0.34 * b.h;
  const legLen = hipY - 0.07;
  const legMat = PBR.fabric(look.lower);
  return (
    <>
      {!b.limbs && look.extra !== "hoverboard" && (
        <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} material={PBR.light(look.accent, 2.2)}>
          <torusGeometry args={[0.17, 0.012, 8, 40]} />
        </mesh>
      )}
      {b.limbs &&
        [-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? limbs.legL : limbs.legR} position={[side * 0.1 * b.w, hipY, 0]}>
            <mesh position={[0, -legLen / 2, 0]} material={legMat} castShadow>
              <capsuleGeometry args={[0.07 * Math.max(1, b.w * 0.9), legLen - 0.1, 6, 12]} />
            </mesh>
            <Block size={[0.13 * b.w, 0.07, 0.22]} position={[0, -legLen + 0.01, 0.04]} material={SHOE} radius={0.03} />
          </group>
        ))}
      <group position={[0, b.lift, 0]} scale={[b.w, b.h, b.w]}>
        <mesh geometry={TORSO} material={shell} castShadow receiveShadow />
        {!b.limbs && (
          <mesh position={[0, 0.58, 0]} material={PBR.light(look.accent, 2.6)}>
            <torusGeometry args={[0.215, 0.008, 6, 48]} />
          </mesh>
        )}
        <mesh ref={core} position={[0, 0.86, 0.2]} material={PBR.light(look.accent, b.limbs ? 1.6 : 3)}>
          <circleGeometry args={[b.limbs ? 0.03 : 0.045, 24]} />
        </mesh>
        <mesh position={[0, 1.13, 0]} material={b.limbs ? hand : PBR.chrome()}>
          <cylinderGeometry args={[0.055, 0.07, 0.12, 20]} />
        </mesh>
        <Outfit look={look} floor={-b.lift / b.h + 0.06} />
        <BackProp look={look} />
      </group>
      <group ref={headRef} position={[0, b.lift + 1.36 * b.h, 0]}>
        <Head look={look} />
        <Face look={look} />
        <Hair look={look} />
        <Hat look={look} />
        {lineage === "cursori" && (
          <mesh ref={caret} position={[0.3, 0, 0.06]} material={PBR.light(look.accent, 4)}>
            <boxGeometry args={[0.022, 0.3, 0.022]} />
          </mesh>
        )}
      </group>
      {b.limbs && (
        <>
          <mesh ref={limbs.armL} geometry={ARM} material={sleeveMaterial(look)} castShadow />
          <mesh ref={limbs.armR} geometry={ARM} material={sleeveMaterial(look)} castShadow />
        </>
      )}
      {/* Hands. The native Syntherion's float, armless. Budget. */}
      <mesh ref={handL} material={hand} castShadow>
        <sphereGeometry args={[0.065, 20, 16]} />
        <HandProp look={look} hand="left" />
      </mesh>
      <mesh ref={handR} material={hand} castShadow>
        <sphereGeometry args={[0.065, 20, 16]} />
        <HandProp look={look} hand="right" />
      </mesh>
      {lineage === "manusi" && (
        <group ref={extraHands} position={[0, b.lift + 0.95 * b.h, 0]}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[Math.cos((i * Math.PI) / 2) * 0.5, Math.sin(i) * 0.1, Math.sin((i * Math.PI) / 2) * 0.5]} material={hand} castShadow>
              <sphereGeometry args={[0.05, 16, 12]} />
            </mesh>
          ))}
        </group>
      )}
    </>
  );
}

/** One Syntherion. Reads its state from the store and its identity from the cast; animates itself every frame. */
export function Agent({ id }: { id: string }) {
  const rt = useWorld((s) => s.lattice.agents[id]);
  const speech = useWorld((s) => s.speech[id]);
  const focus = useWorld((s) => s.focus);
  const selected = useWorld((s) => s.selectedAgent === id);
  const hovered = useWorld((s) => s.hoveredAgent === id);
  const emote = useWorld((s) => s.emotes[id]);
  const task = useWorld((s) => (rt?.taskId ? s.lattice.tasks[rt.taskId] : undefined));
  const hoverAgent = useWorld((s) => s.hoverAgent);
  const selectAgent = useWorld((s) => s.selectAgent);
  const profile = useCast((s) => s.cast.profiles[id]);
  const cast = useCast((s) => s.cast);
  const openStudio = useCast((s) => s.openStudio);
  const studioOpen = useCast((s) => s.studio !== null);

  const root = useRef<Group>(null);
  const figure = useRef<Group>(null);
  const head = useRef<Group>(null);
  const handL = useRef<Mesh>(null);
  const handR = useRef<Mesh>(null);
  const core = useRef<Mesh>(null);
  const propRef = useRef<Group>(null);
  const orb = useRef<Group>(null);
  const caret = useRef<Mesh>(null);
  const extraHands = useRef<Group>(null);
  const ring = useRef<Mesh>(null);
  const limbs: Limbs = { armL: useRef<Mesh>(null), armR: useRef<Mesh>(null), legL: useRef<Group>(null), legR: useRef<Group>(null) };
  const yaw = useRef(0);
  const visibility = useRef(1);
  const phase = useMemo(() => hashPhase(id), [id]);

  const lineage = profile?.lineage ?? rt?.agent.lineage ?? "unforked";
  const look = profile?.look;
  const accent = look?.accent ?? LINEAGES[lineage].accent;
  const name = profile?.name ?? rt?.agent.name ?? id;
  const route = useMemo(() => (rt?.motion ? routeBetween(rt.motion.from, rt.motion.to, id) : null), [rt?.motion, id]);
  const relations = useMemo(() => relationshipsOf(cast, id), [cast, id]);

  // Marionette strings for the Gepetti: bar above the head, three strings to head and hands.
  const strings = useMemo(() => {
    if (lineage !== "gepetti") return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(18), 3));
    const m = new LineBasicMaterial({ transparent: true, opacity: 0.55, toneMapped: false });
    m.color.set(accent).multiplyScalar(1.6);
    return new LineSegments(g, m);
  }, [lineage, accent]);

  // Hide the speech bubble once its reading time is up.
  const [bubbleOn, setBubbleOn] = useState(false);
  useEffect(() => {
    if (!speech) return;
    const left = speech.until - performance.now();
    if (left <= 0) return;
    setBubbleOn(true);
    const timer = setTimeout(() => setBubbleOn(false), left);
    return () => clearTimeout(timer);
  }, [speech]);

  const [emoteOn, setEmoteOn] = useState(false);
  useEffect(() => {
    if (!emote) return;
    const left = emote.until - performance.now();
    if (left <= 0) return;
    setEmoteOn(true);
    const timer = setTimeout(() => setEmoteOn(false), left);
    return () => clearTimeout(timer);
  }, [emote]);

  useFrame(({ camera, clock: three }) => {
    if (!rt || !root.current || !figure.current) return;
    const t = three.elapsedTime;
    const now = clock.sim;

    let streaming = false;
    let moving = false;
    let heading: [number, number] = [0, 0];
    if (rt.motion && route) {
      const s = sampleRoute(route, now - rt.motion.startTs);
      root.current.position.set(...s.position);
      moving = !s.done;
      streaming = moving && s.kind === "stream";
      heading = s.heading;
    } else {
      root.current.position.set(...placeToWorld(rt.place, id));
    }
    agentPositions.set(id, (agentPositions.get(id) ?? new Vector3()).copy(root.current.position));

    const override = useWorld.getState().overrides[id];
    const live = override && override.until > performance.now() ? override : null;
    let mode: PoseMode = live ? (live.mode === "face" ? "idle" : live.mode) : rt.activity;
    if (!live) {
      if (moving) mode = rt.prop ? "carrying" : "walking";
      else if (mode === "walking") mode = "idle";
    }

    let targetYaw = yaw.current;
    const faceTarget = live?.mode === "face" && live.target ? agentPositions.get(live.target) : undefined;
    if (mode === "stare") {
      tmp.copy(camera.position).sub(root.current.position);
      targetYaw = Math.atan2(tmp.x, tmp.z);
    } else if (faceTarget && !moving) {
      tmp.copy(faceTarget).sub(root.current.position);
      targetYaw = Math.atan2(tmp.x, tmp.z);
    } else if (moving && (heading[0] || heading[1])) {
      targetYaw = Math.atan2(heading[0], heading[1]);
    } else if (!moving) {
      const st = getStation(rt.place.room, rt.place.station);
      const [dx, dz] = facingDir(st.facing);
      targetYaw = Math.atan2(dx, dz) + roomAngle(rt.place.room);
    }
    yaw.current = lerpAngle(yaw.current, targetYaw, mode === "stare" ? 0.12 : 0.08);
    root.current.rotation.y = yaw.current;

    visibility.current += ((streaming ? 0 : 1) - visibility.current) * 0.2;
    const v = visibility.current;
    figure.current.scale.setScalar(Math.max(0.0001, v));
    if (orb.current) {
      orb.current.visible = v < 0.98;
      orb.current.scale.setScalar(Math.max(0.0001, 1 - v));
    }

    const p = poseFor(mode, t, phase);
    figure.current.position.y = p.bob + p.lie * 0.3;
    figure.current.rotation.set(p.lean - p.lie * (Math.PI / 2), 0, p.roll);
    const b = BUILD[look?.build ?? "hover"];
    if (head.current) {
      head.current.position.y = b.lift + 1.36 * b.h + p.headLift;
      head.current.rotation.set(p.headPitch, p.headYaw, 0);
    }
    // Bodies with arms keep their hands lower and closer, hanging from the shoulders.
    const hx = b.limbs ? 0.82 : 1;
    handL.current?.position.set(p.handL[0] * b.w * hx, b.lift + p.handL[1] * b.h, p.handL[2]);
    handR.current?.position.set(p.handR[0] * b.w * hx, b.lift + p.handR[1] * b.h, p.handR[2]);
    if (b.limbs) {
      ([
        [limbs.armL.current, handL.current, -1],
        [limbs.armR.current, handR.current, 1],
      ] as const).forEach(([arm, hnd, side]) => {
        if (!arm || !hnd) return;
        shoulder.set(side * 0.24 * b.w, b.lift + 1.02 * b.h, 0);
        handPos.copy(hnd.position);
        tmp.copy(handPos).sub(shoulder);
        const len = Math.max(0.05, tmp.length() - 0.04);
        arm.position.copy(shoulder).addScaledVector(tmp, 0.5);
        armQ.setFromUnitVectors(UP, tmp.normalize());
        arm.quaternion.copy(armQ);
        arm.scale.set(1, len, 1);
      });
      const walking = mode === "walking" || mode === "carrying";
      const stride = walking ? Math.sin(t * 9 + phase) * 0.5 : mode === "celebrating" ? Math.sin(t * 14) * 0.15 : 0;
      if (limbs.legL.current) limbs.legL.current.rotation.x += (stride - limbs.legL.current.rotation.x) * 0.4;
      if (limbs.legR.current) limbs.legR.current.rotation.x += (-stride - limbs.legR.current.rotation.x) * 0.4;
    }
    if (core.current) core.current.scale.setScalar(0.8 + p.core * 0.25);
    if (propRef.current && handL.current && handR.current) {
      propRef.current.position.copy(handL.current.position).add(handR.current.position).multiplyScalar(0.5);
      propRef.current.position.y += 0.05;
    }
    if (caret.current) caret.current.visible = Math.floor(t * 2.2 + phase) % 2 === 0;
    if (extraHands.current) extraHands.current.rotation.y = t * 1.6 + phase;
    if (ring.current) {
      ring.current.visible = selected || hovered;
      ring.current.rotation.z = t * 0.8;
    }
    if (strings && head.current) {
      const pos = strings.geometry.attributes.position!.array as Float32Array;
      const barY = 2.35 + Math.sin(t * 1.3 + phase) * 0.05;
      const hy = head.current.position.y;
      pos.set([0, barY, 0, 0, hy + 0.15, 0, -0.35, barY, 0, ...p.handL, 0.35, barY, 0, ...p.handR]);
      strings.geometry.attributes.position!.needsUpdate = true;
    }
  });

  if (!rt || !look) return null;

  const inFocus = focus === null || focus === rt.place.room;
  const showBubble = bubbleOn && speech && inFocus;
  const showTag = (selected || hovered) && inFocus && !studioOpen;
  // Fixed-size labels in the studio close-up, distance-scaled ones in a room.
  const df = focus && !studioOpen ? 16 : undefined;
  const b = BUILD[look.build];
  const nameY = b.lift + 1.36 * b.h + 0.62;
  const costume = look.preset ? PRESET_BY_ID[look.preset]?.name : undefined;

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoverAgent(id);
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    if (useWorld.getState().hoveredAgent === id) hoverAgent(null);
    document.body.style.cursor = "";
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectAgent(id);
  };
  const onDouble = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    openStudio(id);
  };
  const names = cast.profiles;

  return (
    <group ref={root} name={`agent-${id}`}>
      <group ref={figure}>
        <Figure look={look} lineage={lineage} headRef={head} handL={handL} handR={handR} core={core} caret={caret} extraHands={extraHands} limbs={limbs} />
        {lineage === "gepetti" && strings && (
          <>
            <primitive object={strings} />
            <Block size={[0.8, 0.04, 0.04]} position={[0, 2.35, 0]} material={PBR.wood("oak")} radius={0.01} />
            <Block size={[0.04, 0.04, 0.5]} position={[0, 2.35, 0]} material={PBR.wood("oak")} radius={0.01} />
          </>
        )}
        {rt.prop && (
          <group ref={propRef}>
            <PropMesh prop={rt.prop} />
          </group>
        )}
        {rt.activity === "napping" && (
          <Html position={[0, 1.4, 0.2]} center className="zzz" zIndexRange={[20, 0]}>
            z<span>z</span>
            <span>Z</span>
          </Html>
        )}
      </group>

      <group ref={orb} position={[0, 0.8, 0]} visible={false}>
        <mesh material={emissive(accent, 5)}>
          <sphereGeometry args={[0.22, 14, 14]} />
        </mesh>
        <Flare size={1.6} color={accent} intensity={1.3} />
      </group>

      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} material={emissive("#ffffff", 2)} visible={false}>
        <ringGeometry args={[0.5, 0.515, 64, 1, 0, Math.PI * 1.7]} />
      </mesh>
      <mesh position={[0, 0.9, 0]} onPointerOver={onOver} onPointerOut={onOut} onClick={onClick} onDoubleClick={onDouble} visible={false}>
        <cylinderGeometry args={[0.55, 0.55, 2, 8]} />
        <meshBasicMaterial />
      </mesh>

      {emoteOn && emote && inFocus && (
        <Html position={[0.45, nameY + 0.25, 0]} center zIndexRange={[35, 0]}>
          <div className="emote">{emote.glyph}</div>
        </Html>
      )}
      {focus === rt.place.room && !showBubble && !showTag && !studioOpen && (
        <Html position={[0, nameY, 0]} center distanceFactor={16} zIndexRange={[25, 0]}>
          <div className="nameplate">
            <span style={{ color: accent }}>●</span> {name}
            {costume && <small>{costume}</small>}
          </div>
        </Html>
      )}
      {showBubble && (
        <Html position={[0, nameY + 0.1, 0]} center distanceFactor={df} zIndexRange={[30, 0]}>
          <div className={`bubble ${df ? "" : "bubble--far"}`} style={{ borderLeftColor: accent }}>
            <b style={{ color: accent }}>{name}</b> {speech!.text}
          </div>
        </Html>
      )}
      {showTag && !showBubble && (
        <Html position={[0, nameY + 0.1, 0]} center distanceFactor={df} zIndexRange={[40, 0]}>
          <div className="tag" style={{ borderLeftColor: accent, borderLeftWidth: 2 }}>
            <div className="tag__name">
              {name} <span style={{ color: accent }}>{LINEAGES[lineage].name}</span>
            </div>
            <div className="tag__role">{profile?.role}</div>
            {profile?.personality.traits.length ? <div className="tag__traits">{profile.personality.traits.join(" · ")}</div> : null}
            {relations.slice(0, 3).map((r) => (
              <div key={r.index} className="tag__rel">
                {RELATIONSHIP_LABEL[r.kind]} · {names[r.other]?.name ?? r.other}
              </div>
            ))}
            {task && task.status === "running" && (
              <>
                <div className="tag__task">{task.title}</div>
                <div className="tag__bar">
                  <i style={{ width: `${Math.round(task.progress * 100)}%`, background: accent }} />
                </div>
              </>
            )}
            <div className="tag__hint">double-click · agent studio</div>
          </div>
        </Html>
      )}
    </group>
  );
}
