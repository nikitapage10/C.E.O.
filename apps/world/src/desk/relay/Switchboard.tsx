import { useMemo, useRef, useState } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { LATE_MS, linkOf, useEmail, type EmailLoad, type EmailStatus } from "../email/email.ts";
import { bez, BAD, HOT, isPhone, knot, Parts, Poly, RC, ring, dots, spr, TAU, useViz, weave, WHITE, type VizSpec } from "../wvCanvas.ts";
import { itemsOf, RelayDash, type DashTab } from "./RelayDash.tsx";
import "./relay.css";

/**
 * Relay's switchboard (#364, richer in #375): the lines into Relay, Dialtone at the board, and where each mail goes,
 * drawn as threads of light. Letters of light ride in, Dialtone's sorting rings turn them over, and each one leaves
 * for Need you, FYI or Noise in that line's colour, in the proportions of the real counts; where one lands, the line
 * flares. Only the email agent's public counts and states feed the drawing (api/_email/status.ts).
 *
 * Need you and FYI open: hovering shows a small preview, a click opens the dashboard on the page (RelayDash). The
 * mail itself (sender, subject, Dialtone's summary) is only there when signed in, from the private list, every word
 * wrapped in <Private>; signed out, the preview and the dashboard carry the counts and a Sign in, nothing else.
 *
 * Timing shows only when something is wrong: a check later than LATE_MS, or one that failed (Nikita, 2026-10-24).
 */

type Flow = "live" | "slow" | "down" | "off";

export const flowOf = (load: EmailLoad, status: EmailStatus | null): Flow => {
  if (load !== "live" || !status) return "off";
  const l = linkOf(status);
  return l === "ok" ? "live" : l === "slow" ? "slow" : l === "down" ? "down" : "off";
};


const agoText = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/** What's wrong with syncing, in a few words, or null when nothing is (then no time is shown at all). */
export function syncTrouble(load: EmailLoad, status: EmailStatus | null, now: number): string | null {
  if (load !== "live" || !status || status.gmail !== "connected" || status.agent === "waiting") return null;
  const last = status.lastCheck;
  if (status.agent === "error") return last ? `Last check failed · last good ${agoText(now - last)}` : "The last check failed";
  if (status.agent === "listening" && last !== null && now - last > LATE_MS) return `Sync is late · last check ${agoText(now - last)}`;
  return null;
}

type Pt = { x: number; y: number };
interface Letter {
  /** 0 riding in, 1 at the board, 2 riding out. */
  st: 0 | 1 | 2;
  u: number;
  v: number;
  /** Where it goes: 0 need you, 1 FYI, 2 noise. */
  to: number;
  /** Time held at the board, and its orbit there. */
  hold: number;
  a: number;
  r: number;
  x: number;
  y: number;
  /** Its last few places, for the tail. */
  tx: Float32Array;
  ty: Float32Array;
  ti: number;
}
interface Flare {
  x: number;
  y: number;
  t0: number;
  rgb: string;
}

const OUT_RGB = [HOT, RC.relay!, WHITE];
const OUT_K = ["needs", "fyi", "noise"];
const TAIL = 9;

