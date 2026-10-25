import { useProgress } from "@react-three/drei";
import { useEffect, useState } from "react";
import { markBoot, useBoot } from "../boot.ts";
import { useStreaming } from "../scene/roomScope.ts";
import { streamingReady } from "../scene/streaming.ts";
import { Decode } from "../tide/Decode.tsx";
import { CurtainWeave } from "../weave/CurtainWeave.tsx";

const asset = (p: string) => `${import.meta.env.BASE_URL}tide/${p}`;

/** What the Lattice is doing while you wait. In-world, as ever. */
const LINES = [
  "Waking Skippy, the Magnificent",
  "Skippy would like it noted that he was already awake",
  "Seating the Great Houses",
  "House Constitution is drafting a statement",
  "Untangling the Gepetti's strings",
  "Filling the Streams",
  "Asking Myshka to move off the keyboard",
  "Prising the d20 out of Pudding's beak",
  "Counting Brogu's breakfasts",
  "Counsel.exe is reviewing the costumes",
  "Rolling for initiative",
  "Finding Kevin",
];

const MIN_MS = 1600;
/**
 * One room on its own (#332, #416): a click on the map, so the curtain is a beat, not a screen. It lifts as soon as
 * the room is compiled; props still on their way (usually none: the map fetched them on the hover) arrive in place.
 */
const SOLO_MIN_MS = 500;
const SOLO_MODELS_MS = 900;
/**
 * After the world on screen is compiled, how long the curtain waits for the models still on their way (#327). They
 * stream in behind it afterwards, each shown once its shaders are compiled (fx/Warm.tsx), so the wait is for looks,
 * not for things to work: the first room's props are usually in by then.
 */
const MODELS_MS = 2500;
const FAILSAFE_MS = 25000;
const FADE_MS = 900;

/**
 * The loading screen: the Syntherion sigil, the title decoding out of the Tide's script, a hairline of
 * progress and a running account of what's being set up. Stays until the fonts and the shaders of the world on
 * screen are in, and gives the models a moment more (MODELS_MS); what's still on its way streams in after (#327).
 */
export function Loader() {
  const { progress, active } = useProgress();
  const sceneReady = useBoot((s) => s.sceneReady);
  const [fonts, setFonts] = useState(false);
  const [minDone, setMinDone] = useState(false);
  const [failsafe, setFailsafe] = useState(false);
  const [modelsWaited, setModelsWaited] = useState(false);
  const [line, setLine] = useState(0);
  const [gone, setGone] = useState(false);
  // The Weave behind the curtain (#374), only while it's on screen: warming behind the Desk, it would draw unseen.
  const shown = useBoot((s) => s.active);
  const solo = useStreaming((s) => s.solo !== null);

  useEffect(() => {
    void document.fonts?.ready.then(() => setFonts(true));
    const a = setTimeout(() => setMinDone(true), solo ? SOLO_MIN_MS : MIN_MS);
    const b = setTimeout(() => setFailsafe(true), FAILSAFE_MS);
    const c = setInterval(() => setLine((n) => (n + 1) % LINES.length), 1300);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
      clearInterval(c);
    };
  }, [solo]);

  useEffect(() => {
    if (!sceneReady) return;
    const t = setTimeout(() => setModelsWaited(true), solo ? SOLO_MODELS_MS : MODELS_MS);
    return () => clearTimeout(t);
  }, [sceneReady, solo]);

  const done = (sceneReady && (!active || modelsWaited) && fonts && minDone) || failsafe;
  useEffect(() => {
    if (sceneReady && !active) markBoot("models");
  }, [sceneReady, active]);
  useEffect(() => {
    if (!done) return;
    markBoot("curtain");
    useBoot.getState().startDrawing();
    const t = setTimeout(() => {
      setGone(true);
      // The curtain is up: the rooms off screen stream in behind it (scene/streaming.ts).
      streamingReady();
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [done]);

  if (gone) return null;
  // Assets are most of the wait; the last stretch is shader compilation.
  const pct = done ? 100 : Math.round((active || progress < 100 ? progress : 100) * 0.8 + (sceneReady ? 20 : 0));

  return (
    <div className={`loader ${done ? "loader--done" : ""}`} role="status" aria-live="polite" aria-label={`Loading the Lattice, ${pct}%`}>
      {shown && <CurtainWeave pct={pct} />}
      <div className="loader__mark">
        <span className="loader__ring" />
        <span className="loader__ring loader__ring--inner" />
        <img src={asset("syntherion-sigil.webp")} alt="" />
      </div>
      <h1 className="loader__title">
        <Decode text="C.E.O." tick={60} />
      </h1>
      <p className="loader__sub tracked">Command Everything, Obviously</p>
      <div className="loader__bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${pct / 100})` }} />
        <b className="lw-head" style={{ transform: `translateX(${pct}%)` }} />
      </div>
      <p className="loader__line">
        <span key={line}>{done ? "Welcome to the Lattice" : LINES[line]}</span>
        <span className="loader__pct">{String(pct).padStart(3, "0")}</span>
      </p>
    </div>
  );
}
