import type { DeviceReading, PetMeal } from "../../../apps/world/src/desk/homeDevices.ts";
import { amount, BOWL_WORD, clock, due, duration, nextOf, noPlanSay, ounces, shapeSay, statusWord, trayBowls } from "../../../apps/world/src/desk/petDay.ts";
import "./petday.css";

/**
 * The Petlibro day on the Haven's Pets cards (#685): what the Petlibro app shows for each device, read only. The
 * fountain's intake, visits and average visit, and when the filter and the clean are due (overdue in ember); the wet
 * feeder's visits, eating time and today's bowls; the dry feeder's amount today, its feeds and today's schedule with
 * the next meal. A number Petlibro didn't send is left out, never shown as zero.
 */

function Stat({ v, unit, k }: { v: string | number; unit?: string; k: string }) {
  return (
    <div className="pd-stat">
      <b>
        {v}
        {unit && <small>{unit}</small>}
      </b>
      <span>{k}</span>
    </div>
  );
}

function Stats({ items }: { items: ({ v: string | number; unit?: string; k: string } | null)[] }) {
  const shown = items.filter((x): x is { v: string | number; unit?: string; k: string } => x !== null);
  if (!shown.length) return null;
  return (
    <div className="pd-stats">
      {shown.map((s) => (
        <Stat key={s.k} {...s} />
      ))}
    </div>
  );
}

const has = (n: number | undefined): n is number => typeof n === "number";

export function FountainDay({ d }: { d: DeviceReading }) {
  const dues = [has(d.filterDays) ? { k: "Filter", ...due(d.filterDays) } : null, has(d.cleanDays) ? { k: "Cleaning", ...due(d.cleanDays) } : null].filter((x) => x !== null);
  return (
    <>
      <Stats
        items={[
          has(d.drankMl) ? { v: ounces(d.drankMl), unit: "oz", k: "drunk today" } : null,
          has(d.visits) ? { v: d.visits, k: d.visits === 1 ? "visit" : "visits" } : null,
          has(d.avgSec) ? { v: duration(d.avgSec), k: "avg visit" } : null,
        ]}
      />
      {dues.length > 0 && (
        <ul className="pd-due">
          {dues.map((x) => (
            <li key={x.k} className={x.over ? "is-over" : undefined}>
              <span>{x.k}</span>
              <b>{x.text}</b>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Meals({ meals, wet, unit }: { meals: PetMeal[]; wet: boolean; unit?: DeviceReading["feedUnit"] }) {
  return (
    <ol className="pd-meals">
      {meals.map((m, i) => {
        const word = statusWord(m.status, wet);
        return (
          <li key={`${m.time}-${i}`} className={`pd-meal${m.status ? ` is-${m.status}` : ""}${m.on === false ? " is-off" : ""}`}>
            {wet && <span className="pd-bowl" aria-label={m.plate ? `Bowl ${m.plate}` : "Bowl"}>{m.plate ?? "·"}</span>}
            <span className="pd-when">
              {clock(m.time)}
              {m.end && <> – {clock(m.end)}</>}
            </span>
            {!wet && m.portions !== undefined && <span className="pd-amt">{amount(m.portions, unit)}</span>}
            {!wet && m.on !== undefined && <span className={`pd-sw${m.on ? " is-on" : ""}`}>{m.on ? "On" : "Off"}</span>}
            {word && <em>{word}</em>}
          </li>
        );
      })}
    </ol>
  );
}

export function WetDay({ d }: { d: DeviceReading }) {
  return (
    <>
      <Stats
        items={[has(d.visits) ? { v: d.visits, k: d.visits === 1 ? "visit today" : "visits today" } : null, has(d.visitSec) ? { v: duration(d.visitSec), k: "eating time" } : null]}
      />
      <WetTray d={d} />
    </>
  );
}

/**
 * The tray's three bowls, always: which one is in front (realInfo.platePosition) and each bowl's meal from the plan
 * (served, open now, next or later, with its window and name). Without a plan it says so plainly, and the plan read's
 * shape (counts and key names, never a value) sits folded underneath for the signed-in Desk.
 */
export function WetTray({ d }: { d: DeviceReading }) {
  const bowls = trayBowls(d);
  const meals = d.meals ?? [];
  const loose = meals.filter((m) => !m.plate);
  return (
    <>
      <p className="pd-k">
        Today's bowls
        <span className="pd-next">{d.plate ? `bowl ${d.plate} in front` : "bowl in front unknown"}</span>
      </p>
      <ol className="pd-tray" aria-label="The wet feeder's three bowls">
        {bowls.map((b) => (
          <li key={b.n} className={`pd-tbowl is-${b.state}${b.front ? " is-front" : ""}`} aria-current={b.front ? "true" : undefined}>
            <span className="pd-bowl" aria-hidden="true">
              {b.n}
            </span>
            <b>{BOWL_WORD[b.state]}</b>
            {b.time && (
              <span className="pd-when">
                {clock(b.time)}
                {b.end && <> – {clock(b.end)}</>}
              </span>
            )}
            {b.label && <span className="pd-label">{b.label}</span>}
            {b.front && <em>In front</em>}
          </li>
        ))}
      </ol>
      {loose.length > 0 && <Meals meals={loose} wet />}
      {meals.length === 0 && <p className="pd-none">{noPlanSay(d)}</p>}
      {d.heads && <p className="pd-heads">{d.heads}</p>}
      {d.wetPlanShape && (
        <details className="pd-diag">
          <summary>Plan read</summary>
          <p>{shapeSay(d.wetPlanShape)}</p>
        </details>
      )}
    </>
  );
}

export function DryDay({ d }: { d: DeviceReading }) {
  const next = nextOf(d.plan);
  return (
    <>
      <Stats
        items={[
          has(d.fedPortions) ? { v: amount(d.fedPortions, d.feedUnit), k: "fed today" } : null,
          has(d.feeds) ? { v: d.feeds, k: d.feeds === 1 ? "feeding" : "feedings" } : null,
        ]}
      />
      {d.plan && d.plan.length > 0 && (
        <>
          <p className="pd-k">
            Today's schedule
            {next && (
              <span className="pd-next">
                next {clock(next.time)}
                {next.portions !== undefined && <> · {amount(next.portions, d.feedUnit)}</>}
              </span>
            )}
          </p>
          <Meals meals={d.plan} wet={false} unit={d.feedUnit} />
        </>
      )}
    </>
  );
}
