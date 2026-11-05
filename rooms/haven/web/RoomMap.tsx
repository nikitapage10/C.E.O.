import { centreOf, type HavenPlan } from "./data.ts";
import "./deviceart.css";

/**
 * Where to send the vacuum, on the floor plan (#718): the house from above, each room the vacuum knows lit to tap
 * (a check box each, for keys and screen readers), the picked ones swept with moving light, the dock marked. Rooms
 * the plan has but the vacuum's map doesn't stay dim. Drawn from the private plan, so passkey only, like the house.
 */

/** The vacuum's own name for a plan room, matched without case, or null. */
export function vacuumName(names: string[], room: { name: string; vacuum: string | null }): string | null {
  const want = (room.vacuum ?? room.name).toLowerCase();
  return names.find((n) => n.toLowerCase() === want) ?? null;
}

export function RoomMap({ plan, names, picked, onToggle, cleaning, disabled }: { plan: HavenPlan; names: string[]; picked: string[]; onToggle: (name: string) => void; cleaning?: boolean; disabled?: boolean }) {
  // The home's own rooms (the detached gym is never on the vacuum's map), framed snugly.
  const rooms = plan.rooms.filter((r) => !r.detached);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rooms)
    for (const [x, y, w, h] of r.parts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + w);
      y1 = Math.max(y1, y + h);
    }
  if (!Number.isFinite(x0)) return null;
  const pad = 12;
  const dock = plan.devices.find((d) => d.kind === "vacuum");
  const fs = Math.max(x1 - x0, y1 - y0) / 20;
  return (
    <div className="hv-rmap" data-cleaning={cleaning ? "" : undefined}>
      <svg viewBox={`${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`} role="group" aria-label="Rooms on the floor plan">
        <defs>
          <pattern id="hv-rmap-sweep" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect className="hv-rmapSweep" width="14" height="40" />
          </pattern>
        </defs>
        {rooms.map((r) => {
          const name = vacuumName(names, r);
          const on = !!name && picked.includes(name);
          const [cx, cy] = centreOf(r);
          const parts = r.parts.map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} />);
          if (!name)
            return (
              <g key={r.id} className="hv-rmapRoom is-off">
                {parts}
                <text x={cx} y={cy} style={{ fontSize: fs * 0.8 }}>
                  {r.name}
                </text>
              </g>
            );
          return (
            <g
              key={r.id}
              className={`hv-rmapRoom${on ? " is-on" : ""}`}
              role="checkbox"
              aria-checked={on}
              aria-label={`Clean ${r.name}`}
              aria-disabled={disabled || undefined}
              tabIndex={disabled ? -1 : 0}
              onClick={() => !disabled && onToggle(name)}
              onKeyDown={(e) => {
                if (disabled || (e.key !== " " && e.key !== "Enter")) return;
                e.preventDefault();
                onToggle(name);
              }}
            >
              {parts}
              {on && (
                <g className="hv-rmapFill">
                  {r.parts.map(([x, y, w, h], i) => (
                    <rect key={i} x={x} y={y} width={w} height={h} fill="url(#hv-rmap-sweep)" />
                  ))}
                </g>
              )}
              <text x={cx} y={cy} style={{ fontSize: fs }}>
                {r.name}
              </text>
            </g>
          );
        })}
        {dock && (
          <g className="hv-rmapDock" transform={`translate(${dock.x} ${dock.y})`}>
            <circle r={fs * 0.9} className="hv-rmapPulse" />
            <circle r={fs * 0.45} />
          </g>
        )}
      </svg>
    </div>
  );
}
