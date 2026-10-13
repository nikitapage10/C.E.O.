import { CONNECTIONS, type Connection } from "./connections.ts";
import { DESK_ROOMS } from "./deskData.ts";
import { PopScope, usePop } from "./Popovers.tsx";
import { Pill } from "./ui.tsx";

/**
 * The Systems page's "How it connects" (issue #69), kept quiet at a glance (issue #80): each link shows only its name
 * and what it serves, and the rest (its kind, how it's called, how it signs in, how often) pops up on hover, on
 * keyboard focus, or on a tap. A tap pins the card; tapping elsewhere or Escape closes it (Popovers.tsx).
 */

/** The ones in use first, then Relay's planned ones. */
const LIST = [...CONNECTIONS].sort((a, b) => (a.status === b.status ? 0 : a.status === "live" ? -1 : 1));

export function Connections() {
  return (
    <section className="conn" aria-label="How it connects">
      <header className="section-head">
        <h2>How it connects</h2>
        <span className="panel__hint">Hover or tap a link for how it's called</span>
      </header>
      <PopScope prefix="conn">
        <ul className="conn__grid">
          {LIST.map((c) => (
            <ConnectionItem key={c.id} c={c} />
          ))}
        </ul>
      </PopScope>
    </section>
  );
}

function ConnectionItem({ c }: { c: Connection }) {
  const pop = usePop(c.id);
  const tone = { "--tone": DESK_ROOMS[c.room].accent } as React.CSSProperties;
  return (
    <li className={`conn__item conn__item--${c.status}`} style={tone}>
      <button type="button" className={`conn__chip ${pop.open ? "is-open" : ""}`} aria-expanded={pop.open} {...pop.anchor}>
        <span className="conn__serves">{c.serves}</span>
        <span className="conn__name">{c.name}</span>
        <span className={`conn__dot conn__dot--${c.status}`} aria-label={c.status === "live" ? "In use" : "Planned"} role="img" />
      </button>
      {pop.card(
        <>
          <div className="conn-pop__top">
            <span className="conn-pop__name">{c.name}</span>
            <Pill tone={c.status === "live" ? "ok" : "off"}>{c.status === "live" ? "In use" : "Planned"}</Pill>
          </div>
          <ul className="conn__kinds" aria-label="Kind">
            {c.kinds.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          <p className="conn-pop__how">{c.how}</p>
          <dl className="conn-pop__facts">
            <div>
              <dt>Signs in</dt>
              <dd>{c.auth}</dd>
            </div>
            <div>
              <dt>How often</dt>
              <dd>{c.when}</dd>
            </div>
          </dl>
        </>,
        { className: `conn-pop--${c.status}`, style: tone },
      )}
    </li>
  );
}