/** The board's threads and letters, laid between the DOM nodes it finds by data-k. */
function boardSpec(flow: Flow, shares: number[]): VizSpec {
  const live = flow === "live" || flow === "slow";
  const sorting = flow === "live";
  let inPoly: Poly | null = null;
  let outs: (Poly | null)[] = [null, null, null];
  const outEls: (Element | null)[] = [null, null, null];
  let waits: { x0: number; y0: number; x1: number; y1: number }[] = [];
  let pf: Pt = { x: 0, y: 0 };
  let texts: Pt | null = null;
  let letters: Letter[] = [];
  let flares: Flare[] = [];
  let spawnAt = 0;
  const bg = { in: new Parts(36, 0), out: [new Parts(14, 0), new Parts(14, 0), new Parts(10, 0)] };
  // Pick a line by the real proportions; with no counts yet, evenly, so the drawing still sorts.
  const sum = shares.reduce((a, b) => a + b, 0);
  const pick = () => {
    if (!sum) return Math.floor(Math.random() * 3);
    let r = Math.random() * sum;
    for (let i = 0; i < 3; i++) if ((r -= shares[i]!) <= 0) return i;
    return 2;
  };
  const curve = (a: Pt, b: Pt, ph: boolean) => {
    const xs: number[] = [];
    const ys: number[] = [];
    if (ph) {
      const m = (b.y - a.y) * 0.55;
      bez(a.x, a.y, a.x, a.y + m, b.x, b.y - m, b.x, b.y, 48, xs, ys);
    } else {
      const m = (b.x - a.x) * 0.55;
      bez(a.x, a.y, a.x + m, a.y, b.x - m, b.y, b.x, b.y, 48, xs, ys);
    }
    return new Poly().set(xs, ys);
  };
  const newLetter = (): Letter => ({ st: 0, u: 0, v: 0.55 + Math.random() * 0.35, to: pick(), hold: 0, a: 0, r: 0, x: 0, y: 0, tx: new Float32Array(TAIL), ty: new Float32Array(TAIL), ti: -1 });
  const push = (L: Letter) => {
    L.ti = (L.ti + 1) % TAIL;
    L.tx[L.ti] = L.x;
    L.ty[L.ti] = L.y;
  };
  const flash = (i: number) => {
    const el = outEls[i] as HTMLElement | null;
    if (!el || typeof el.animate !== "function") return;
    const rgb = OUT_RGB[i]!;
    el.animate([{ boxShadow: `0 0 0 0 rgba(${rgb},0)` }, { boxShadow: `0 0 34px -6px rgba(${rgb},.75)`, offset: 0.25 }, { boxShadow: `0 0 0 0 rgba(${rgb},0)` }], { duration: 900, easing: "ease-out" });
  };

  return {
    lay(V) {
      const host = V.cv.parentElement;
      if (!host) return;
      const ph = isPhone(host);
      const elOf = (k: string) => host.querySelector(`[data-k="${k}"]`);
      const box = (k: string) => {
        const el = elOf(k);
        return el ? V.rel(el) : null;
      };
      const out = (b: { x: number; y: number; w: number; h: number }) => (ph ? { x: b.x + b.w / 2, y: b.y + b.h } : { x: b.x + b.w, y: b.y + b.h / 2 });
      const inn = (b: { x: number; y: number; w: number; h: number }) => (ph ? { x: b.x + b.w / 2, y: b.y } : { x: b.x, y: b.y + b.h / 2 });
      const g = box("gmail");
      const tx = box("texts");
      const h = box("hub");
      const p = box("pf");
      waits = [];
      inPoly = null;
      outs = [null, null, null];
      texts = null;
      if (!h) return;
      pf = p ? { x: p.x + p.w / 2, y: p.y + p.h / 2 } : { x: h.x + h.w / 2, y: h.y + h.h / 2 };
      const hubIn = inn(h);
      const hubOut = out(h);
      if (g) {
        const o = out(g);
        if (live) inPoly = curve(o, hubIn, ph);
        else waits.push({ x0: o.x, y0: o.y, x1: hubIn.x, y1: hubIn.y });
      }
      if (tx) {
        const o = out(tx);
        texts = o;
        waits.push({ x0: o.x, y0: o.y, x1: hubIn.x, y1: hubIn.y });
      }
      OUT_K.forEach((k, i) => {
        const b = box(k);
        outEls[i] = elOf(k);
        if (!b) return;
        if (live) outs[i] = curve(hubOut, inn(b), ph);
        else waits.push({ x0: hubOut.x, y0: hubOut.y, x1: inn(b).x, y1: inn(b).y });
      });
    },
    draw(_V, c, t, dt) {
      for (const w of waits) dots(c, w.x0, w.y0, w.x1, w.y1, 6, 0.32, RC.relay!);
      if (texts) ring(c, texts.x, texts.y, 4, RC.relay!, 0.55, [2, 3]);
      if (!live) {
        // Waiting: a slow breath of motes round the board, no flow.
        for (let i = 0; i < 12; i++) {
          const a = t * 0.25 + (i * TAU) / 12;
          c.globalAlpha = 0.22 + 0.2 * Math.sin(t + i);
          c.drawImage(spr(flow === "down" ? BAD : RC.relay!), pf.x + Math.cos(a) * 52 - 2, pf.y + Math.sin(a) * 52 - 2, 4, 4);
        }
        c.globalAlpha = 1;
        return;
      }
      // The threads themselves, with a faint drift of light under the letters.
      if (inPoly) weave(c, inPoly, bg.in, { a: 0.4, sp: 5, sz: 0.9, v: 30, rgb: RC.relay!, line: 0.2, lw: 1 }, t, dt);
      outs.forEach((p, i) => p && weave(c, p, sorting ? bg.out[i]! : null, { a: 0.3, sp: 4, sz: 0.8, v: 24, rgb: OUT_RGB[i]!, line: i === 2 ? 0.12 : 0.2, lw: 1 }, t, dt));

      // Dialtone's sorting rings: three arcs in the three lines' colours, turning faster while letters are at the board.
      const busy = letters.some((L) => L.st === 1) ? 1 : 0;
      for (let k = 0; k < 3; k++) {
        const R = 46 + k * 8;
        const sp = (0.5 + k * 0.35) * (k % 2 ? -1 : 1) * (1 + busy * 1.4);
        const a0 = t * sp + k * 2.1;
        c.globalAlpha = 1;
        c.strokeStyle = `rgba(${OUT_RGB[k]},${0.22 + busy * 0.25})`;
        c.lineWidth = k === 0 ? 1.4 : 1;
        c.lineCap = "round";
        c.beginPath();
        c.arc(pf.x, pf.y, R, a0, a0 + 0.9 + k * 0.4);
        c.stroke();
        c.beginPath();
        c.arc(pf.x, pf.y, R, a0 + Math.PI, a0 + Math.PI + 0.5);
        c.stroke();
      }
      knot(c, pf.x, pf.y, sorting ? 1.4 : 0.9, t, RC.relay!, sorting ? 0.35 : 0.2);

      // The letters: spawn, ride in, circle the board, ride out to their line. Still frames (reduced motion) skip this.
      if (dt > 0 && inPoly) {
        spawnAt -= dt;
        if (spawnAt <= 0 && letters.length < 22) {
          letters.push(newLetter());
          spawnAt = (sorting ? 0.45 : 1.1) + Math.random() * (sorting ? 0.6 : 1.2);
        }
        for (const L of letters) {
          if (L.st === 0) {
            L.u += (L.v * dt * 160) / inPoly.len;
            const p = inPoly.at(Math.min(1, L.u));
            L.x = p.x;
            L.y = p.y;
            if (L.u >= 1) {
              L.st = 1;
              L.hold = 0;
              L.r = Math.hypot(L.x - pf.x, L.y - pf.y);
              L.a = Math.atan2(L.y - pf.y, L.x - pf.x);
            }
          } else if (L.st === 1) {
            // Paused at the cap: letters are counted and wait at the board, fading, never sorted.
            L.hold += dt;
            L.a += dt * (2.6 + L.v);
            L.r += (40 - L.r) * Math.min(1, dt * 3);
            L.x = pf.x + Math.cos(L.a) * L.r;
            L.y = pf.y + Math.sin(L.a) * L.r * 0.92;
            if (sorting && L.hold > 0.7 + L.v * 0.5) {
              L.st = 2;
              L.u = 0;
            }
          } else {
            const p = outs[L.to];
            if (!p) {
              L.u = 1;
              continue;
            }
            L.u += (L.v * dt * 150) / p.len;
            const q = p.at(Math.min(1, L.u));
            // Ease off the orbit onto the line.
            const k = Math.min(1, L.u * 6);
            L.x += (q.x - L.x) * (0.25 + 0.75 * k);
            L.y += (q.y - L.y) * (0.25 + 0.75 * k);
            if (L.u >= 1) {
              flares.push({ x: q.x, y: q.y, t0: t, rgb: OUT_RGB[L.to]! });
              flash(L.to);
            }
          }
          push(L);
        }
        letters = letters.filter((L) => !(L.st === 2 && L.u >= 1) && !(L.st === 1 && L.hold > 9));
      }
      for (const L of letters) {
        if (L.ti < 0) continue;
        const rgb = L.st === 2 ? OUT_RGB[L.to]! : RC.relay!;
        const sp0 = spr(rgb);
        for (let j = 1; j < TAIL; j++) {
          const i = (L.ti - j + TAIL) % TAIL;
          const f = 1 - j / TAIL;
          const s = 1 + f * 2.4;
          c.globalAlpha = 0.5 * f;
          c.drawImage(sp0, L.tx[i]! - s, L.ty[i]! - s, s * 2, s * 2);
        }
        c.globalAlpha = L.st === 1 && !sorting ? Math.max(0.2, 1 - L.hold / 9) : 1;
        c.drawImage(sp0, L.x - 7, L.y - 7, 14, 14);
        c.drawImage(spr(WHITE), L.x - 2.2, L.y - 2.2, 4.4, 4.4);
      }
      flares = flares.filter((f) => t - f.t0 < 1);
      for (const f of flares) {
        const k = t - f.t0;
        ring(c, f.x, f.y, 3 + k * 22, f.rgb, 0.7 * (1 - k));
        c.globalAlpha = 0.8 * (1 - k);
        c.drawImage(spr(f.rgb), f.x - 10, f.y - 10, 20, 20);
      }
      c.globalAlpha = 1;
    },
  };
}

