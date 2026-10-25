import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keeper } from "../rooms/parts.tsx";
import { fan, useFlow, type FlowLayoutFn, type FlowLine } from "../flow/index.ts";
import { asideLine, byMove } from "./asides.ts";
import { biggestMove, floorWord, marketLine, MINT } from "./floor.ts";
import { Marquee } from "./Marquee.tsx";
import { ago, MarketRow, usePinToggle } from "./Markets.tsx";
import { money, pct, startPolymarket, usePolymarket } from "./polymarket.ts";
import { usePositions } from "./positions.ts";

/**
 * The floor, the top of the Exchange (#430, on the flow kit): Today's language in the Bookie's mint. Along the top the
 * marquee runs Polymarket's live odds. Under it, in plain type, what the floor is doing today and the Bookie's line on
 * the day's biggest mover, over a ledger whose last rule is where the day's money leaves from: one particle line fans
 * out of it into each of the busiest markets and lands on that market's odds bar. A line is as dense as the market's
 * share of the day's money and runs as fast as the day's move, mint up and rose down; when a
 * price ticks between reads, a packet runs the line and the new odds rise off it. Public odds only: the floor never
 * carries a position or a dollar of Nikita's.
 */

const FIRST = 5;
const LIMIT = 10;

export function Floor() {
  const status = usePolymarket((s) => s.status);
  const board = usePolymarket((s) => s.board);
  const busy = usePolymarket((s) => s.busy);
  const posStatus = usePositions((s) => s.status);
  const open = usePositions((s) => s.data?.totals.open ?? null);
  const { pinned, toggle } = usePinToggle();
  const [now, setNow] = useState(() => Date.now());
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [hot, setHot] = useState<string | null>(null);
  const stage = useRef<HTMLElement>(null);

  useEffect(() => {
    startPolymarket();
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const top = useMemo(() => (board?.top ?? []).slice(0, LIMIT), [board]);
  const shown = all ? top : top.slice(0, FIRST);
  const maxVol = top.reduce((x, m) => Math.max(x, m.volume24h), 0);
  const dayMoney = top.reduce((x, m) => x + m.volume24h, 0);
  const lead = useMemo(() => byMove(board?.world ?? [])[0] ?? null, [board]);
  const word = floorWord(board);
  const big = biggestMove(board);
  // Only what the lines are drawn from: the same numbers on a fresh read leave the floor alone.
  const key = JSON.stringify(shown.map((m) => [m.id, m.prob, m.change24h, m.volume24h])) + `|${maxVol}|${openRow ?? ""}`;

  const layout = useCallback<FlowLayoutFn>(
    ({ phone, rel }) => {
      const el = stage.current;
      const src = el?.querySelector("[data-xc-src]");
      if (!el || !src) return { lines: [] };
      const s = rel(src);
      const ends: { id: string; x: number; y: number; m: (typeof shown)[number] }[] = [];
      for (const m of shown) {
        const bar = el.querySelector(`[data-xc-line="${m.id}"] .xc-mk-odds`);
        if (!bar) continue;
        const b = rel(bar);
        ends.push({ id: m.id, x: b.x, y: b.y + b.h / 2, m });
      }
      if (!ends.length) return { lines: [] };
      let paths;
      if (phone) {
        // A phone: the money runs down the list's left gutter and turns into each bar.
        const list = el.querySelector(".xc-board .xc-mks");
        const x0 = Math.max(6, ends[0]!.x - 18);
        const y0 = list ? rel(list).y : s.y + s.h + 8;
        paths = ends.map((e) => ({ via: [[x0, y0], [x0, e.y - 18], [x0 + 6, e.y - 3], [e.x, e.y]] as [number, number][] }));
      } else {
        // The money runs along the ledger's rule, leaves at its end and fans out into the markets.
        const from: [number, number] = [s.x + s.w, s.y + 1];
        const run = Math.max(0, s.w - 24);
        const n = Math.max(2, Math.round(run / 6));
        const rx = Array.from({ length: n }, (_, k) => s.x + 24 + (run * k) / n);
        paths = fan(
          from,
          ends.map((e) => [e.x, e.y] as const),
          { trunk: 0.18, ease: 0.55 },
        ).map((p) => {
          const q = p as { xs: number[]; ys: number[] };
          return { xs: [...rx, ...q.xs], ys: [...rx.map(() => s.y + 1), ...q.ys] };
        });
      }
      const lines: FlowLine[] = ends.map((e, i) => {
        const l = marketLine(e.m, maxVol);
        return { id: e.id, path: paths[i]!, rgb: l.rgb, density: l.density, rate: l.rate, bright: l.bright, spread: 2, bed: 0.12 };
      });
      return { lines };
    },
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { cv, field, bind } = useFlow(layout, { accent: MINT, ground: true, backing: 420_000, onHover: setHot, onPick: (id) => setOpenRow((o) => (o === id ? null : id)) });
  useEffect(() => {
    void document.fonts?.ready.then(() => field.relayout());
  }, [field]);
  useEffect(() => field.setFocus(hot), [field, hot]);

  // A price that ticked since the last read: a packet runs its line and the new odds rise off it.
  const last = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    const was = last.current;
    last.current = new Map(top.map((m) => [m.id, m.prob]));
    if (!was) return;
    for (const m of shown) {
      const p = was.get(m.id);
      if (p === undefined || Math.abs(p - m.prob) < 0.001) continue;
      field.pulse(m.id);
      field.rise(`${m.prob > p ? "▲" : "▼"} ${pct(m.prob)}`, { at: m.id });
    }
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = lead ? asideLine(lead) : board ? "Polymarket's busiest markets, read every minute. Nothing here trades." : "The Bookie is reading the odds. No feed, no figures: he won't make one up.";
  const book = posStatus === "live" && open !== null ? open : null;

  return (
    <section ref={stage} className="fl-stage xc-stage" aria-label="The floor: Polymarket's live odds" {...bind}>
      <canvas ref={cv} className="fl-cv" aria-hidden="true" />
      <Marquee board={board} status={status} />
      <div className="xc-wrap xc-floor">
        <div className="xc-lede">
          <p className="fl-eyb">
            <span>The Exchange</span>
            <i aria-hidden="true" />
            Polymarket · read-only
          </p>
          <h1 className="fl-h1 desk__title">
            The floor is <em>{word}</em>.
          </h1>
          <p className="fl-say">{say}</p>
          <dl className="fl-ledger xc-ledger" data-xc-src>
            <div>
              <dt>Markets</dt>
              <dd>{top.length || "–"}</dd>
            </div>
            <div className="is-hot">
              <dt>Traded today</dt>
              <dd>{dayMoney ? money(dayMoney) : "–"}</dd>
            </div>
            <div>
              <dt>Biggest move</dt>
              <dd>
                {big ?? "–"}
                {big !== null && <small> pts</small>}
              </dd>
            </div>
            <div>
              <dt>Your book</dt>
              <dd>{book !== null ? <>{book}<small> open</small></> : <small className="xc-dd-word">{posStatus === "signed-out" ? "behind your passkey" : posStatus === "waiting" ? "waiting for the key" : "not read here"}</small>}</dd>
            </div>
          </dl>
          <Keeper page="exchange" className="xc-keeper" />
        </div>

        <div className="xc-board">
          <header className="xc-board-h">
            <p className="fl-k">
              <span>Where the money is</span> · today · no sports
            </p>
            <p className="xc-state" data-state={board?.stale ? "stale" : status}>
              <i aria-hidden="true" />
              {status === "ready" && board ? (board.stale ? `Polymarket isn't answering. Last good read ${ago(board.at, now)}.` : `Read ${ago(board.at, now)} · every minute`) : status === "failed" ? "Polymarket isn't answering. Trying again every minute." : status === "off" ? "Not connected here" : "Reading the odds…"}
            </p>
          </header>
          {top.length > 0 ? (
            <>
              <ol className="xc-mks" aria-label="The busiest markets by 24-hour volume, no sports">
                {shown.map((m) => (
                  <MarketRow key={m.id} m={m} open={openRow === m.id} hot={hot === m.id} onToggle={() => setOpenRow(openRow === m.id ? null : m.id)} pinned={pinned.has(m.id)} onPin={toggle} busy={busy !== null} onHot={setHot} />
                ))}
              </ol>
              {top.length > FIRST && (
                <button type="button" className="xc-more" aria-expanded={all} onClick={() => setAll((a) => !a)}>
                  {all ? "Show the top few" : `Show all ${top.length}`}
                </button>
              )}
            </>
          ) : (
            <p className="xc-empty fl-wait">{status === "idle" ? "Reading Polymarket…" : status === "ready" ? "No open markets came back." : "No odds to show yet. Waiting on Polymarket."}</p>
          )}
        </div>
      </div>
      {top.length > 0 && (
        <p className="xc-wrap xc-key" aria-hidden="true">
          <span>
            <i className="xc-key-line" /> each line is a market&apos;s share of the day&apos;s money; it runs as fast as the day&apos;s move
          </span>
          <span>
            <i className="xc-key-bar" /> it lands on the market&apos;s odds bar
          </span>
        </p>
      )}
    </section>
  );
}
