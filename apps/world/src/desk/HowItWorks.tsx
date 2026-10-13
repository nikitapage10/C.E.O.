import { connectionsAt, type Connection, type ConnectionPlace } from "./connections.ts";
import { DESK_ROOMS } from "./deskData.ts";
import { PopScope, usePop } from "./Popovers.tsx";
import { Pill } from "./ui.tsx";

/**
 * How a part's outside connections work, shown inside that part's pop-over on the Systems page (issue #99, which
 * retired the page's shared "How it connects" list): what kind each is, who calls whom, how it signs in and how
 * often. A part with none shows nothing.
 */
export function HowItWorks({ system, part }: { system: ConnectionPlace["system"]; part?: string }) {
  const list = connectionsAt(system, part);
  if (!list.length) return null;
  return (
    <div className="how" aria-label="How it works">
      {list.map((c) => (
        <HowEntry key={c.id} c={c} />
      ))}
    </div>
  );
}

function HowEntry({ c }: { c: Connection }) {
  return (
    <section className={`how__item how__item--${c.status}`} aria-label={c.name}>
      <div className="how__top">
        <span className="how__eyebrow">How it works · {c.name}</span>
        <Pill tone={c.status === "live" ? "ok" : "off"}>{c.status === "live" ? "In use" : "Planned"}</Pill>
      </div>
      <ul className="conn__kinds" aria-label="Kind">
        {c.kinds.map((k) => (
          <li key={k}>{k}</li>
        ))}
      </ul>
      <p className="conn-pop__how">{c.how}</p>
      <dl className="conn-pop__facts how__facts">
        <div>
          <dt>Serves</dt>
          <dd>{c.serves}</dd>
        </div>
        <div>
          <dt>Signs in</dt>
          <dd>{c.auth}</dd>
        </div>
        <div>
          <dt>How often</dt>
          <dd>{c.when}</dd>
        </div>
      </dl>
    </section>
  );
}

/** The world clock's "How it works" button, whose pop-over explains the Boiler Room's connections behind the step. */
export function WorldHowItWorks() {
  return (
    <PopScope prefix="wclock-how">
      <WorldHowButton />
    </PopScope>
  );
}

function WorldHowButton() {
  const pop = usePop("world");
  return (
    <>
      <button type="button" style={{ "--tone": DESK_ROOMS.boiler.accent } as React.CSSProperties} className={`how-chip ${pop.open ? "is-open" : ""}`} aria-expanded={pop.open} {...pop.anchor}>
        How it works
      </button>
      {pop.card(
        <>
          <div className="conn-pop__top">
            <span className="conn-pop__name">The hourly step</span>
          </div>
          <HowItWorks system="world" />
        </>,
        { className: "how-pop", style: { "--tone": DESK_ROOMS.boiler.accent } as React.CSSProperties },
      )}
    </>
  );
}
