import type { CSSProperties } from "react";
import "./deviceart.css";

/**
 * The Haven's devices drawn (#718): small line drawings in the house's night palette that move with what each device
 * is doing, for the gauges' pop-ups and the Pets and Hall pages. Pure SVG and CSS, decorative (aria-hidden): the words
 * beside them carry the reading. Reduced motion stills them.
 *
 *   DryFeederArt   the hopper's level; kibble falls into the bowl while it feeds
 *   WetFeederArt   the tray from above, three bowls, the one in front lit; it turns, the lid lifts while open
 *   FountainArt    the water's level; the stream runs and the surface ripples while it flows
 *   LitterArt      the globe; it turns while it cycles, the drawer and litter levels below
 *   VacuumArt      the robot from above; its brush spins and it roams while cleaning, it pulses on the dock
 */

const pct = (n: number | null | undefined, d = 0) => Math.max(0, Math.min(100, typeof n === "number" ? n : d));

export function DryFeederArt({ level, feeding, low }: { level?: number | null; feeding?: boolean; low?: boolean }) {
  const lv = low ? 18 : pct(level, 65);
  const top = 22 + (66 * (100 - lv)) / 100;
  return (
    <svg className="da da-dry" viewBox="0 0 120 140" aria-hidden="true" data-on={feeding ? "" : undefined} data-low={low ? "" : undefined}>
      <defs>
        <clipPath id="da-dry-clip">
          <rect x="34" y="18" width="52" height="74" rx="10" />
        </clipPath>
      </defs>
      <rect className="da-body" x="30" y="14" width="60" height="96" rx="14" />
      <g clipPath="url(#da-dry-clip)">
        <rect className="da-kibbleFill" x="34" y={top} width="52" height={92 - top} />
        {Array.from({ length: 14 }, (_, i) => (
          <circle key={i} className="da-kib" cx={38 + ((i * 11) % 46)} cy={top + 3 + ((i * 7) % 9)} r={2.2} />
        ))}
      </g>
      <rect className="da-lid" x="28" y="10" width="64" height="8" rx="4" />
      <rect className="da-chute" x="52" y="100" width="16" height="12" rx="3" />
      <path className="da-bowl" d="M30 122 h60 l-6 12 h-48 z" />
      <g className="da-fall">
        {Array.from({ length: 6 }, (_, i) => (
          <circle key={i} className="da-drop" cx={56 + (i % 3) * 4} cy={112} r={2.2} style={{ animationDelay: `${(i * 0.18).toFixed(2)}s` }} />
        ))}
      </g>
      <circle className="da-led" cx="60" cy="102" r="1.8" />
    </svg>
  );
}

