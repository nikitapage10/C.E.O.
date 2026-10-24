import { useEffect, useMemo, useRef, useState } from "react";
import { Private } from "../Private.tsx";
import { useDeskAuth } from "../signin.ts";
import { LATE_MS, linkOf, useEmail, type EmailLoad, type EmailStatus } from "../email/email.ts";
import { eInOut, RC, ring, spr, useViz, type VizSpec } from "../wvCanvas.ts";
import { itemsOf, RelayDash, type DashTab } from "./RelayDash.tsx";
import "@fontsource/michroma/400.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "./relay.css";

/**
 * Relay's receiver (#386, after #364 and #375; the Desk's page lanes, foundry/desk-identities.md): a radio receiver
 * with an oscilloscope screen, in the Messenger's blue. Channel 1 is line 1, Gmail: each new mail rides in as a wave
 * packet to Dialtone, the demodulator, who drops it down the bus onto its band (Need you, FYI or Handled) and it runs
 * out to that band's readout. Every mail still owed an answer stays on the Need you band as a waveform that pulses;
 * FYI keeps quieter ones; Handled runs a low, even trace. Channel 2, the texts, is not connected yet. Every count
 * is also written plainly in the readouts beside the traces. The ambient packets follow the real proportions while the line is live, and new mail the poll sees
 * goes first. Only the email agent's public counts and states feed the screen (api/_email/status.ts).
 *
 * Under the screen, the tuning dial: hover, focus or a first tap tunes a band and shows a small preview of what it
 * carries; a click (or a second tap) opens the band's sheet on the page (RelayDash). The mail itself is only there
 * when signed in, every word wrapped in <Private>; signed out, the preview and the sheet carry counts and a Sign in.
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

/** The most owed waveforms the Need you band draws; the readout carries the rest. */
const MAX_WAVES = 8;
const BLUE = RC.relay!;
const BRIGHT = "214,226,250";

interface Packet {
  /** 0 riding in on channel 1, 1 dropping down the bus, 2 running out on its band, 3 held at the demodulator. */
  ph: 0 | 1 | 2 | 3;
  x: number;
  y: number;
  /** Its band: 1 need you, 2 FYI, 3 handled. */
  to: number;
  t: number;
}
interface Row {
  y: number;
  x0: number;
  x1: number;
  out: HTMLElement | null;
}

export interface ScopeSpec extends VizSpec {
  counts: (owed: number, fyi: number, noise: number) => void;
  tune: (band: number) => void;
  /** New mail the poll just saw: one packet per entry (its band), ahead of the ambient ones. */
  ring: (to: number[]) => void;
}

