import { useMemo, useRef, useState, type ReactNode } from "react";
import type { HistoryEntry, RoomId } from "../chronicle.ts";
import { CREW, type Change, type FoundryData } from "../foundry.ts";
import { useSystems, type LinkState } from "../systems.ts";
import { DayStory } from "./DayStory.tsx";
import { DESK_ROOMS, type DeskData } from "./deskData.ts";
import { ideaTitle } from "./IdeaCard.tsx";
import { Private } from "./Private.tsx";
import { link } from "./nav.ts";
import { ROOM_META } from "./roomPulse.ts";
import { dots, HOT, isPhone, knot, OK, Parts, Poly, RC, ring, RUN, smoothPts, spr, TAU, BAD, weave, WHITE, useViz, type VizSpec, frac, reducedMotion } from "./wvCanvas.ts";

/**
 * Today's "Not worth knowing now" (TodayMore.tsx loads it on demand; #336, #363): what's warm as two small thread
 * charts, and the short version of what happened as a calm timeline. The progress and bar charts are shared with the
 * Foundry page. Everything is drawn from the live feeds; a room or a link that isn't connected says so.
 */

const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/* ── Worth knowing now ── */

export type Seg = "ok" | "run" | "wait" | "bad";
const SEG_OF: Record<LinkState, Seg> = { ok: "ok", slow: "run", off: "wait", down: "bad" };