export function WetFeederArt({ plate, open, turning }: { plate?: number | null; open?: boolean; turning?: boolean }) {
  // The tray's turn: bowl `plate` sits at the front (the bottom of the drawing).
  const p = plate && plate >= 1 && plate <= 3 ? plate : 1;
  const turn = -(p - 1) * 120;
  return (
    <svg className="da da-wet" viewBox="0 0 140 140" aria-hidden="true" data-open={open ? "" : undefined} data-turning={turning ? "" : undefined}>
      <circle className="da-body" cx="70" cy="70" r="58" />
      <g className="da-tray" style={{ transform: `rotate(${turn}deg)` } as CSSProperties}>
        {[1, 2, 3].map((b) => {
          const a = ((90 + (b - 1) * 120) * Math.PI) / 180;
          const cx = 70 + Math.cos(a) * 30, cy = 70 + Math.sin(a) * 30;
          return (
            <g key={b} className={b === p ? "da-bowlOn" : "da-bowlOff"}>
              <circle cx={cx} cy={cy} r="20" className="da-wetBowl" />
              <text x={cx} y={cy + 4} textAnchor="middle" className="da-num" style={{ transform: `rotate(${-turn}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
                {b}
              </text>
            </g>
          );
        })}
      </g>
      <path className="da-wetLid" d="M24 70 a46 46 0 0 1 92 0 z" />
      <path className="da-front" d="M52 128 h36" />
    </svg>
  );
}

export function FountainArt({ level, flowing }: { level?: number | null; flowing?: boolean }) {
  const lv = pct(level, 60);
  const surf = 118 - (52 * lv) / 100;
  return (
    <svg className="da da-fountain" viewBox="0 0 140 140" aria-hidden="true" data-on={flowing ? "" : undefined} data-low={lv < 25 ? "" : undefined}>
      <defs>
        <clipPath id="da-ft-clip">
          <path d="M22 62 h96 l-8 56 a10 10 0 0 1 -10 8 h-60 a10 10 0 0 1 -10 -8 z" />
        </clipPath>
      </defs>
      <g clipPath="url(#da-ft-clip)">
        <rect className="da-water" x="0" y={surf} width="140" height={140 - surf} />
        <path className="da-wave" d={`M0 ${surf} q 10 -4 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0`} />
      </g>
      <path className="da-body da-basin" d="M22 62 h96 l-8 56 a10 10 0 0 1 -10 8 h-60 a10 10 0 0 1 -10 -8 z" />
      <path className="da-spout" d="M64 62 v-28 a6 6 0 0 1 12 0 v28" />
      <path className="da-stream" d={`M76 38 q 18 2 16 ${surf - 38}`} />
      <path className="da-stream is-2" d={`M64 38 q -16 4 -14 ${surf - 38}`} />
      <g className="da-ripples">
        <ellipse cx="91" cy={surf} rx="6" ry="1.6" />
        <ellipse cx="51" cy={surf} rx="6" ry="1.6" style={{ animationDelay: "-0.8s" }} />
      </g>
    </svg>
  );
}

export function LitterArt({ cycling, drawer, litter, catInside }: { cycling?: boolean; drawer?: number | null; litter?: number | null; catInside?: boolean }) {
  const dr = pct(drawer, 0), lt = pct(litter, 70);
  return (
    <svg className="da da-litter" viewBox="0 0 140 150" aria-hidden="true" data-on={cycling ? "" : undefined} data-cat={catInside ? "" : undefined}>
      <rect className="da-body" x="18" y="108" width="104" height="34" rx="8" />
      <rect className="da-drawerBg" x="30" y="126" width="80" height="8" rx="4" />
      <rect className={`da-drawer${dr >= 85 ? " is-full" : ""}`} x="30" y="126" width={(80 * dr) / 100} height="8" rx="4" />
      <g className="da-globe">
        <circle className="da-body" cx="70" cy="64" r="48" />
        <circle className="da-litterIn" cx="70" cy="64" r="40" style={{ ["--lt" as string]: `${lt}%` } as CSSProperties} />
        <path className="da-opening" d="M40 50 a32 32 0 0 1 60 0 v18 h-60 z" />
        <path className="da-seam" d="M22 64 h96" />
      </g>
      <circle className="da-led" cx="70" cy="116" r="2.2" />
    </svg>
  );
}

export function VacuumArt({ state, battery }: { state?: string; battery?: number | null }) {
  const s = (state ?? "").toLowerCase();
  const cleaning = /clean|vacuum|mop|spot|zone|segment|room/.test(s) && !/return|dock|charg/.test(s);
  const docked = /dock|charg|idle|full/.test(s) && !cleaning;
  const going = /return/.test(s);
  const b = pct(battery, 0);
  return (
    <svg className="da da-vac" viewBox="0 0 160 120" aria-hidden="true" data-on={cleaning ? "" : undefined} data-docked={docked ? "" : undefined} data-going={going ? "" : undefined}>
      <rect className="da-dock" x="118" y="30" width="30" height="60" rx="6" />
      <path className="da-dockLed" d="M126 40 v40" />
      <g className="da-robot">
        <circle className="da-body" cx="0" cy="0" r="30" />
        <circle className="da-lidar" cx="0" cy="-8" r="9" />
        <path className="da-bump" d="M-26 -14 a30 30 0 0 1 52 0" />
        <g className="da-brush">
          <path d="M-22 18 l-10 4 M-22 18 l-4 10 M-22 18 l-10 -4" />
        </g>
        <rect className="da-batt" x="-10" y="12" width="20" height="5" rx="2" />
        <rect className="da-battIn" x="-9" y="13" width={(18 * b) / 100} height="3" rx="1.5" />
      </g>
    </svg>
  );
}
