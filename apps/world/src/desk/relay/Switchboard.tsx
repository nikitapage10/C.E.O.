import { useEffect, useMemo, useRef, useState } from "react";
import { linkOf, type EmailLoad, type EmailStatus } from "../email/email.ts";
import { bez, HOT, isPhone, knot, Parts, Poly, RC, ring, dots, spr, useViz, weave, WHITE, type VizSpec } from "../wvCanvas.ts";
import "./relay.css";

/**
 * Relay's switchboard (#364): the lines into Relay, Dialtone at the board, and where each mail goes, drawn as threads of
 * light. Only the email agent's public counts and states feed it (api/_email/status.ts): numbers and enum words, never
 * a subject, sender or line of a mail. A line that isn't connected is a dotted thread that says what it waits on; with
 * no counts yet the numbers read as a dash, never a made-up figure.
 */

type Flow = "live" | "slow" | "down" | "off";

const flowOf = (load: EmailLoad, status: EmailStatus | null): Flow => {
  if (load !== "live" || !status) return "off";
  const l = linkOf(status);
  return l === "ok" ? "live" : l === "slow" ? "slow" : l === "down" ? "down" : "off";
};

interface Thread {
  poly: Poly;
  P: Parts | null;
  rgb: string;
  v: number;
  a: number;
}

/** The board's threads, laid between the DOM nodes it finds by data-k. */
function boardSpec(flow: Flow, shares: { needs: number; fyi: number; noise: number }): VizSpec {
  const live = flow === "live" || flow === "slow";
  const speed = flow === "slow" ? 18 : 46;
  let threads: Thread[] = [];
  let waits: { x0: number; y0: number; x1: number; y1: number }[] = [];
  let hub = { x: 0, y: 0 };
  let texts = { x: 0, y: 0 };
  const parts = {
    in: new Parts(54, 0.08),
    needs: new Parts(8 + Math.round(46 * shares.needs), 0),
    fyi: new Parts(6 + Math.round(36 * shares.fyi), 0.1),
    noise: new Parts(4 + Math.round(26 * shares.noise), 0),
  };
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }, ph: boolean) => {
    const xs: number[] = [];
    const ys: number[] = [];
    if (ph) {
      const m = (b.y - a.y) * 0.55;
      bez(a.x, a.y, a.x, a.y + m, b.x, b.y - m, b.x, b.y, 40, xs, ys);
    } else {
      const m = (b.x - a.x) * 0.55;
      bez(a.x, a.y, a.x + m, a.y, b.x - m, b.y, b.x, b.y, 40, xs, ys);
    }
    return new Poly().set(xs, ys);
  };
  return {
    lay(V) {
      const host = V.cv.parentElement;
      if (!host) return;
      const ph = isPhone(host);
      const box = (k: string) => {
        const el = host.querySelector(`[data-k="${k}"]`);
        return el ? V.rel(el) : null;
      };
      const out = (b: { x: number; y: number; w: number; h: number }) => (ph ? { x: b.x + b.w / 2, y: b.y + b.h } : { x: b.x + b.w, y: b.y + b.h / 2 });
      const inn = (b: { x: number; y: number; w: number; h: number }) => (ph ? { x: b.x + b.w / 2, y: b.y } : { x: b.x, y: b.y + b.h / 2 });
      const g = box("gmail");
      const tx = box("texts");
      const h = box("hub");
      threads = [];
      waits = [];
      if (!h) return;
      hub = { x: h.x + h.w / 2, y: h.y + h.h / 2 };
      const hubIn = inn(h);
      const hubOut = out(h);
      if (g) {
        const poly = curve(out(g), hubIn, ph);
        if (live) threads.push({ poly, P: parts.in, rgb: RC.relay!, v: speed, a: 0.9 });
        else {
          const o = out(g);
          waits.push({ x0: o.x, y0: o.y, x1: hubIn.x, y1: hubIn.y });
        }
      }
      if (tx) {
        const o = out(tx);
        texts = o;
        waits.push({ x0: o.x, y0: o.y, x1: hubIn.x, y1: hubIn.y });
      }
      const outs: [string, Parts, string, number][] = [
        ["needs", parts.needs, HOT, 1],
        ["fyi", parts.fyi, RC.relay!, 0.8],
        ["noise", parts.noise, WHITE, 0.4],
      ];
      for (const [k, P, rgb, a] of outs) {
        const b = box(k);
        if (!b) continue;
        const poly = curve(hubOut, inn(b), ph);
        if (live) threads.push({ poly, P, rgb, v: speed * 0.8, a });
        else waits.push({ x0: hubOut.x, y0: hubOut.y, x1: inn(b).x, y1: inn(b).y });
      }
    },
    draw(_V, c, t, dt) {
      for (const w of waits) dots(c, w.x0, w.y0, w.x1, w.y1, 6, 0.32, RC.relay!);
      for (const th of threads) weave(c, th.poly, th.P, { a: th.a, sp: 3.6, sz: 1.45, v: th.v, rgb: th.rgb, rgb2: WHITE, line: 0.22, lw: 1 }, t, dt);
      if (texts.x || texts.y) ring(c, texts.x, texts.y, 4, RC.relay!, 0.55, [2, 3]);
      if (live) knot(c, hub.x, hub.y, flow === "slow" ? 1.1 : 1.6, t, RC.relay!, flow === "slow" ? 0.6 : 0.9);
      else {
        // Waiting: a slow breath of motes round the board, no flow.
        for (let i = 0; i < 10; i++) {
          const a = t * 0.25 + (i * Math.PI * 2) / 10;
          c.globalAlpha = 0.25 + 0.2 * Math.sin(t + i);
          c.drawImage(spr(RC.relay!), hub.x + Math.cos(a) * 38 - 2, hub.y + Math.sin(a) * 16 - 2, 4, 4);
        }
        c.globalAlpha = 1;
      }
    },
  };
}