export function WorthKnowing({ data, owed }: { data: FoundryData; owed: number }) {
  const links = useSystems((s) => s.links);
  const state = (id: string): LinkState => links.find((l) => l.id === id)?.state ?? "off";
  const checks: [string, LinkState][] = [
    ["Checks", state("checks")],
    ["Browser tests", state("e2e")],
    ["Live site", state("live")],
  ];
  const red = checks.filter(([, s]) => s === "down");
  const running = checks.filter(([, s]) => s === "slow");
  const working = data.crates.filter((c) => c.kind !== "idea" && c.state === "working");
  const checksLine = red.length
    ? `${red.map(([n]) => n).join(" and ")} on main went red. Rivet is on it.`
    : running.length
      ? `${running.map(([n]) => n).join(" and ")} running on main now.${working[0] ? ` ${working.length === 1 ? "One job" : `${working.length} jobs`} on the bench.` : ""}`
      : checks.every(([, s]) => s === "off")
        ? "No check runs read from GitHub yet."
        : `Everything on main came back green.${working[0] ? ` ${working.length === 1 ? "One job is" : `${working.length} jobs are`} on the bench.` : ""}`;

  const mac = state("mac");
  const hub = state("hub");
  const relayLine =
    hub === "off" ? "Blasto can't start until the MacBook is awake, on power and online, with the hub running." : hub === "down" ? "The hub on the MacBook stopped answering. Replies wait until it's back." : owed ? `The hub is live. ${owed} ${owed === 1 ? "reply is" : "replies are"} waiting on you.` : "The hub is live and nobody is waiting on you.";

  const fire = red.length + (hub === "down" ? 1 : 0);
  const head = fire ? `${fire === 1 ? "One thing is" : `${fire} things are`} warmer than it should be.` : "Nothing's on fire. Two things are warm.";

  const progSpec = useMemo(() => progSpecOf(checks.map(([, s]) => SEG_OF[s])), [checks.map(([, s]) => s).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const chainSpec = useMemo(() => chainSpecOf([mac, hub, hub === "ok" ? "ok" : "off"]), [mac, hub]);

  return (
    <section className="wv-press" aria-label="Worth knowing now">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">Warm, not on fire</p>
          <h2 className="wv-h2">{head}</h2>
        </div>
      </div>
      <div className="wv-press-row">
        <PressCard room="foundry" k="Foundry, the checks on main" text={checksLine} spec={progSpec} labels={checks.map(([n]) => n)} bad={red.length > 0} href={data.checks.url ?? undefined} />
        <PressCard room="relay" ringDot={hub !== "ok"} k={hub === "ok" ? "Relay, live" : "Relay, whenever you're ready"} text={relayLine} spec={chainSpec} labels={["MacBook", "Hub", "Relay"]} />
      </div>
    </section>
  );
}

function PressCard({ room, k, text, spec, labels, ringDot, bad, href }: { room: string; k: string; text: ReactNode; spec: VizSpec; labels: string[]; ringDot?: boolean; bad?: boolean; href?: string }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);
  return (
    <div className={`wv-pr${bad ? " is-bad" : ""}`} data-room={room}>
      <p className="wv-pr-k">
        <i className={`wv-dot${ringDot ? " is-ring" : ""}`} />
        {k}
      </p>
      <p className="wv-pr-t">
        {text}
        {href && (
          <>
            {" "}
            <a className="wv-pr-a" href={href} target="_blank" rel="noreferrer">
              The run ↗
            </a>
          </>
        )}
      </p>
      <canvas ref={cv} className="wv-pr-cv" aria-hidden="true" />
      <p className="wv-pr-n">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </p>
    </div>
  );
}

export function progSpecOf(steps: Seg[]): VizSpec {
  let seg: { s: Seg; x0: number; x1: number; poly: Poly; P: Parts }[] = [];
  let y = 0;
  return {
    lay(V) {
      const n = steps.length;
      const gap = 6;
      const w = (V.W - gap * (n - 1)) / n;
      y = V.H / 2;
      seg = steps.map((s, i) => {
        const x0 = i * (w + gap);
        const x1 = x0 + w;
        return { s, x0, x1, poly: new Poly().set([x0 + 2, x1 - 2], [y, y]), P: new Parts(s === "wait" ? 0 : 36, 0) };
      });
    },
    draw(_V, c, t, dt) {
      for (const s of seg) {
        if (s.s === "wait") {
          dots(c, s.x0 + 2, y, s.x1 - 2, y, 4, 0.22);
          continue;
        }
        if (s.s === "ok" || s.s === "bad") {
          weave(c, s.poly, s.P, { a: 0.85, sp: 0.6, sz: 0.55, v: 10, line: 0.45, rgb: s.s === "ok" ? OK : BAD, nofade: true, lw: 1 }, t, dt);
          continue;
        }
        const hd = reducedMotion() ? 0.6 : frac(t * 0.35);
        weave(c, s.poly, s.P, { a: 1, sp: 1.2, sz: 0.65, v: 46, line: 0.14, rgb: RUN, I: (u) => 0.35 + 0.65 * Math.exp(-(((u - hd) / 0.18) ** 2)) }, t, dt);
        const p = s.poly.at(hd);
        knot(c, p.x, p.y, 0.45, t, RUN, 0.9);
      }
    },
  };
}

function chainSpecOf(states: LinkState[]): VizSpec {
  let xs: number[] = [];
  let y = 0;
  const poly = new Poly();
  const P = new Parts(22, 0);
  return {
    lay(V) {
      y = V.H / 2;
      xs = states.map((_, i) => 8 + ((V.W - 16) * i) / (states.length - 1));
      poly.set([xs[0]!, xs[xs.length - 1]!], [y, y]);
    },
    draw(_V, c, t, dt) {
      const rgb = RC.relay!;
      const live = states[1] === "ok";
      if (live) weave(c, poly, P, { a: 0.9, sp: 0.8, sz: 0.55, v: 24, rgb, rgb2: WHITE, line: 0.35 }, t, dt);
      else {
        c.globalAlpha = 1;
        c.strokeStyle = `rgba(${rgb},.4)`;
        c.lineWidth = 1;
        c.setLineDash([3, 5]);
        poly.stroke(c);
        c.setLineDash([]);
        for (let i = 0; i < P.n; i++) {
          const x = xs[0]! + 6 + Math.abs(P.o[i]!) * 16 + Math.sin(t * 1.3 + P.p[i]!) * 2;
          const yy = y + P.o[i]! * 3;
          c.globalAlpha = 0.35 + 0.4 * P.z[i]!;
          const sz = 1 + P.z[i]! * 1.6;
          c.drawImage(spr(rgb), x - sz, yy - sz, sz * 2, sz * 2);
        }
      }
      xs.forEach((x, i) => {
        const on = states[i] === "ok";
        ring(c, x, y, i ? 3.5 : 4.5 + 0.8 * Math.sin(t * 2), states[i] === "down" ? BAD : rgb, on || !i ? 0.9 : 0.45, on ? undefined : i ? [2, 2] : undefined);
      });
    },
  };
}

export function barSpecOf(parts: { f: number; rgb: string }[], big = false): VizSpec {
  let segs: { x1: number; rgb: string; str: { poly: Poly; P: Parts }[] }[] = [];
  let end = 0;
  return {
    lay(V) {
      let x = 2;
      const amp = V.H * (big ? 0.28 : 0.22);
      const y = V.H / 2;
      segs = [];
      for (const s of parts) {
        const w = Math.max(0, (V.W - 12) * Math.min(1, s.f));
        if (w < 1) continue;
        const str: { poly: Poly; P: Parts }[] = [];
        for (let k = 0; k < 3; k++) {
          const xs: number[] = [];
          const ys: number[] = [];
          const m = Math.max(8, Math.round(w / 6));
          for (let i = 0; i <= m; i++) {
            const u = i / m;
            xs.push(x + w * u);
            ys.push(y + Math.sin(u * TAU * Math.max(1, w / 70) + (k * TAU) / 3) * amp * (0.4 + 0.6 * Math.sin(Math.PI * u)));
          }
          str.push({ poly: new Poly().set(xs, ys), P: new Parts(Math.max(4, Math.round(w * (big ? 0.35 : 0.22))), 0.1) });
        }
        segs.push({ x1: x + w, rgb: s.rgb, str });
        x += w;
      }
      end = x;
    },
    draw(V, c, t, dt) {
      const y = V.H / 2;
      dots(c, end + 5, y, V.W - 3, y, 4, 0.2);
      ring(c, V.W - 4, y, 3, HOT, 0.5);
      for (const s of segs) {
        for (const q of s.str) weave(c, q.poly, q.P, { a: 0.95, sp: big ? 0.9 : 0.6, sz: big ? 0.6 : 0.5, v: big ? 22 : 14, line: 0.22, rgb: s.rgb, rgb2: WHITE, nofade: true }, t, dt);
        c.globalAlpha = 0.5;
        c.fillStyle = `rgba(${s.rgb},1)`;
        c.fillRect(s.x1 - 0.5, y - V.H * (big ? 0.36 : 0.3), 1, V.H * (big ? 0.72 : 0.6));
      }
      c.globalAlpha = 1;
    },
  };
}

/* ── The short version ── */

interface Moment {
  key: string;
  at: number | null;
  room: RoomId;
  pic: string;
  text: string;
  tag: string;
  /** A note from one of the rooms that carry Nikita's own life: veiled under Hide. */
  personal?: boolean;
}

const ROOM_OF_SCENE = (e: HistoryEntry): RoomId => e.scenes[0]?.room ?? "archive";

export function shortVersion({ data, changes, ilyr, awaySince }: { data: DeskData; changes: Change[]; ilyr: HistoryEntry[]; awaySince: number }): Moment[] {
  const out: Moment[] = [];
  for (const c of changes) {
    if (c.at <= awaySince) continue;
    const who = c.by ? CREW[c.by].name : "The crew";
    out.push({ key: c.key, at: c.at, room: "foundry", pic: `/desk/agent-${c.by ?? "ember"}.webp`, text: `${who} shipped “${ideaTitle(c.title)}”.`, tag: "Foundry, shipped" });
  }
  // The hub's own notes and the Foundry's red-checks note carry no time: they lead, as "earlier".
  for (const [i, n] of data.notes.entries()) {
    if (n.room === "foundry" && /shipped/.test(n.text)) continue;
    out.push({ key: `note-${i}`, at: null, room: n.room, pic: `/desk/agent-${DESK_ROOMS[n.room].lead}.webp`, text: n.text, tag: DESK_ROOMS[n.room].name, personal: n.room === "relay" || n.room === "spire" || n.room === "exchange" || n.room === "boiler" });
  }
  for (const e of ilyr.slice(-4)) {
    const room = ROOM_OF_SCENE(e);
    out.push({ key: `ilyr-${e.step}`, at: Date.parse(e.at), room, pic: `/desk/agent-${ROOM_META[room].submind.id}.webp`, text: e.summary, tag: `In Ilyr, ${ROOM_META[room].name}` });
  }
  return out.sort((a, b) => (b.at ?? Infinity) - (a.at ?? Infinity)).slice(0, 8);
}

export function ShortVersion({ moments, awaySince, now, storyDay, shipped }: { moments: Moment[]; awaySince: number; now: number; storyDay: string | null; shipped: number }) {
  const [read, setRead] = useState(false);
  const show = !read && moments.length > 0;
  return (
    <section className="wv-story" aria-label="What's been happening">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">What's been happening</p>
          <h2 className="wv-h2">{show ? "The short version" : "You're all caught up"}</h2>
        </div>
        <p className="wv-note">
          While you were away, {clock(awaySince)} to {clock(now)}
          {show && (
            <button
              type="button"
              className="wv-btn is-sm is-ghost wv-markread"
              onClick={() => setRead(true)}
            >
              Mark read
            </button>
          )}
        </p>
      </div>
      {show ? (
        <Moments moments={moments} />
      ) : (
        <p className="wv-allclear-line">
          {shipped ? `${shipped} shipped today; the Foundry tab has every one.` : `Nothing new since ${clock(awaySince)}.`}{" "}
          <a className="wv-link" href="/archive" onClick={link("archive")}>
            Read it in the Archive →
          </a>
        </p>
      )}
      {storyDay && <DayStory day={storyDay} canMake={false} compact label="Hear yesterday in Ilyr" />}
    </section>
  );
}

/** The moments on their thread, in a component of their own so the canvas mounts with the list. */
function Moments({ moments }: { moments: Moment[] }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const spec = useMemo(() => feedSpec(), []);
  useViz(cv, spec);
  return (
    <div className="wv-moments" role="list">
      <canvas ref={cv} className="wv-cv" aria-hidden="true" />
      {moments.map((m, i) => (
        <div key={m.key} role="listitem" className="wv-mo" data-room={m.room} style={{ "--i": i } as React.CSSProperties}>
          <time>{m.at ? clock(m.at) : "Earlier"}</time>
          <img src={m.pic} alt="" loading="lazy" />
          <div>
            <p>{m.personal ? <Private>{m.text}</Private> : m.text}</p>
            <span>
              <i className="wv-dot" />
              {m.tag}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function feedSpec(): VizSpec {
  let ks: { el: HTMLElement; x: number; y: number; rgb: string }[] = [];
  const poly = new Poly();
  const P = new Parts(160, 0);
  const nearest = (y: number) => {
    let b = ks[0]!;
    for (const k of ks) if (Math.abs(k.y - y) < Math.abs(b.y - y)) b = k;
    return b;
  };
  return {
    lay(V) {
      const rows = V.cv.parentElement?.querySelectorAll<HTMLElement>(".wv-mo") ?? [];
      const ph = isPhone(V.cv);
      ks = [];
      rows.forEach((el) => {
        const img = el.querySelector("img");
        if (!img) return;
        const r = V.rel(img);
        ks.push({ el, x: r.x - (ph ? 16 : 28), y: r.y + r.h / 2, rgb: RC[el.dataset.room ?? ""] ?? WHITE });
      });
      if (!ks.length) return;
      const x = ks[0]!.x;
      const px = [x];
      const py = [4];
      ks.forEach((k, i) => {
        if (i) {
          px.push(x + (i % 2 ? 5 : -5));
          py.push((ks[i - 1]!.y + k.y) / 2);
        }
        px.push(k.x);
        py.push(k.y);
      });
      px.push(x);
      py.push(V.H - 4);
      const [xs, ys] = smoothPts(px, py, 10);
      poly.set(xs, ys);
    },
    draw(_V, c, t, dt) {
      if (!ks.length) return;
      weave(c, poly, P, { a: 0.75, sp: 1.4, sz: 0.6, v: -20, line: 0.12, jit: 0.3, col: (_u, _x, y) => spr(nearest(y).rgb) }, t, dt);
      ks.forEach((k, i) => knot(c, k.x, k.y, (i === 0 ? 0.6 : 0.45) + (k.el.matches(":hover") ? 0.15 : 0), t, k.rgb, i === 0 ? 1 : 0.8));
    },
  };
}

