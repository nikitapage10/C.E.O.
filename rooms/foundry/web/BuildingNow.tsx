import { CREW, crewFor, HAND_COLOUR, threadOf, type Change, type Crate, type FoundryData, type HandName } from "../../../apps/world/src/foundry.ts";
import { ageWords, BOARD_TONE, BOARD_WORDS, buildingNow, justShipped, queued, whatOf, type BoardRow } from "../data/building.ts";
import { progressWords, type Progress } from "../data/progress.ts";

/**
 * What's being built (#1204), at the top of the Foundry page: every job in hand with its Short line, who builds it,
 * the thread it's built in, where it stands and for how long, each linking to its issue and pull request; then what
 * just shipped and what's queued. The same GitHub issues as the Deep Furnace below it, read through the Desk's feed;
 * with nothing in hand it says so, never a made-up row.
 */

const colourOf = (hand: string) => HAND_COLOUR[hand as HandName] ?? "var(--fo-gold)";
/** Where a job is built, as a meta line says it: "in Haven", or "with the Builder". */
const whereOf = (thread: string) => (thread === "Builder" ? "with the Builder" : `in ${thread}`);

export function BuildingNow({ data, progress, now, connected }: { data: FoundryData; progress: Map<number, Progress>; now: number; connected: boolean }) {
  const rows = buildingNow(data.crates, data.prs ?? []);
  const shipped = justShipped(data.changelog);
  const queue = queued(data.crates);
  return (
    <section className="fo-bn" aria-labelledby="fo-bn-h">
      <div className="fo-bn-head">
        <p className="fo-eyb">
          What's being built <i /> live from GitHub
        </p>
        <h2 id="fo-bn-h" className="fo-bn-h">
          Building now <b className="fl-num">{connected ? rows.length : "—"}</b>
        </h2>
      </div>
      {rows.length ? (
        <ul className="fo-bn-list">
          {rows.map((r) => (
            <BuildRow key={r.crate.number} row={r} progress={progress.get(r.crate.number)} now={now} />
          ))}
        </ul>
      ) : (
        <p className="fo-bn-empty">{connected ? "Nothing in hand right now. The next job the crew picks up shows here." : "Connecting to GitHub…"}</p>
      )}
      <div className="fo-bn-cols">
        <div className="fo-bn-col" aria-labelledby="fo-bn-shipped">
          <h3 id="fo-bn-shipped" className="fo-bn-k">Just shipped</h3>
          {shipped.length ? (
            <ul className="fo-bn-mini">
              {shipped.map((c) => (
                <ShippedRow key={c.key} change={c} now={now} />
              ))}
            </ul>
          ) : (
            <p className="fo-bn-empty">{connected ? "Nothing shipped lately." : "—"}</p>
          )}
        </div>
        <div className="fo-bn-col" aria-labelledby="fo-bn-queued">
          <h3 id="fo-bn-queued" className="fo-bn-k">
            Queued <b className="fl-num">{connected ? queue.length : "—"}</b>
          </h3>
          {queue.length ? (
            <ul className="fo-bn-mini">
              {queue.slice(0, 5).map((c) => (
                <QueuedRow key={c.number} crate={c} now={now} />
              ))}
              {queue.length > 5 && <li className="fo-bn-more">+{queue.length - 5} more in the queue</li>}
            </ul>
          ) : (
            <p className="fo-bn-empty">{connected ? "The queue is empty." : "—"}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function BuildRow({ row, progress, now }: { row: BoardRow; progress: Progress | undefined; now: number }) {
  const { crate, pr } = row;
  return (
    <li className="fo-bn-row" data-tone={BOARD_TONE[row.state]}>
      <div className="fo-bn-main">
        <a className="fo-bn-what" href={crate.url} target="_blank" rel="noreferrer" title={crate.title}>
          <span className="fo-bn-n">#{crate.number}</span> {row.what}
        </a>
        <span className="fo-bn-meta">
          <b className="fo-bn-hand" style={{ "--c": colourOf(row.hand) } as React.CSSProperties}>
            {row.hand}
          </b>
          <span>{row.model}</span>
          <span className="fo-bn-thread" title="The thread it's being built in">
            {row.thread} thread
          </span>
          <span title="How long it has been going">{ageWords(now - row.since)}</span>
          {progress && <span className="fo-bn-prog">{progressWords(progress)}</span>}
        </span>
      </div>
      <span className="fo-bn-state">
        <span className="fo-bn-pill">
          <i aria-hidden="true" />
          {BOARD_WORDS[row.state]}
        </span>
        {pr && (
          <a className="fo-bn-pr" href={pr.url} target="_blank" rel="noreferrer">
            PR #{pr.number} ↗
          </a>
        )}
      </span>
    </li>
  );
}

function ShippedRow({ change, now }: { change: Change; now: number }) {
  // One link a row (the issue, which carries its pull request), so a phone's row stays one tap tall.
  return (
    <li className="fo-bn-mrow">
      <a href={change.issue!.url} target="_blank" rel="noreferrer" title={change.title}>
        <span className="fo-bn-n">#{change.issue!.number}</span> {whatOf(change)}
      </a>
      <small>
        {change.by ? CREW[change.by].name : "The crew"} · {whereOf(threadOf(change))} · {ageWords(now - change.at)} ago{change.landed ? ` · ${change.landed.label}` : ""}
      </small>
    </li>
  );
}

function QueuedRow({ crate, now }: { crate: Crate; now: number }) {
  return (
    <li className="fo-bn-mrow">
      <a href={crate.url} target="_blank" rel="noreferrer" title={crate.title}>
        <span className="fo-bn-n">#{crate.number}</span> {whatOf(crate)}
      </a>
      <small>
        for {crate.hand ?? CREW[crewFor(crate)].name} · {whereOf(threadOf(crate))} · waiting {ageWords(now - (crate.createdAt ?? crate.updatedAt))}
      </small>
    </li>
  );
}
