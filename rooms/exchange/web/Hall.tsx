import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "@fontsource-variable/big-shoulders-display";
import "@fontsource-variable/geist-mono";
import "./hall.css";
import { reducedMotion } from "@ceo/engine/sigils/wvCanvas.ts";
import { useRoomReady } from "@ceo/engine/web/roomReady.ts";
import { asideLine, byMove } from "../data/asides.ts";
import { biggestMove, floorWord } from "../data/floor.ts";
import { bookWord, hallView, type HallSoon } from "../data/hall.ts";
import { money, startPolymarket, usePolymarket } from "../data/polymarket.ts";
import { usePositions } from "../data/positions.ts";
import { ago, MarketRow, usePinToggle } from "./Markets.tsx";
import { Marquee } from "./Marquee.tsx";
import type { Hall as Scene } from "./hallScene.ts";

/**
 * The trade floor, the top of the Exchange (#823): the whole screen under the bar is a futuristic exchange floor in 3D
 * (hallScene.ts, lazy loaded with three.js). The busiest Polymarket markets each stand on the floor as a trading post
 * with their odds on its screens, the marquee over the back wall runs the live tape, the book's kiosk at the front says
 * how many positions are open (a count, never a figure), and the posts still being assembled at the edges are the
 * room's real "still to come". Over the scene: the floor's word and the day's figures at the top left, a tag riding each
 * post, and on the right the busiest markets as a list, each opening to its chart, volumes, link and pin. Picking a
 * post opens its row. Until the 3D is up, and without WebGL, the tags sit in a row with the marquee over them, so the
 * floor is whole and usable at once. Public odds only.
 */

type GL = "idle" | "loading" | "on" | "off";
const PHONE_Q = "(max-width: 760px)";
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_Q).matches;
const LIMIT = 10;

