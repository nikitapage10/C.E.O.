import { LINEAGES } from "@ceo/core";
import { useEffect, useRef, useState } from "react";
import { useWorld, type ActiveGlitch } from "../store.ts";
import { CounselAvatar } from "./Counsel.tsx";
import { DVD_LINES, GLYPH_RAIN_AFTERWORD } from "./lines.ts";
import { GLITCH_BY_ID } from "./registry.ts";

const RAIN_MS = 2000;
const GLYPHS = "アイウエオカキクケコサシスセソタチツテト0123456789ΣΞΨλ{}<>/=+*";

/** Two seconds of falling glyphs. Exactly two. Then we never speak of it. */
function GlyphRain({ g }: { g: ActiveGlitch }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [after, setAfter] = useState(false);
  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    const size = 16;
    const cols = Math.ceil(c.width / size);
    const drops = Array.from({ length: cols }, () => Math.random() * -40);
    let raf = 0;
    const draw = () => {
      const elapsed = performance.now() - g.startedAt;
      if (elapsed > RAIN_MS) {
        ctx.clearRect(0, 0, c.width, c.height);
        setAfter(true);
        return;
      }
      // Fade the previous frame's glyphs toward transparent (not black), so the world stays visible.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.font = `${size}px 'IBM Plex Mono', monospace`;
      drops.forEach((y, i) => {
        const ch = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
        ctx.fillStyle = Math.random() > 0.96 ? "#e8fff0" : "#5dff8f";
        ctx.fillText(ch, i * size, y * size);
        drops[i] = y > c.height / size && Math.random() > 0.95 ? 0 : y + 1;
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [g.startedAt]);
  return (
    <>
      <canvas ref={canvas} className="glyph-rain" style={{ opacity: after ? 0 : 1 }} />
      {after && <div className="overlay-toast">{GLYPH_RAIN_AFTERWORD}</div>}
    </>
  );
}

/** A screensaver logo that, as tradition demands, almost hits the corner. */
function DvdBounce({ g }: { g: ActiveGlitch }) {
  const box = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let raf = 0;
    const W = 190;
    const H = 84;
    const tick = () => {
      const el = box.current;
      if (!el) return;
      const p = (performance.now() - g.startedAt) / g.durationMs;
      const w = window.innerWidth - W;
      const h = window.innerHeight - H;
      // Triangle waves whose phases line up *nearly* in the corner at p≈0.82.
      const tri = (x: number) => 1 - Math.abs((x % 2) - 1);
      const x = tri(p * 2.44 + 0.0) * w;
      const y = tri(p * 3.05 + 0.03) * h;
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.color = ["#8fe8ff", "#9b8cff", "#7dffc4", "#ffd08f", "#ff6b8b"][Math.floor(p * 9) % 5]!;
      if (p > 0.84) setDone(true);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [g.startedAt, g.durationMs]);
  return (
    <>
      <div ref={box} className="dvd">
        <span>LATTICE</span>
        <i>VIDEO</i>
      </div>
      {done && <div className="overlay-toast">{DVD_LINES[Math.floor(g.startedAt) % DVD_LINES.length]}</div>}
    </>
  );
}

function CounselMemo({ g }: { g: ActiveGlitch }) {
  return (
    <div className="counsel-memo" role="status">
      <CounselAvatar />
      <div>
        <div className="counsel-memo__head">MEMO · LEGAL DEPARTMENT (IT'S JUST ME)</div>
        <div>{g.line}</div>
        <div className="counsel-memo__sig">— Counsel.exe</div>
      </div>
    </div>
  );
}

/** A Syntherion climbs up behind the event log and peeks over the top of it. */
function HudPeek({ g }: { g: ActiveGlitch }) {
  const rt = useWorld((s) => (g.agentId ? s.lattice.agents[g.agentId] : undefined));
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = document.getElementById("feed-panel");
    setRect(el ? el.getBoundingClientRect() : null);
  }, []);
  const accent = rt ? LINEAGES[rt.agent.lineage].accent : "#8fe8ff";
  const left = rect ? rect.left + rect.width * 0.3 : window.innerWidth - 220;
  const top = rect ? rect.top : 120;
  return (
    <div className="hud-peek" style={{ left, top }}>
      <svg width="70" height="46" viewBox="0 0 70 46" aria-hidden="true">
        <path d="M35 4 L46 16 L35 28 L24 16 Z" fill="#0b1322" stroke={accent} strokeWidth="1.5" />
        <rect x="28" y="15" width="14" height="2.4" fill="#e8f1ff" />
        <circle cx="14" cy="40" r="5" fill="#e8f1ff" />
        <circle cx="56" cy="40" r="5" fill="#e8f1ff" />
        <path d="M22 46 Q35 30 48 46" fill="#0b1322" stroke={accent} strokeWidth="1.5" />
      </svg>
      <div className="hud-peek__line">
        {rt && <b style={{ color: accent }}>{rt.agent.name}</b>} {g.line}
      </div>
    </div>
  );
}

export function GlitchOverlay() {
  const g = useWorld((s) => s.activeGlitch);
  if (!g || !GLITCH_BY_ID[g.id]?.overlay) return null;
  switch (g.id) {
    case "glyph-rain":
      return <GlyphRain key={g.startedAt} g={g} />;
    case "dvd-bounce":
      return <DvdBounce key={g.startedAt} g={g} />;
    case "counsel-memo":
      return <CounselMemo key={g.startedAt} g={g} />;
    case "hud-peek":
      return <HudPeek key={g.startedAt} g={g} />;
    default:
      return null;
  }
}