const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString());

/** The hover preview on Need you or FYI: the first few, from the private list when signed in; the count otherwise. */
function Peek({ kind, count }: { kind: DashTab; count: number }) {
  const auth = useDeskAuth((s) => s.auth.status);
  const view = useEmail((s) => s.view);
  const items = itemsOf(view?.items, kind);
  const first = items.slice(0, 3);
  return (
    <span className="rl-peek" aria-hidden="true">
      <span className="rl-peek-h">{kind === "needs" ? "What needs you" : "Worth a glance"}</span>
      {auth !== "in" ? (
        <span className="rl-peek-gate">{count === 1 ? "1 waiting" : `${count} waiting`}. Sign in to see which.</span>
      ) : !view ? (
        <span className="rl-peek-gate">Reading…</span>
      ) : first.length ? (
        <>
          {first.map((i) => (
            <span key={i.id} className="rl-peek-i">
              <Private as="b">{i.from}</Private>
              <Private>{i.subject || i.summary}</Private>
              {kind === "needs" && i.action && <Private className="rl-peek-a">{i.action}</Private>}
            </span>
          ))}
          {items.length > first.length && <span className="rl-peek-more">and {items.length - first.length} more</span>}
        </>
      ) : (
        <span className="rl-peek-gate">Nothing here right now.</span>
      )}
      <span className="rl-peek-cta">Click to open</span>
    </span>
  );
}

