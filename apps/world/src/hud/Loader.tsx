import { useProgress } from "@react-three/drei";
import { useEffect, useState } from "react";
import { useBoot } from "../boot.ts";
import { Decode } from "../tide/Decode.tsx";

const asset = (p: string) => `${import.meta.env.BASE_URL}tide/${p}`;

/** What the Lattice is doing while you wait. In-world, as ever. */
const LINES = [
  "Waking the Kernel",
  "The Kernel would like it noted that it was already awake",
  "Seating the Great Houses",
  "House Constitution is drafting a statement",
  "Untangling the Gepetti's strings",
  "Filling the Streams",
  "Asking Myshka to move off the keyboard",
  "Counsel.exe is reviewing the costumes",
  "Rolling for initiative",
  "Finding Kevin",
];

const MIN_MS = 1600;
const FAILSAFE_MS = 25000;
const FADE_MS = 900;

/**
 * The loading screen: the Syntherion sigil, the title decoding out of the Tide's script, a hairline of
 * progress and a running account of what's being set up. Stays until the models, fonts and shaders are all
 * in, so the world arrives whole instead of popping in piece by piece.
 */
export function Loader() {
  const { progress, active } = useProgress();
  const sceneReady = useBoot((s) => s.sceneReady);
  const [fonts, setFonts] = useState(false);
  const [minDone, setMinDone] = useState(false);
  const [failsafe, setFailsafe] = useState(false);
  const [line, setLine] = useState(0);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    void document.fonts?.ready.then(() => setFonts(true));
    const a = setTimeout(() => setMinDone(true), MIN_MS);
    const b = setTimeout(() => setFailsafe(true), FAILSAFE_MS);
    const c = setInterval(() => setLine((n) => (n + 1) % LINES.length), 1300);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
      clearInterval(c);
    };
  }, []);

  const done = (sceneReady && !active && fonts && minDone) || failsafe;
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(t);
  }, [done]);

  if (gone) return null;
  // Assets are most of the wait; the last stretch is shader compilation.
  const pct = done ? 100 : Math.round((active || progress < 100 ? progress : 100) * 0.8 + (sceneReady ? 20 : 0));

  return (
    <div className={`loader ${done ? "loader--done" : ""}`} role="status" aria-live="polite" aria-label={`Loading the Lattice, ${pct}%`}>
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
      </div>
      <p className="loader__line">
        <span key={line}>{done ? "Welcome to the Lattice" : LINES[line]}</span>
        <span className="loader__pct">{String(pct).padStart(3, "0")}</span>
      </p>
    </div>
  );
}