/** The oscilloscope's traces, laid on the channel rows it finds by data-ch. `ptr` is the pointer over the screen. */
function scopeSpec(flow: Flow, ptr: { x: number; y: number; on: boolean }): ScopeSpec {
  const live = flow === "live" || flow === "slow";
  const sorting = flow === "live";
  let rows: Row[] = [];
  let split = 0;
  let pf: { x: number; y: number; el: HTMLElement | null } | null = null;
  let owed = 0;
  let fyi = 0;
  let noise = 0;
  let tuned = 1;
  let packets: Packet[] = [];
  let flares: { x: number; y: number; t0: number; r: number }[] = [];
  const queue: number[] = [];
  let spawn = 1.2;
  const xs = new Float32Array(1024);
  const ys = new Float32Array(1024);

  const pick = () => {
    const sum = owed + fyi + noise;
    if (!sum) return 1 + Math.floor(Math.random() * 3);
    const r = Math.random() * sum;
    return r < owed ? 1 : r < owed + fyi ? 2 : 3;
  };
  const pulseEl = (el: HTMLElement | null | undefined) => {
    if (!el || typeof el.animate !== "function") return;
    el.animate([{ textShadow: "0 0 0 rgba(125,159,226,0)" }, { textShadow: `0 0 18px rgba(${BLUE},.95)`, offset: 0.2 }, { textShadow: "0 0 0 rgba(125,159,226,0)" }], { duration: 1000, easing: "ease-out" });
  };
  /** A wave packet: a carrier under a bell-shaped envelope. */
  const burst = (dx: number, a: number, w: number, k: number, ph: number) => a * Math.exp(-(dx * dx) / (2 * w * w)) * Math.sin(dx * k - ph);

  function trace(c: CanvasRenderingContext2D, i: number, t: number) {
    const r = rows[i];
    if (!r) return;
    const from = i === 0 ? r.x0 : split;
    const to = i === 0 ? split : r.x1;
    if (to - from < 8) return;
    const n = Math.min(1023, Math.ceil((to - from) / 2));
    const span = to - from;
    const waves = i === 1 ? Math.min(MAX_WAVES, owed) : i === 2 ? Math.min(MAX_WAVES, fyi) : 0;
    const hum = i === 3 && live && noise ? 1.6 : 0;
    const near = ptr.on && Math.abs(ptr.y - r.y) < 28;
    for (let s = 0; s <= n; s++) {
      const x = from + (span * s) / n;
      let y = 0;
      if (i === 0 && live) y += Math.sin(x * 0.09 + t * 5) * 0.8;
      for (let w = 0; w < waves; w++) {
        const cx = from + ((w + 1) * span) / (waves + 1);
        const a = i === 1 ? 15 * (0.55 + 0.45 * Math.sin(t * 2.1 + w * 1.7)) : 7.5 * (0.7 + 0.3 * Math.sin(t * 1.1 + w * 2.3));
        y += burst(x - cx, a, i === 1 ? 9 : 8, 0.62, t * (i === 1 ? 9 : 5));
      }
      if (hum) y += Math.sin(x * 0.05 - t * 1.4) * hum;
      for (const p of packets) {
        if ((p.ph === 0 && i === 0) || (p.ph === 2 && p.to === i)) {
          const fade = p.ph === 2 ? 1 - Math.min(1, (p.x - split) / Math.max(1, r.x1 - split)) * 0.6 : 1;
          y += burst(x - p.x, 17 * fade, 11, 0.55, t * 16);
        }
      }
      if (near) y += burst(x - ptr.x, 6, 26, 0.3, t * 8);
      xs[s] = x;
      ys[s] = r.y - y;
    }
    const on = i === tuned || i === 0;
    const dim = live ? (on ? 1 : 0.55) : 0.35;
    c.lineJoin = "round";
    c.lineCap = "round";
    for (const [lw, a, rgb] of [
      [5, 0.09, BLUE],
      [2.2, 0.32, BLUE],
      [1.1, 0.95, BRIGHT],
    ] as const) {
      c.globalAlpha = a * dim;
      c.strokeStyle = `rgb(${rgb})`;
      c.lineWidth = lw;
      c.beginPath();
      c.moveTo(xs[0]!, ys[0]!);
      for (let s = 1; s <= n; s++) c.lineTo(xs[s]!, ys[s]!);
      c.stroke();
    }
  }

  return {
    counts(o, f, z) {
      owed = o;
      fyi = f;
      noise = z;
    },
    tune(b) {
      tuned = b;
    },
    ring(to) {
      if (!live) return;
      for (const b of to.slice(0, 4)) queue.push(b);
      spawn = Math.min(spawn, 0.1);
    },
    lay(V) {
      const host = V.cv.parentElement;
      if (!host) return;
      rows = [];
      host.querySelectorAll<HTMLElement>("[data-ch]").forEach((el) => {
        const b = V.rel(el);
        const l = el.querySelector(".rl-ch-l");
        const o = el.querySelector<HTMLElement>(".rl-ch-r");
        const lb = l ? V.rel(l) : null;
        const ob = o ? V.rel(o) : null;
        rows[Number(el.dataset.ch)] = { y: b.y + b.h / 2, x0: lb ? lb.x + lb.w + 18 : b.x, x1: ob ? ob.x - 14 : b.x + b.w, out: o?.querySelector("b") ?? null };
      });
      const d = host.querySelector<HTMLElement>('[data-k="pf"]');
      if (d) {
        const b = V.rel(d);
        pf = { x: b.x + b.w / 2, y: b.y + b.h / 2, el: d };
        split = pf.x;
      }
    },
    draw(_V, c, t, dt) {
      const r0 = rows[0];
      if (!r0 || !pf) return;
      if (dt > 0 && live) {
        spawn -= dt;
        if (spawn <= 0 && packets.length < 10) {
          const real = queue.length > 0;
          packets.push({ ph: 0, x: r0.x0, y: r0.y, to: real ? queue.shift()! : pick(), t: 0 });
          spawn = queue.length ? 0.35 : sorting ? 1.3 + Math.random() * 2.2 : 3.5 + Math.random() * 3;
        }
        for (const p of packets) {
          p.t += dt;
          if (p.ph === 0) {
            p.x += 300 * dt;
            if (p.x >= split) {
              flares.push({ x: pf.x, y: pf.y, t0: t, r: 26 });
              p.x = split;
              p.t = 0;
              p.ph = sorting ? 1 : 3;
            }
          } else if (p.ph === 1) {
            const k = Math.min(1, p.t / 0.38);
            const dst = rows[p.to];
            p.y = r0.y + ((dst?.y ?? r0.y) - r0.y) * eInOut(k);
            if (k >= 1) {
              p.ph = 2;
              p.t = 0;
              flares.push({ x: split, y: p.y, t0: t, r: 12 });
            }
          } else if (p.ph === 2) {
            p.x += 250 * dt;
            const dst = rows[p.to];
            if (dst && p.x >= dst.x1) {
              flares.push({ x: dst.x1, y: dst.y, t0: t, r: 16 });
              pulseEl(dst.out);
              p.t = 99;
            }
          }
        }
        packets = packets.filter((p) => !(p.ph === 2 && p.t >= 99) && !(p.ph === 3 && p.t > 4.5));
      }

      // The bus from the demodulator down to the bands.
      const last = rows[3] ?? r0;
      c.globalAlpha = live ? 0.28 : 0.14;
      c.strokeStyle = `rgb(${BLUE})`;
      c.lineWidth = 1;
      c.setLineDash([2, 4]);
      c.beginPath();
      c.moveTo(split, r0.y + 26);
      c.lineTo(split, last.y);
      c.stroke();
      c.setLineDash([]);
      for (let i = 1; i <= 3; i++) {
        const r = rows[i];
        if (!r) continue;
        c.globalAlpha = live ? 0.5 : 0.2;
        c.drawImage(spr(BLUE), split - 4, r.y - 4, 8, 8);
      }

      for (let i = 0; i <= 3; i++) trace(c, i, t);
      // Line 2 has no carrier: a dim dashed line.
      const r4 = rows[4];
      if (r4) {
        c.globalAlpha = 0.22;
        c.strokeStyle = `rgb(${BLUE})`;
        c.lineWidth = 1;
        c.setLineDash([3, 6]);
        c.beginPath();
        c.moveTo(r4.x0, r4.y);
        c.lineTo(r4.x1, r4.y);
        c.stroke();
        c.setLineDash([]);
      }

      // Packets dropping down the bus, and the ones held at the cap.
      for (const p of packets) {
        if (p.ph === 1) {
          for (let j = 0; j < 6; j++) {
            c.globalAlpha = 0.9 - j * 0.14;
            const s = 8 - j;
            c.drawImage(spr(BRIGHT), split - s, p.y - j * 5 * Math.sign((rows[p.to]?.y ?? 0) - r0.y) - s, s * 2, s * 2);
          }
        } else if (p.ph === 3) {
          const a = p.t * 2.4 + p.to;
          c.globalAlpha = Math.max(0, 0.8 - p.t / 6);
          c.drawImage(spr(BRIGHT), pf.x + Math.cos(a) * 34 - 4, pf.y + Math.sin(a) * 34 - 4, 8, 8);
        }
      }
      // Dialtone listening: a ring that breathes, quicker while a packet is with her.
      const busy = packets.some((p) => p.ph === 1 || p.ph === 3) ? 1 : 0;
      ring(c, pf.x, pf.y, 30 + Math.sin(t * (2 + busy * 4)) * 2, BLUE, live ? 0.35 + busy * 0.35 : 0.15);
      flares = flares.filter((f) => t - f.t0 < 0.8 && t >= f.t0);
      for (const f of flares) {
        const k = (t - f.t0) / 0.8;
        ring(c, f.x, f.y, f.r + k * 22, BRIGHT, 0.7 * (1 - k));
      }
      c.globalAlpha = 1;
    },
  };
}

