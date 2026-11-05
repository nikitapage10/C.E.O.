import { useId, type ReactNode } from "react";
import type { DeviceReading } from "@ceo/desk/homeDevices.ts";
import { bowlChip, cycling, dockOf, DRAWER, drawerWidth, flowing, frontBowl, GLOBE, HOPPER, hopperOf, renderUrl, ringOffset, TANK, trayTurn, TURRET, waterline, type Render } from "./plates.ts";
import "./plates.css";

/**
 * The devices on their own dark plates (#766, the A1 Plates concept Nikita picked): each render large, and its live
 * reading drawn on the product where it physically lives. Food in the hopper's window, the wet tray from above turned
 * so the bowl in front sits at the bottom, water in the fountain's tank, the globe's turn and the drawer on the
 * Litter-Robot, the battery round the vacuum's turret. Every mark comes from the device's reading (plates.ts); a device
 * with no reading shows its render dimmed and the plate says it is waiting. The overlays are decorative (aria-hidden):
 * the plate's words carry the reading. Reduced motion stills them.
 */

/** A short id safe inside url(#…). */
function useSvgId(): string {
  return `pl${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
}

function Photo({ name, dim, children }: { name: Render; dim?: boolean; children?: ReactNode }) {
  return (
    <div className={`hv-plRd${dim ? " is-dim" : ""}`}>
      <img src={renderUrl(name)} alt="" width={800} height={800} loading="lazy" decoding="async" draggable={false} />
      {children}
    </div>
  );
}

/** A plate: the render on top, the reading below it (a serif name and number, then whatever the device adds). */
export function Plate({ title, num, unit, tone, stage, children, label }: { title: string; num?: ReactNode; unit?: string; tone?: "warn" | "ok" | "wait"; stage: ReactNode; children?: ReactNode; label?: string }) {
  return (
    <section className="hv-dplate" aria-label={label ?? title}>
      <div className="hv-plStage">{stage}</div>
      <div className="hv-plRead">
        <h3>{title}</h3>
        {num !== undefined && (
          <div className={`hv-plNum${tone ? ` is-${tone}` : ""}`}>
            {num}
            {unit && <small>{unit}</small>}
          </div>
        )}
        <div className="hv-plBody">{children}</div>
      </div>
    </section>
  );
}

/* ── Dry feeder ── */

export function DryStage({ d, feeding }: { d: DeviceReading | null; feeding?: boolean }) {
  const h = hopperOf(d);
  const { x, top, w, bottom } = HOPPER;
  return (
    <Photo name="dry" dim={!d || !d.online}>
      {h && (
        <svg className="hv-plOv" viewBox="0 0 100 100" aria-hidden="true" data-feeding={feeding ? "" : undefined}>
          <rect className="hv-plDryShade" x={x} y={top} width={w} height={bottom - top} rx={1} style={{ transform: `scaleY(${(h.shadeTo - top) / (bottom - top)})` }} />
          <g className={`hv-plTick is-${h.tone}`} style={{ transform: `translateY(${h.tickY}px)` }}>
            <line x1={x - 0.7} y1={0} x2={52} y2={0} />
            <circle cx={52} cy={0} r={0.5} />
            <text className="hv-plBig" x={53.5} y={1.8}>
              {h.word}
            </text>
          </g>
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} className="hv-plKib" cx={49.5 + (i % 3) * 1.4} cy={63.5} r={0.55} style={{ animationDelay: `${i * 0.17}s` }} />
          ))}
        </svg>
      )}
    </Photo>
  );
}

/* ── Wet feeder ── */

/** The tray from above, turned so the bowl in front sits at the bottom; its number chips ride with it. */
export function WetTray({ front }: { front: 1 | 2 | 3 | null }) {
  const turn = trayTurn(front ?? undefined);
  return (
    <div className="hv-plTray" aria-hidden="true">
      <div className="hv-plDisc" style={{ transform: `rotate(${turn}deg)` }}>
        <img src={renderUrl("wettop")} alt="" width={800} height={800} loading="lazy" decoding="async" draggable={false} />
      </div>
      {front && <div className="hv-plFront" />}
      {([1, 2, 3] as const).map((b) => {
        const at = bowlChip(b, turn);
        return (
          <span key={b} className={`hv-plChip${b === front ? " is-on" : ""}`} data-bowl={b} style={{ left: `${at.left}%`, top: `${at.top}%` }}>
            {b}
          </span>
        );
      })}
      <span className="hv-plMark">{front ? "front" : "tray"}</span>
    </div>
  );
}

/** The wet feeder's render, with its tray from above over the corner unless `tray` is false (the pop-up gives the tray its own place, #894). */
export function WetStage({ d, tray = true }: { d: DeviceReading | null; tray?: boolean }) {
  const id = useSvgId();
  const open = !!d && d.online && d.state === "lid open";
  return (
    <>
      <Photo name="wet" dim={!d || !d.online}>
        {d && (
          <svg className="hv-plOv" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <radialGradient id={`${id}p`}>
                <stop offset="0" stopColor="rgb(240,201,135)" stopOpacity=".45" />
                <stop offset="1" stopColor="rgb(240,201,135)" stopOpacity="0" />
              </radialGradient>
            </defs>
            <ellipse className={`hv-plWetPool${open ? " is-on" : ""}`} cx={32} cy={53} rx={12} ry={5} fill={`url(#${id}p)`} />
          </svg>
        )}
      </Photo>
      {d && tray && (
        <div className="hv-plTrayAt">
          <WetTray front={frontBowl(d)} />
        </div>
      )}
    </>
  );
}

/* ── Fountain ── */