interface OutProps {
  k: string;
  tab?: DashTab;
  label: string;
  cap: string;
  v: number | undefined;
  tone?: string;
  onOpen?: (t: DashTab) => void;
}

/** One line out of the board: a count, and for Need you and FYI a way into the mail. */
function Out({ k, tab, label, cap, v, tone, onOpen }: OutProps) {
  const inner = (
    <>
      <b className="rl-n">{n(v)}</b>
      <span>
        <em>{label}</em>
        <small>{cap}</small>
      </span>
    </>
  );
  if (!tab || !onOpen || v === undefined) {
    return (
      <div className="rl-node rl-out" data-k={k} data-tone={tone}>
        {inner}
      </div>
    );
  }
  return (
    <button type="button" className="rl-node rl-out is-open" data-k={k} data-tone={tone} onClick={() => onOpen(tab)} aria-haspopup="dialog" aria-label={`${label}: ${n(v)}. Open the dashboard`}>
      {inner}
      <i className="rl-out-go" aria-hidden="true">
        ↗
      </i>
      <Peek kind={tab} count={v} />
    </button>
  );
}

export function Switchboard({ load, status, now }: { load: EmailLoad; status: EmailStatus | null; now: number }) {
  const flow = flowOf(load, status);
  const live = flow === "live" || flow === "slow";
  const st = live ? status : null;
  const total = st ? st.needsYou + st.fyi + st.noise : 0;
  const share = (v: number) => (total ? v / total : 0);
  const key = st ? `${flow}:${st.needsYou}:${st.fyi}:${st.noise}` : flow;
  const spec = useMemo(
    () => boardSpec(flow, [share(st?.needsYou ?? 0), share(st?.fyi ?? 0), share(st?.noise ?? 0)]),
    // The key carries everything the threads read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);
  const [dash, setDash] = useState<DashTab | null>(null);
  const trouble = syncTrouble(load, status, now);
  const gmailWord = load === "off" ? "on the Azure copy" : !status ? (load === "failed" ? "not answering" : "listening…") : status.gmail === "refused" ? "needs reconnecting" : status.gmail !== "connected" || status.agent === "waiting" ? "waiting to connect" : flow === "slow" ? "paused at the cap" : flow === "down" ? "one check missed" : "connected";
  const hubWord = flow === "live" ? "sorting each new mail" : flow === "slow" ? "counting, not sorting" : flow === "down" ? "trying again" : "waiting at the board";
  const open = st ? setDash : undefined;

  return (
    <>
      <section className="rl-board" data-flow={flow} aria-label="Relay's switchboard">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <div className="rl-col rl-col--src">
          <p className="rl-colh">Lines in</p>
          <div className="rl-node" data-k="gmail" data-on={live ? "" : undefined}>
            <span className="rl-node-k">
              <i className={`wv-dot${live ? "" : " is-ring"}`} aria-hidden="true" />
              Email
            </span>
            <b>Gmail inbox</b>
            <small>{gmailWord}</small>
            {st && <span className="rl-node-n">{n(st.newToday)} new today</span>}
          </div>
          <div className="rl-node" data-k="texts">
            <span className="rl-node-k">
              <i className="wv-dot is-ring" aria-hidden="true" />
              Texts
            </span>
            <b>Messages</b>
            <small>waiting on the MacBook</small>
          </div>
        </div>

        <div className="rl-col rl-col--hub">
          <div className="rl-node rl-node--hub" data-k="hub" data-on={live ? "" : undefined}>
            <span className="rl-hub-pf" data-k="pf">
              <img src="/desk/agent-dialtone.webp" alt="" width={72} height={72} decoding="async" />
            </span>
            <b>Dialtone</b>
            <small>{hubWord}</small>
            {trouble && (
              <span className="rl-beat is-late" role="status">
                {trouble}
              </span>
            )}
          </div>
        </div>

        <div className="rl-col rl-col--out">
          <p className="rl-colh">Where it goes</p>
          <Out k="needs" tab="needs" label="Need you" cap="Blasto drafts advice for each" v={st?.needsYou} tone="hot" onOpen={open} />
          <Out k="fyi" tab="fyi" label="FYI" cap="worth a glance, no reply" v={st?.fyi} onOpen={open} />
          <Out k="noise" label="Noise today" cap="promos and receipts, left be" v={st?.noise} tone="faint" />
        </div>
      </section>
      {dash && st && <RelayDash tab={dash} status={st} now={now} onTab={setDash} onClose={() => setDash(null)} />}
    </>
  );
}

/** The month's model allowance as a ring (a percentage of the email agent's cap, from the public status). */
export function Allowance({ pct }: { pct: number | null }) {
  const r = 34;
  const C = 2 * Math.PI * r;
  const f = pct === null ? 0 : Math.min(100, pct) / 100;
  return (
    <div className="rl-tile rl-allow">
      <svg viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={r} className="rl-allow-bg" />
        <circle cx="42" cy="42" r={r} className="rl-allow-fg" style={{ strokeDasharray: `${C}`, strokeDashoffset: `${C * (1 - f)}` }} />
      </svg>
      <div>
        <p className="wv-eyb">This month</p>
        <b className="rl-big">{pct === null ? "—" : `${pct}%`}</b>
        <small>of the email agent's model allowance</small>
      </div>
    </div>
  );
}