const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString());

/** Seconds since the last check, ticking each second while it shows (a number, not motion). */
function useSince(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [at]);
  return at === null ? null : Math.max(0, Math.round((now - at) / 1000));
}

const sinceText = (s: number) => (s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} d ago`);

export function Switchboard({ load, status }: { load: EmailLoad; status: EmailStatus | null }) {
  const flow = flowOf(load, status);
  const live = flow === "live" || flow === "slow";
  const st = live ? status : null;
  const total = st ? st.needsYou + st.fyi + st.noise : 0;
  const share = (v: number) => (total ? v / total : 0);
  const key = st ? `${flow}:${st.needsYou}:${st.fyi}:${st.noise}` : flow;
  const spec = useMemo(
    () => boardSpec(flow, { needs: share(st?.needsYou ?? 0), fyi: share(st?.fyi ?? 0), noise: share(st?.noise ?? 0) }),
    // The key carries everything the threads read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);
  const since = useSince(st?.lastCheck ?? null);
  const gmailWord = load === "off" ? "on the Azure copy" : !status ? (load === "failed" ? "not answering" : "listening…") : status.gmail === "refused" ? "needs reconnecting" : status.gmail !== "connected" || status.agent === "waiting" ? "waiting to connect" : flow === "slow" ? "paused at the cap" : flow === "down" ? "one check missed" : "connected";
  const hubWord = flow === "live" ? "sorting each new mail" : flow === "slow" ? "counting, not sorting" : flow === "down" ? "trying again" : "waiting at the board";

  return (
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
          <span className="rl-hub-pf">
            <img src="/desk/agent-dialtone.webp" alt="" width={64} height={64} decoding="async" />
            {live && <i className="rl-hub-halo" aria-hidden="true" />}
          </span>
          <b>Dialtone</b>
          <small>{hubWord}</small>
          <span className="rl-beat" aria-live="polite">
            {since === null ? "no checks yet" : `checked ${sinceText(since)}`}
          </span>
        </div>
      </div>

      <div className="rl-col rl-col--out">
        <p className="rl-colh">Where it goes</p>
        <div className="rl-node rl-out" data-k="needs" data-tone="hot">
          <b className="rl-n">{n(st?.needsYou)}</b>
          <span>
            <em>Need you</em>
            <small>Blasto drafts advice for each</small>
          </span>
        </div>
        <div className="rl-node rl-out" data-k="fyi">
          <b className="rl-n">{n(st?.fyi)}</b>
          <span>
            <em>FYI</em>
            <small>worth a glance, no reply</small>
          </span>
        </div>
        <div className="rl-node rl-out" data-k="noise" data-tone="faint">
          <b className="rl-n">{n(st?.noise)}</b>
          <span>
            <em>Noise today</em>
            <small>promos and receipts, left be</small>
          </span>
        </div>
      </div>
    </section>
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

/** One minute of Dialtone's cycle: a hand that sweeps round between checks, set from the last one. */
export function Heartbeat({ lastCheck, flow }: { lastCheck: number | null; flow: string }) {
  const since = useSince(lastCheck);
  // Set once per check: the hand's place in the minute, so the sweep (CSS) stays in step without re-rendering.
  const at = useMemo(() => (lastCheck === null ? 0 : ((Date.now() - lastCheck) / 1000) % 60), [lastCheck]);
  const on = since !== null && flow !== "off";
  return (
    <div className="rl-tile rl-heart" data-on={on ? "" : undefined} style={{ "--d": `${-at}s`, "--rot": `${(at / 60) * 360}deg` } as React.CSSProperties}>
      <span className="rl-heart-dial" aria-hidden="true">
        <i />
      </span>
      <div>
        <p className="wv-eyb">Every minute</p>
        <b className="rl-big">{since === null ? "—" : since < 60 ? `${since}s` : sinceText(since).replace(" ago", "")}</b>
        <small>{since === null ? "Dialtone hasn't checked yet" : "since Dialtone last looked"}</small>
      </div>
    </div>
  );
}

export { flowOf };