const n = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString());

/** The hover preview on a tuned band: the first few, from the private list when signed in; the count otherwise. */
function Peek({ kind, count }: { kind: DashTab; count: number }) {
  const auth = useDeskAuth((s) => s.auth.status);
  const view = useEmail((s) => s.view);
  const items = itemsOf(view?.items, kind);
  const first = items.slice(0, 3);
  return (
    <span className="rl-peek" aria-hidden="true">
      <span className="rl-peek-h">{kind === "needs" ? "Needs you" : "For your information"}</span>
      {auth !== "in" ? (
        <span className="rl-peek-gate">{count === 1 ? "1 email" : `${count} emails`}. Sign in to see who.</span>
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
      <span className="rl-peek-cta">Click to open the list</span>
    </span>
  );
}

const STATIONS: { band: number; tab?: DashTab; label: string; cap: string }[] = [
  { band: 1, tab: "needs", label: "Need you", cap: "Blasto drafts advice for each" },
  { band: 2, tab: "fyi", label: "FYI", cap: "worth a glance, no reply" },
  { band: 3, label: "Handled", cap: "promos and receipts, left be" },
];
const POS = ["17%", "50%", "83%"];

export function Receiver({ load, status, now }: { load: EmailLoad; status: EmailStatus | null; now: number }) {
  const flow = flowOf(load, status);
  const live = flow === "live" || flow === "slow";
  const st = live ? status : null;
  const view = useEmail((s) => s.view);
  // Signed in, the bands follow the private list (what is still open); signed out, the public counts.
  const needsN = st ? (view ? itemsOf(view.items, "needs").length : st.needsYou) : undefined;
  const fyiN = st ? (view ? itemsOf(view.items, "fyi").length : st.fyi) : undefined;
  const ptr = useRef({ x: 0, y: 0, on: false });
  const spec = useMemo(() => scopeSpec(flow, ptr.current), [flow]);
  const cv = useRef<HTMLCanvasElement>(null);
  const vref = useViz(cv, spec);
  const [dash, setDash] = useState<DashTab | null>(null);
  const [tuned, setTuned] = useState(1);
  const [peek, setPeek] = useState<number | null>(null);
  const touch = useRef(false);

  useEffect(() => spec.counts(needsN ?? 0, fyiN ?? 0, st?.noise ?? 0), [spec, needsN, fyiN, st]);
  useEffect(() => spec.tune(tuned), [spec, tuned]);
  useEffect(() => vref.current?.relayout(), [vref, flow, needsN, fyiN]);

  // New mail since the last poll goes out first, one packet per mail (up to four), onto the band it was sorted to.
  const prev = useRef<EmailStatus | null>(null);
  useEffect(() => {
    const p = prev.current;
    prev.current = st;
    if (!p || !st || st.newToday <= p.newToday) return;
    const calls: number[] = [];
    for (let i = 0; i < Math.max(0, st.needsYou - p.needsYou); i++) calls.push(1);
    for (let i = 0; i < Math.max(0, st.fyi - p.fyi); i++) calls.push(2);
    while (calls.length < st.newToday - p.newToday) calls.push(3);
    spec.ring(calls);
  }, [spec, st]);

  // A tap elsewhere puts the preview away.
  useEffect(() => {
    if (peek === null) return;
    const off = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.(".rl-station")) setPeek(null);
    };
    document.addEventListener("pointerdown", off);
    return () => document.removeEventListener("pointerdown", off);
  }, [peek]);

  const trouble = syncTrouble(load, status, now);
  const gmailWord = load === "off" ? "on the Azure copy" : !status ? (load === "failed" ? "not answering" : "listening…") : status.gmail === "refused" ? "needs reconnecting" : status.gmail !== "connected" || status.agent === "waiting" ? "waiting to connect" : flow === "slow" ? "paused at the cap" : flow === "down" ? "one check missed" : "connected";
  const hubWord = flow === "live" ? "sorting each new mail" : flow === "slow" ? "paused at the cap" : flow === "down" ? "retrying" : "waiting";
  const pct = load === "live" && status && status.gmail === "connected" ? status.budgetPct : null;
  const vals = [needsN, fyiN, st?.noise];
  const bars = pct === null ? 0 : Math.round((Math.min(100, pct) / 100) * 12);

  const press = (i: number, tab: DashTab | undefined) => {
    setTuned(STATIONS[i]!.band);
    if (touch.current && peek !== i) {
      setPeek(i);
      return;
    }
    setPeek(null);
    if (tab && st) setDash(tab);
  };

  return (
    <>
      <section className="rl-rx" data-flow={flow} aria-label="Relay's receiver">
        <div
          className="rl-scope"
          onPointerMove={(e) => {
            const r = cv.current?.getBoundingClientRect();
            if (!r) return;
            ptr.current.x = e.clientX - r.left;
            ptr.current.y = e.clientY - r.top;
            ptr.current.on = e.pointerType !== "touch";
          }}
          onPointerLeave={() => (ptr.current.on = false)}
        >
          <i className="rl-grat" aria-hidden="true" />
          <canvas ref={cv} className="wv-cv" aria-hidden="true" />
          <span className="rl-demod" data-k="pf" aria-hidden="true">
            <img src="/desk/agent-dialtone.webp" alt="" width={48} height={48} decoding="async" />
          </span>
          <div className="rl-ch" data-ch="0">
            <span className="rl-ch-l">
              <i>CH 1 · in</i>
              <b>Gmail</b>
              <small>{gmailWord}</small>
            </span>
            <span className="rl-ch-r">
              <b>{n(st?.newToday)}</b>
              <small>in today</small>
            </span>
          </div>
          {STATIONS.map((s, i) => (
            <div key={s.band} className="rl-ch" data-ch={s.band} data-tuned={tuned === s.band ? "" : undefined}>
              <span className="rl-ch-l">
                <i>Band {s.band}</i>
                <b>{s.label}</b>
              </span>
              <span className="rl-ch-r">
                <b>{n(vals[i])}</b>
                <small>{i === 0 ? "owed a reply" : i === 1 ? "noted" : "today"}</small>
              </span>
            </div>
          ))}
          <div className="rl-ch is-dead" data-ch="4">
            <span className="rl-ch-l">
              <i>CH 2 · texts</i>
              <b>Not connected</b>
            </span>
            <span className="rl-ch-r">
              <small>awaiting the MacBook</small>
            </span>
          </div>
        </div>

        <div className="rl-meas">
          <span>
            <i>Sorting</i>
            <b>Dialtone</b> {hubWord}
          </span>
          <span className="rl-strength" title="This month's share of the email agent's model allowance">
            <i>Allowance</i>
            <span className="rl-bars" aria-hidden="true">
              {Array.from({ length: 12 }, (_, k) => (
                <s key={k} data-on={k < bars ? "" : undefined} />
              ))}
            </span>
            <b>{pct === null ? "—" : `${pct}%`}</b>
          </span>
          {trouble && (
            <span className="rl-fault" role="status">
              {trouble}
            </span>
          )}
        </div>

        <div className="rl-dial" style={{ "--tune": POS[tuned - 1] } as React.CSSProperties}>
          <i className="rl-dial-scale" aria-hidden="true" />
          <i className="rl-needle" aria-hidden="true" />
          {STATIONS.map((s, i) => {
            const v = vals[i];
            const opens = !!s.tab && !!st && v !== undefined;
            return (
              <button
                key={s.band}
                type="button"
                className={`rl-station${tuned === s.band ? " is-tuned" : ""}${peek === i ? " is-peek" : ""}`}
                style={{ left: POS[i] }}
                data-band={s.band}
                onPointerEnter={(e) => e.pointerType !== "touch" && setTuned(s.band)}
                onPointerDown={(e) => (touch.current = e.pointerType === "touch")}
                onFocus={() => setTuned(s.band)}
                onClick={() => press(i, s.tab)}
                aria-haspopup={opens ? "dialog" : undefined}
                aria-label={`${s.label}: ${n(v)}${opens ? ". Open the list" : ""}`}
              >
                <b>{n(v)}</b>
                <span>{s.label}</span>
                <small>{s.cap}</small>
                {opens && s.tab && <Peek kind={s.tab} count={v ?? 0} />}
              </button>
            );
          })}
        </div>
      </section>
      {dash && st && <RelayDash tab={dash} status={st} now={now} onTab={(t) => (setDash(t), setTuned(t === "needs" ? 1 : 2))} onClose={() => setDash(null)} />}
    </>
  );
}
