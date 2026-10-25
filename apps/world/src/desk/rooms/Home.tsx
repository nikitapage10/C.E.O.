import { useCallback, useRef } from "react";
import { RC, useFlow, type FlowLayoutFn, type Pt } from "../flow/index.ts";
import { Private } from "../Private.tsx";
import { Waits, type Wait } from "./parts.tsx";

/**
 * The house, in the Boiler Room (#225; Nikita, 2026-10-22: the Home agent lives here). Once Google Nest is connected:
 * the thermostats, who's home, and heating that follows the room you're in. Until then it reads nothing, on purpose;
 * no temperature here is ever made up.
 *
 * On the flow kit (#456), like the rest of the Boiler Room page: one particle line for the house, lying dashed and
 * waiting (the kit's `waiting` bed, a few slow faint motes) through its three stations, because nothing is connected.
 * It never flows until a real reading does.
 */

const GAUGES = [
  { k: "Thermostats", s: "Each room's temperature and target" },
  { k: "Who's home", s: "Presence, from the Nest sensors" },
  { k: "Following you", s: "Heat the room you're in, ease off the rest" },
];

const WAITS: Wait[] = [
  { what: "Google Nest Device Access", why: "A Device Access project linked to the Nest account: read the thermostats and presence. Its keys stay on the server." },
  { what: "Your rules for the heating", why: "It reads first. It only changes a thermostat with your tap, or by a rule you've set and can switch off." },
];

export function Home() {
  const host = useRef<HTMLDivElement>(null);

  // The house's one line runs through its stations' rings: across on a desk, down their left on a phone.
  const layout = useCallback<FlowLayoutFn>(({ W, H, rel }) => {
    const el = host.current;
    if (!el || W < 8 || H < 8) return { lines: [] };
    const rings = [...el.querySelectorAll(".bx-hring")].map((r): Pt => {
      const b = rel(r);
      return [b.x + b.w / 2, b.y + b.h / 2];
    });
    if (rings.length < 2) return { lines: [] };
    const [x, y] = rings[0]!;
    const across = Math.abs(rings[1]![1] - y) < 4;
    const path = across ? { from: [0, y] as Pt, to: [W, y] as Pt, bend: 0 } : { from: [x, 0] as Pt, to: [x, H] as Pt, bend: 0 };
    return { lines: [{ id: "house", path, waiting: true, density: 0, rate: 0, bright: 0.5, bed: 0.07 }] };
  }, []);

  const { cv } = useFlow(layout, { accent: RC.boiler });

  return (
    <section className="bx-house" aria-label="The house">
      <div className="bx-house-h">
        <div>
          <p className="fl-eyb">
            <span>The house</span>
            <i />
            comes later
          </p>
          <h2 className="bx-h2">Heating that follows you from room to room</h2>
        </div>
        <p className="bx-note">The Home agent lives down here with the pipes. It waits on Google Nest.</p>
      </div>
      <div className="bx-hline" ref={host}>
        <canvas ref={cv} className="fl-cv" aria-hidden="true" />
        <ul className="bx-hst">
          {GAUGES.map((g) => (
            <li key={g.k}>
              <i className="bx-hring" aria-hidden="true" />
              <b>{g.k}</b>
              <span>{g.s}</span>
              <em className="fl-wait">
                <Private label="no reading yet">No reading yet</Private>
              </em>
            </li>
          ))}
        </ul>
      </div>
      <Waits items={WAITS} title="What the house waits on" className="bx-hwaits" />
    </section>
  );
}