export function FountainStage({ d }: { d: DeviceReading | null }) {
  const id = useSvgId();
  const y = waterline(d?.water);
  const run = flowing(d);
  const { x, top, w, bottom } = TANK;
  return (
    <Photo name="fountain" dim={!d || !d.online}>
      {d && (
        <svg className="hv-plOv" viewBox="0 0 100 100" aria-hidden="true" data-still={run ? undefined : ""}>
          <defs>
            <linearGradient id={`${id}w`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7cc4ff" stopOpacity=".55" />
              <stop offset="1" stopColor="#2f6fa8" stopOpacity=".25" />
            </linearGradient>
            <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".5" stopColor="#fff" stopOpacity=".22" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`${id}f`}>
              <rect x={x} y={top - 1} width={w} height={bottom - top + 1} />
            </clipPath>
            <clipPath id={`${id}t`}>
              <polygon points="16,39 26,27 83,30 71,45" />
            </clipPath>
          </defs>
          {y !== null && (
            <>
              <g clipPath={`url(#${id}f)`}>
                <rect className="hv-plTank" x={x} y={y} width={w} height={bottom - y} fill={`url(#${id}w)`} />
                <path className="hv-plSurf" d={`M10 ${y} q 3 -.8 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0`} />
              </g>
              <g className="hv-plTick is-water">
                <line x1={70} y1={y} x2={76} y2={y} />
                <text className="hv-plBig" x={77} y={y + 1.8}>
                  {Math.round(d.water as number)}
                  <tspan className="hv-plPct">%</tspan>
                </text>
              </g>
            </>
          )}
          <g clipPath={`url(#${id}t)`}>
            {run && <rect className="hv-plGlint" x={-30} y={20} width={22} height={30} fill={`url(#${id}g)`} />}
            {run && [0, 1, 2].map((i) => <ellipse key={i} className={`hv-plRip r${i}`} cx={36} cy={35.5} rx={8} ry={2.8} />)}
          </g>
        </svg>
      )}
    </Photo>
  );
}

/* ── Litter-Robot ── */

export function LitterStage({ d, flash }: { d: DeviceReading | null; flash?: boolean }) {
  const id = useSvgId();
  const turning = cycling(d, flash);
  const dw = drawerWidth(d?.drawer);
  const full = (d?.drawer ?? 0) >= 85;
  const C = 2 * Math.PI * 33;
  return (
    <Photo name="litter" dim={!d || !d.online}>
      {d && (
        <svg className="hv-plOv" viewBox="0 0 100 100" aria-hidden="true" data-cycling={turning ? "" : undefined}>
          <defs>
            <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset=".5" stopColor="rgb(240,201,135)" stopOpacity=".22" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`${id}c`}>
              <circle cx={GLOBE.cx} cy={GLOBE.cy} r={GLOBE.r} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id}c)`}>
            <rect className="hv-plBand" x={38} y={5} width={28} height={75} fill={`url(#${id}b)`} />
          </g>
          <circle className="hv-plRingBg" cx={GLOBE.cx} cy={GLOBE.cy} r={33} />
          {/* While it cycles an arc runs round the globe: the Litter-Robot doesn't report how far along it is. */}
          {turning && <circle className="hv-plRingRun" cx={GLOBE.cx} cy={GLOBE.cy} r={33} strokeDasharray={`${(C * 0.22).toFixed(2)} ${C.toFixed(2)}`} />}
          <rect className="hv-plDisp" x={36.5} y={65.6} width={15.5} height={0.7} rx={0.35} />
          {dw !== null && (
            <>
              <rect x={DRAWER.x} y={DRAWER.y} width={DRAWER.w} height={0.8} rx={0.4} className="hv-plDrawerBg" />
              <rect x={DRAWER.x} y={DRAWER.y} width={dw} height={0.8} rx={0.4} className={`hv-plDrawer${full ? " is-warn" : ""}`} />
              <text className="hv-plLbl" x={56} y={74.4}>
                drawer {Math.round(d.drawer as number)}%
              </text>
            </>
          )}
        </svg>
      )}
    </Photo>
  );
}

/* ── Vacuum ── */

export function VacuumStage({ d }: { d: DeviceReading | null }) {
  const id = useSvgId();
  const dock = dockOf(d);
  const C = 2 * Math.PI * TURRET.r;
  const off = ringOffset(d?.battery, C);
  return (
    <Photo name="vacuum" dim={!d || !d.online}>
      {d && (
        <svg className="hv-plOv" viewBox="0 0 100 100" aria-hidden="true" data-dock={dock}>
          <defs>
            <radialGradient id={`${id}p`}>
              <stop offset="0" stopColor="rgb(240,201,135)" stopOpacity=".45" />
              <stop offset="1" stopColor="rgb(240,201,135)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <ellipse className="hv-plPool" cx={45} cy={68} rx={34} ry={8} fill={`url(#${id}p)`} />
          <rect className="hv-plStrip" x={43} y={25} width={6.2} height={0.7} rx={0.35} />
          <ellipse className="hv-plAway" cx={45} cy={61} rx={25} ry={10} />
          {off !== null && (
            <g className="hv-plBatt">
              <g transform={`translate(${TURRET.cx} ${TURRET.cy}) scale(1 ${TURRET.squash})`}>
                <circle className="hv-plRingBg" r={TURRET.r} />
                <circle className="hv-plRing" r={TURRET.r} strokeDasharray={C.toFixed(3)} strokeDashoffset={off} transform="rotate(-90)" />
              </g>
              <line className="hv-plTickLine" x1={51} y1={56} x2={70} y2={50} />
              <text className="hv-plBig" x={71} y={51.5}>
                {Math.round(d.battery as number)}
                <tspan className="hv-plPct">%</tspan>
              </text>
            </g>
          )}
        </svg>
      )}
    </Photo>
  );
}