export function Hall({ soon, onBook }: { soon: readonly HallSoon[]; onBook: () => void }) {
  const status = usePolymarket((s) => s.status);
  const board = usePolymarket((s) => s.board);
  const busy = usePolymarket((s) => s.busy);
  const posStatus = usePositions((s) => s.status);
  const open = usePositions((s) => s.data?.totals.open ?? null);
  const { pinned, toggle } = usePinToggle();
  const [now, setNow] = useState(() => Date.now());
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [gl, setGl] = useState<GL>("idle");
  useRoomReady(gl === "on" || gl === "off");

  useEffect(() => {
    startPolymarket();
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const view = useMemo(() => hallView({ status, board, posStatus, open, soon }), [status, board, posStatus, open, soon]);
  const top = useMemo(() => (board?.top ?? []).slice(0, LIMIT), [board]);
  const dayMoney = top.reduce((x, m) => x + m.volume24h, 0);
  const lead = useMemo(() => byMove(board?.world ?? [])[0] ?? null, [board]);
  const word = floorWord(board);
  const big = biggestMove(board);
  const say = lead ? asideLine(lead) : board ? "Polymarket's busiest markets, read every minute. Nothing here trades." : "The Bookie is reading the odds. No feed, no figures: he won't make one up.";
  const book = posStatus === "live" && open !== null ? open : null;

  // ---- the scene ----
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const scene = useRef<Scene | null>(null);
  const live = useRef(view);
  live.current = view;
  const pick = useRef<(id: string) => void>(() => {});
  pick.current = (id: string) => {
    if (id === "book") return onBook();
    setOpenRow(id);
    window.requestAnimationFrame(() => list.current?.querySelector(`[data-xc-line="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }));
  };

  // ---- the tags: each rides its anchor; one that would cover a tag already placed is lifted above it ----
  const tags = useRef(new Map<string, HTMLElement>());
  const at = useRef(new Map<string, [number, number, boolean]>());
  const settle = useRef(0);
  const spread = () => {
    settle.current = 0;
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    // The busiest first, then the book, then the posts still being built.
    const order = [...tags.current.keys()].sort((a, b) => rank(a) - rank(b));
    for (const id of order) {
      const el = tags.current.get(id)!;
      const p = at.current.get(id);
      if (!p || !p[2]) {
        el.classList.add("is-away");
        continue;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const x = p[0];
      let y = p[1];
      let ok = false;
      for (let k = 0; k < 6; k++) {
        const box = { l: x - w / 2 - 4, r: x + w / 2 + 4, t: y - h - 4, b: y + 4 };
        const hit = boxes.find((o) => o.l < box.r && box.l < o.r && o.t < box.b && box.t < o.b);
        if (!hit) {
          boxes.push(box);
          ok = true;
          break;
        }
        y = hit.t - 4;
      }
      el.classList.toggle("is-away", !ok || y - h < 0);
      el.style.setProperty("--gx", `${Math.round(x)}px`);
      el.style.setProperty("--gy", `${Math.round(y)}px`);
    }
  };
  const respread = useRef(() => {});
  respread.current = () => {
    if (!settle.current) settle.current = requestAnimationFrame(spread);
  };
  const tagRef = (id: string) => (el: HTMLElement | null) => {
    if (!el) tags.current.delete(id);
    else {
      tags.current.set(id, el);
      if (at.current.size) respread.current();
    }
  };

  useEffect(() => {
    const cv = canvas.current;
    const el = host.current;
    if (!cv || !el) return;
    let dead = false;
    const start = () => {
      if (dead) return;
      setGl("loading");
      void import("./hallScene.ts")
        .then((m) => {
          if (!m.canDraw3D()) throw new Error("no WebGL");
          return m.createHall(el, cv, {
            phone: isPhone(),
            reduce: reducedMotion(),
            view: live.current,
            inset: () => {
              const p = panel.current;
              return p && getComputedStyle(p).position === "absolute" ? p.offsetWidth + 24 : 0;
            },
            onPlace: (id, x, y, on) => {
              at.current.set(id, [x, y, on]);
              respread.current();
            },
            onPick: (id) => pick.current(id),
            onHover: (id) => setHot(id === "book" ? null : id),
          });
        })
        .then((s) => {
          if (dead) return s.dispose();
          scene.current = s;
          setGl("on");
        })
        .catch(() => !dead && setGl("off"));
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const viaIdle = typeof w.requestIdleCallback === "function";
    const idle = viaIdle ? w.requestIdleCallback!(start, { timeout: 600 }) : window.setTimeout(start, 120);
    return () => {
      dead = true;
      cancelAnimationFrame(settle.current);
      if (viaIdle) w.cancelIdleCallback?.(idle);
      else window.clearTimeout(idle);
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  const sig = JSON.stringify(view);
  useEffect(() => {
    scene.current?.set(live.current);
  }, [sig, gl]);
  useEffect(() => {
    scene.current?.focus(hot ?? openRow);
  }, [hot, openRow, gl]);

  const [bookBig, bookSmall] = bookWord(view.book);
  const flat = gl === "off";

  return (
    <section className={`xc-hall${flat ? " is-flat" : ""}`} data-gl={gl} aria-label="The trade floor: Polymarket's busiest markets on their posts, the live tape on the marquee">
      <div className="xc-hall-stage">
      <div ref={host} className="xc-hall-host">
        <canvas ref={canvas} className="xc-hall-gl" aria-hidden="true" />
      </div>
      <div className="xc-hall-veil" aria-hidden="true" />
      {flat && <Marquee board={board} status={status} />}

      <header className="xc-hud">
        <p className="xc-eyb">
          <span>The Exchange</span>
          <i aria-hidden="true" />
          Polymarket · read-only
        </p>
        <h1 className="xc-h1 desk__title">
          The floor is <em>{word}</em>.
        </h1>
        <p className="xc-say">{say}</p>
      </header>
      <div className="xc-foot-hud">
          <dl className="xc-ledger">
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
      </div>

      <ul className="xc-tags" aria-label="On the floor">
        {view.posts.map((p) => (
          <li key={p.id}>
            <button type="button" ref={tagRef(p.id)} className={`xc-tag is-${p.tone}${hot === p.id || openRow === p.id ? " is-hot" : ""}`} title={p.question} onClick={() => pick.current(p.id)} onMouseEnter={() => setHot(p.id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(p.id)} onBlur={() => setHot(null)}>
              <b>{p.name}</b>
              <span>
                <em className="fl-num">{p.odds}</em>
                {p.move && <i>{p.move}</i>}
              </span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" ref={tagRef("book")} className="xc-tag is-book" onClick={onBook}>
            <b>Your book</b>
            <span>{view.book.state === "live" && view.book.open !== null ? `${bookBig} ${bookSmall}` : bookSmall}</span>
          </button>
        </li>
        {view.soon.map((s, i) => (
          <li key={s.id} aria-hidden="true">
            <span ref={tagRef(`soon-${i}`)} className="xc-tag is-soon">
              <b>{s.name}</b>
              <span>Being built · {s.on.replace(/^Waiting on /i, "waits on ")}</span>
            </span>
          </li>
        ))}
      </ul>
      </div>

      <aside ref={panel} className="xc-panel" aria-label="Where the money is: the busiest markets by 24-hour volume, no sports">
        <header className="xc-panel-h">
          <p className="xc-k">
            <span>Where the money is</span> · today · no sports
          </p>
          <p className="xc-state" data-state={board?.stale ? "stale" : status}>
            <i aria-hidden="true" />
            {status === "ready" && board ? (board.stale ? `Polymarket isn't answering. Last good read ${ago(board.at, now)}.` : `Read ${ago(board.at, now)} · every minute`) : status === "failed" ? "Polymarket isn't answering. Trying again every minute." : status === "off" ? "Not connected here" : "Reading the odds…"}
          </p>
        </header>
        {top.length > 0 ? (
          <ol ref={list} className="xc-mks">
            {top.map((m) => (
              <MarketRow key={m.id} m={m} open={openRow === m.id} hot={hot === m.id} onToggle={() => setOpenRow(openRow === m.id ? null : m.id)} pinned={pinned.has(m.id)} onPin={toggle} busy={busy !== null} onHot={setHot} />
            ))}
          </ol>
        ) : (
          <p className="xc-empty">{status === "idle" ? "Reading Polymarket…" : status === "ready" ? "No open markets came back." : "No odds to show yet. Waiting on Polymarket."}</p>
        )}
      </aside>
    </section>
  );
}

const rank = (id: string) => (id.startsWith("soon-") ? 3 : id === "book" ? 2 : 1);

/** The page's accent while on the floor: gold (#823). */
export const HALL_ACCENT = { "--fl-accent": "201,168,92" } as CSSProperties;
