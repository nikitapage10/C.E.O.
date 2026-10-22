import { Waits, type Wait } from "./parts.tsx";

/**
 * The house, in the Boiler Room (#225; Nikita, 2026-10-22: the Home agent lives here). Once Google Nest is connected:
 * the thermostats, who's home, and heating that follows the room you're in. Until then the gauges read nothing, on
 * purpose; no temperature here is ever made up.
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

/** An empty brass gauge: the needle rests at zero until there's a reading. */
function Gauge() {
  return (
    <svg className="bh-gauge" viewBox="0 0 120 72" aria-hidden="true">
      <path d="M12 64a48 48 0 0 1 96 0" fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="6" strokeLinecap="round" />
      {Array.from({ length: 11 }, (_, i) => {
        const a = Math.PI + (i / 10) * Math.PI;
        return <line key={i} x1={60 + Math.cos(a) * 40} y1={64 + Math.sin(a) * 40} x2={60 + Math.cos(a) * (i % 5 ? 36 : 32)} y2={64 + Math.sin(a) * (i % 5 ? 36 : 32)} stroke="currentColor" strokeOpacity=".5" strokeWidth="1" />;
      })}
      <line className="bh-needle" x1="60" y1="64" x2="22" y2="64" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="60" cy="64" r="4" fill="currentColor" />
    </svg>
  );
}

export function Home() {
  return (
    <section className="bh-home" aria-label="The house">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">The house · comes later</p>
          <h2 className="wv-h2">Heating that follows you from room to room</h2>
        </div>
        <p className="wv-note">The Home agent lives down here with the pipes. It waits on Google Nest.</p>
      </div>
      <ul className="bh-gauges">
        {GAUGES.map((g) => (
          <li key={g.k}>
            <Gauge />
            <b>{g.k}</b>
            <span>{g.s}</span>
            <em>No reading yet</em>
          </li>
        ))}
      </ul>
      <Waits items={WAITS} title="What the house waits on" className="bh-waits" />
    </section>
  );
}
