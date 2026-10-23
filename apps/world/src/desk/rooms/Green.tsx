import { useEffect, useMemo, useRef, useState } from "react";
import { Keeper } from "./parts.tsx";
import { AskedSkippy } from "../skippy/AskedSkippy.tsx";
import { RoomFeed } from "../skippy/RoomFeed.tsx";
import { SetupAsks } from "../skippy/SetupAsks.tsx";
import { Parts, Poly, OK, WHITE, knot, useViz, weave, type VizSpec } from "../wvCanvas.ts";
import { onBye, ordinal, pct, pts, sleeperLeagueUrl, startGreen, useGreen, type GreenBid, type GreenBoard, type GreenCall, type GreenFeed, type GreenNews, type GreenPlayer, type GreenSlot, type GreenStatus } from "../green/league.ts";
import { useGreenAnalysis, type GreenAnalysis } from "../green/analysis.ts";
import "./rooms.css";
import "../green/green.css";

/**
 * The Green (#225, live since #252, an analyst desk since #276): Nikita's Sleeper league, "Horse Meat", as a sports
 * broadcast desk. A ticker of the league's news; a score bug (projected, then live, then the win chance, with the
 * Weave's thread split where that chance falls); FantasyPros' start-or-sit calls with Sleeper's projection beside each
 * and split decisions flagged; the lineup with faces, team logos and FantasyPros' expert range, tier, rank move and
 * roster share; the Commentator's written call; then the whole league: playoff odds, the waiver bids, one trade idea,
 * the bye calendar, the table and the latest moves; and at the foot, where every number came from.
 *
 * Read-only: the moves are made in Sleeper. Faces and logos are Sleeper's public images; a picture that doesn't load
 * falls back to initials.
 */

const TURF = "172,200,114";
const INJ_WORD: Record<string, string> = { Q: "Questionable", D: "Doubtful", O: "Out", IR: "On IR", SUS: "Suspended", PUP: "PUP", NA: "Not active" };

/* ── faces and logos ── */

const initials = (name: string) =>
  name
    .replace(/[^A-Za-z .'-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export const faceUrl = (id: string) => (/^\d{1,8}$/.test(id) ? `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg` : null);
export const logoUrl = (team: string | null | undefined) => (team && /^[A-Z]{2,3}$/.test(team) ? `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png` : null);

/** A player's face (a defence's logo); initials underneath show when the picture can't load. */
function Face({ p, size = 34 }: { p: Pick<GreenPlayer, "id" | "name" | "pos" | "team">; size?: number }) {
  const [bad, setBad] = useState(false);
  const def = p.pos === "DEF";
  const src = def ? logoUrl(p.team ?? p.id) : faceUrl(p.id);
  return (
    <span className={`gd-face${def ? " is-def" : ""}`} style={{ "--s": `${size}px` } as React.CSSProperties} aria-hidden="true">
      <i>{def ? (p.team ?? p.id) : initials(p.name)}</i>
      {src && !bad && <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />}
    </span>
  );
}

function Logo({ team, size = 16 }: { team: string | null | undefined; size?: number }) {
  const [bad, setBad] = useState(false);
  const src = logoUrl(team);
  if (!src || bad) return team ? <span className="gd-tm">{team}</span> : null;
  return (
    <span className="gd-tm">
      <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
      {team}
    </span>
  );
}

/** A fantasy team's badge: its initials, no picture (managers' avatars are never read). */
const TeamBadge = ({ name, me = false }: { name: string; me?: boolean }) => (
  <span className={`gd-badge${me ? " is-me" : ""}`} aria-hidden="true">
    {initials(name)}
  </span>
);

function Tag({ p, week }: { p: GreenPlayer | null | undefined; week: number }) {
  if (onBye(p, week))
    return (
      <em className="gd-tag is-bye" title="On bye this week">
        BYE
      </em>
    );
  if (!p?.inj) return null;
  return (
    <em className={`gd-tag is-${p.inj === "Q" ? "q" : "out"}`} title={INJ_WORD[p.inj]}>
      {p.inj}
    </em>
  );
}

/** "▲3" / "▼2": his rest-of-season consensus move since last week. */
function Move({ d }: { d: number | null | undefined }) {
  if (d === null || d === undefined || d === 0) return <span className="gd-mv is-flat">–</span>;
  return (
    <span className={`gd-mv ${d > 0 ? "is-up" : "is-down"}`} title={`${d > 0 ? "Up" : "Down"} ${Math.abs(d)} in FantasyPros' rest-of-season consensus since last week`}>
      {d > 0 ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}

/** FantasyPros' experts this week: the best and worst rank any gave him, with the consensus marked. */
function Range({ p }: { p: GreenPlayer }) {
  const r = p.range;
  if (!r || !p.wk) return <span className="gd-rng is-none">–</span>;
  const top = Math.max(36, r.max + 4);
  const at = (n: number) => ((n - 1) / (top - 1)) * 100;
  return (
    <span className="gd-rng" title={`Experts ranked him ${p.pos}${r.min} at best and ${p.pos}${r.max} at worst; consensus ${p.pos}${p.wk}`}>
      <span className="gd-rng-bar">
        <i style={{ left: `${at(r.min)}%`, width: `${Math.max(1, at(r.max) - at(r.min))}%` }} />
        <b style={{ left: `${at(p.wk)}%` }} />
      </span>
      <small>
        {r.min}–{r.max}
      </small>
    </span>
  );
}

const ago = (iso: string | null | undefined, now: number): string => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 36 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

const fmtWhen = (iso: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Denver" }).format(Date.parse(iso));

/* ── the ticker ── */

const WHOSE: Record<GreenNews["whose"], string> = { mine: "YOURS", opp: "THEIRS", league: "LEAGUE", free: "WIRE" };

function Ticker({ board }: { board: GreenBoard }) {
  const items: GreenNews[] = board.news ?? [];
  const lines: GreenNews[] = items.length ? items : [{ id: null, name: board.league.name, text: `week ${board.week} · ${board.league.teams} teams · ${board.league.scoring}`, at: null, whose: "league", src: "sleeper" }];
  const loop = [...lines, ...lines];
  const team = (id: string) => (/^[A-Z]{2,3}$/.test(id) ? id : null);
  return (
    <div className="gd-ticker" aria-label={`League news: ${lines.map((n) => `${n.name}, ${n.text}`).join("; ")}`}>
      <span className="gd-ticker-k" aria-hidden="true">
        Newsdesk
      </span>
      <div className="gd-ticker-run" aria-hidden="true">
        <p style={{ "--n": lines.length } as React.CSSProperties}>
          {loop.map((n, i) => (
            <span key={i} data-whose={n.whose}>
              {n.id && <Face p={{ id: n.id, name: n.name, pos: team(n.id) ? "DEF" : "WR", team: team(n.id) }} size={20} />}
              <em>{WHOSE[n.whose]}</em>
              <b>{n.name}</b> {n.text}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

/* ── the score bug ── */

/** The win thread: your light from the left up to the win chance, theirs from the right, a knot where they meet. */
function winSpec(win: number | null): VizSpec {
  return {
    lay(V) {
      const y = V.H / 2;
      const f = win ?? 0.5;
      const x = V.W * f;
      V.s.w = { mine: new Poly().set([0, x], [y, y]), theirs: new Poly().set([V.W, x], [y, y]), x, y, Pm: new Parts(Math.max(8, Math.round(70 * f)), 0.15), Pt: new Parts(Math.max(8, Math.round(70 * (1 - f))), 0) };
    },
    draw(V, c, t, dt) {
      const w = V.s.w as { mine: Poly; theirs: Poly; x: number; y: number; Pm: Parts; Pt: Parts };
      if (win === null) {
        c.strokeStyle = "rgba(236,238,243,.12)";
        c.setLineDash([3, 5]);
        c.beginPath();
        c.moveTo(0, w.y);
        c.lineTo(V.W, w.y);
        c.stroke();
        c.setLineDash([]);
        return;
      }
      weave(c, w.mine, w.Pm, { a: 1, sp: 3, sz: 1, v: 34, rgb: TURF, rgb2: "236,240,220", line: 0.6, lw: 1.6 }, t, dt);
      weave(c, w.theirs, w.Pt, { a: 0.55, sp: 2, sz: 0.75, v: 24, rgb: WHITE, line: 0.22, lw: 1 }, t, dt);
      knot(c, w.x, w.y, 0.9, t, win >= 0.5 ? TURF : OK, 1);
    },
  };
}

function ScoreBug({ board, status }: { board: GreenBoard | null; status: GreenStatus }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const m = board?.matchup ?? null;
  const win = m?.win ?? null;
  const spec = useMemo(() => winSpec(win), [win]);
  useViz(cv, spec);
  if (!board || !m) {
    const why = status === "idle" ? "Reading the league…" : status === "failed" ? "Sleeper isn't answering. Trying again every two minutes." : status === "absent" ? "No team of yours in this league." : status === "off" ? "Not connected here." : `No game on the board in week ${board?.week ?? "–"}.`;
    return (
      <section className="gd-bug is-dark" aria-label="Scoreboard">
        <p className="gd-bug-empty">{why}</p>
        <canvas ref={cv} className="gd-bug-thread" aria-hidden="true" />
      </section>
    );
  }
  const them = m.them;
  const label = `Week ${m.week}. Projected ${pts(m.me.proj)} to ${them ? pts(them.proj) : "a bye"}. Live ${pts(m.me.pts)} to ${them ? pts(them.pts) : "–"}.${win !== null ? ` Win chance ${pct(win)}.` : ""}`;
  return (
    <section className="gd-bug" aria-label={label}>
      <div className="gd-bug-side is-me">
        <TeamBadge name={m.me.team} me />
        <span>
          <b>{m.me.team}</b>
          <small>
            {m.me.record}
            {board.me.rank ? ` · ${ordinal(board.me.rank)} of ${board.league.teams}` : ""}
          </small>
        </span>
      </div>
      <dl className="gd-bug-nums">
        <div className="is-proj">
          <dt>Projected</dt>
          <dd>
            <b>{pts(m.me.proj)}</b>
            <i>–</i>
            <b>{them ? pts(them.proj) : "–"}</b>
          </dd>
        </div>
        <div className={`is-live${m.live ? " is-on" : ""}`}>
          <dt>
            Live{!m.live && <small> · pre-game</small>}
          </dt>
          <dd>
            <b>{pts(m.me.pts)}</b>
            <i>–</i>
            <b>{them ? pts(them.pts) : "–"}</b>
          </dd>
        </div>
        <div className="is-win">
          <dt>Win</dt>
          <dd>
            <b>{win === null ? "–" : pct(win)}</b>
          </dd>
        </div>
      </dl>
      <div className="gd-bug-side is-them">
        <span>
          <b>{them?.team ?? "Bye week"}</b>
          <small>{them?.record ?? ""}</small>
        </span>
        {them && <TeamBadge name={them.team} />}
      </div>
      <canvas ref={cv} className="gd-bug-thread" aria-hidden="true" />
    </section>
  );
}

/* ── the calls ── */

function CallRow({ c, week }: { c: GreenCall; week: number }) {
  const sl = c.sleeper;
  return (
    <li className={`gd-call${c.change ? " is-change" : ""}${c.split ? " is-split" : ""}`}>
      <span className="gd-call-slot">{c.slot}</span>
      <span className="gd-call-p is-start">
        <Face p={c.start} size={40} />
        <span>
          <em>{c.change ? "Start" : "Keep"}</em>
          <b>{c.start.name}</b>
          <small>
            <Logo team={c.start.team} />
            {c.start.opp && <> v {c.start.opp}</>} <Tag p={c.start} week={week} />
          </small>
        </span>
        <strong>{pts(c.start.proj)}</strong>
      </span>
      <span className="gd-call-over" aria-hidden="true">
        over
      </span>
      <span className="gd-call-p is-sit">
        <Face p={c.sit} size={30} />
        <span>
          <b>{c.sit.name}</b>
          <small>
            <Logo team={c.sit.team} />
            {c.sit.opp && <> v {c.sit.opp}</>} <Tag p={c.sit} week={week} />
          </small>
        </span>
        <strong>{pts(c.sit.proj)}</strong>
      </span>
      <span className="gd-call-verdict">
        <span className="gd-chip is-fp">FP call +{pts(Math.abs(c.edge))}</span>
        <span className={`gd-chip is-sl is-${sl}`}>{sl === "unknown" ? "Sleeper: no projection" : `Sleeper ${sl} · ${pts(c.start.sl)}–${pts(c.sit.sl)}`}</span>
        {c.split && <span className="gd-chip is-split">Split decision</span>}
      </span>
      <small className="gd-call-why">
        {c.why}
        {c.tiebreak && <span className="gd-tiebreak">{c.tiebreak}</span>}
      </small>
    </li>
  );
}

function Calls({ board }: { board: GreenBoard }) {
  const calls = board.calls ?? [];
  const changes = calls.filter((c) => c.change).length;
  const splits = calls.filter((c) => c.split).length;
  const fp = board.sources.calls === "fp";
  return (
    <section className="gd-sec gd-calls" aria-label="Start or sit">
      <header className="gd-sh">
        <p className="gd-k">Start / sit · {fp ? "FantasyPros decides" : "form decides while FantasyPros waits"}</p>
        <h2 className="rm-h2">{changes ? `${changes === 1 ? "One change" : `${changes} changes`} to make` : "The lineup's set"}</h2>
        <p className="gd-note">
          {calls.length ? `${calls.length} close call${calls.length === 1 ? "" : "s"}${splits ? `, ${splits} split` : ""}. ` : "No close calls this week. "}
          Sleeper's projection sits beside each call, never averaged in.
        </p>
      </header>
      {calls.length > 0 && (
        <ol className="gd-call-list">
          {calls.map((c) => (
            <CallRow key={`${c.slot}-${c.start.id}-${c.sit.id}`} c={c} week={board.week} />
          ))}
        </ol>
      )}
    </section>
  );
}

/* ── the lineup ── */

type RowCall = "start" | "sit" | "bye" | "out" | "";

function LineRow({ slot, p, live, week, call }: { slot: string; p: GreenPlayer | null; live: number | null; week: number; call: RowCall }) {
  if (!p)
    return (
      <tr className="is-empty">
        <th scope="row">{slot}</th>
        <td colSpan={8}>Empty slot: fill it in Sleeper.</td>
      </tr>
    );
  return (
    <tr data-call={call || undefined}>
      <th scope="row">{slot}</th>
      <td className="gd-lp">
        <Face p={p} size={30} />
        <span>
          <b>{p.name}</b>
          <small>
            <Logo team={p.team} />
            {p.opp && <> v {p.opp}</>}
            {p.pos !== slot && slot !== "BN" && slot !== "IR" ? ` · ${p.pos}` : ""} <Tag p={p} week={week} />
            {call === "sit" && <em className="gd-tag is-sit">SIT</em>}
            {call === "start" && <em className="gd-tag is-start">START</em>}
          </small>
        </span>
      </td>
      <td className="gd-n is-fp">{live !== null && live !== 0 ? <span title="Live points so far">{pts(live)}</span> : pts(p.proj)}</td>
      <td className="gd-n is-sl">{p.sl === undefined ? "–" : pts(p.sl)}</td>
      <td className="gd-n">{p.wk ? `${p.pos}${p.wk}` : "–"}</td>
      <td>
        <Range p={p} />
      </td>
      <td className="gd-n">{p.tier ? `T${p.tier}` : "–"}</td>
      <td className="gd-n">
        <Move d={p.delta} />
      </td>
      <td className="gd-n">{p.own != null ? `${p.own}%` : "–"}</td>
    </tr>
  );
}

function Lineup({ board }: { board: GreenBoard }) {
  const [open, setOpen] = useState(false);
  const changes = (board.calls ?? []).filter((c) => c.change);
  const outs = new Set(changes.map((c) => c.sit.id));
  const ins = new Set(changes.map((c) => c.start.id));
  const callOf = (p: GreenPlayer | null, starting: boolean): RowCall => {
    if (!p) return "";
    if (onBye(p, board.week)) return "bye";
    if (p.inj && ["O", "IR", "SUS"].includes(p.inj)) return "out";
    if (starting && outs.has(p.id)) return "sit";
    if (!starting && ins.has(p.id)) return "start";
    return "";
  };
  const bench = board.roster.bench;
  const extra = bench.length + board.roster.reserve.length;
  return (
    <section className="gd-sec gd-lineup" aria-label="Your lineup">
      <header className="gd-sh is-row">
        <div>
          <p className="gd-k">The lineup · {board.me.team}</p>
          <h2 className="rm-h2">Starters</h2>
        </div>
        <p className="gd-legend">
          <span>
            <b>FP</b> FantasyPros
          </span>
          <span>
            <b>SLP</b> Sleeper
          </span>
          <span>
            <b>Range</b> experts' best–worst rank
          </span>
          <span>
            <b>ROS</b> rank move
          </span>
        </p>
      </header>
      <div className="gd-tbl-wrap">
        <table className="gd-tbl">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Player</th>
              <th scope="col" className="gd-n">
                FP
              </th>
              <th scope="col" className="gd-n">
                SLP
              </th>
              <th scope="col" className="gd-n">
                Rank
              </th>
              <th scope="col">Range</th>
              <th scope="col" className="gd-n">
                Tier
              </th>
              <th scope="col" className="gd-n">
                ROS
              </th>
              <th scope="col" className="gd-n">
                Rost
              </th>
            </tr>
          </thead>
          <tbody>
            {board.roster.starters.map((s: GreenSlot, i) => (
              <LineRow key={i} slot={s.slot} p={s.player} live={s.pts} week={board.week} call={callOf(s.player, true)} />
            ))}
          </tbody>
          {open && (
            <tbody className="is-bench">
              {bench.map((p) => (
                <LineRow key={p.id} slot="BN" p={p} live={null} week={board.week} call={callOf(p, false)} />
              ))}
              {board.roster.reserve.map((p) => (
                <LineRow key={p.id} slot="IR" p={p} live={null} week={board.week} call="" />
              ))}
            </tbody>
          )}
        </table>
      </div>
      {extra > 0 && (
        <button type="button" className="gd-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide the bench" : `Show the bench (${extra})`}
        </button>
      )}
    </section>
  );
}

/* ── the Commentator's call ── */

const feedWord = (f: GreenFeed, now: number) => (f.state === "live" ? (f.at ? ago(f.at, now) : "live") : f.state === "waiting" ? "waiting" : f.state === "failed" ? "unavailable" : "not used");

/** Each feed on one line: a light, its name, and when it was read (or why not); the detail on hover. */
function SourcesList({ feeds, now, compact = false }: { feeds: GreenFeed[]; now: number; compact?: boolean }) {
  return (
    <ul className={`gd-src${compact ? " is-compact" : ""}`}>
      {feeds.map((f) => (
        <li key={f.name} data-state={f.state} title={f.note}>
          <i aria-hidden="true" />
          <b>{f.name}</b>
          <span>
            {feedWord(f, now)}
            {!compact && f.note ? ` · ${f.note}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Commentator({ now }: { now: number }) {
  const status = useGreenAnalysis((s) => s.status);
  const a: GreenAnalysis | null = useGreenAnalysis((s) => s.analysis);
  const refreshAfter = useGreenAnalysis((s) => s.refreshAfter);
  const busy = useGreenAnalysis((s) => s.busy);
  const note = useGreenAnalysis((s) => s.note);
  useEffect(() => {
    void useGreenAnalysis.getState().load();
  }, []);
  const wait = refreshAfter !== null && refreshAfter > now ? Math.ceil((refreshAfter - now) / 60_000) : 0;
  return (
    <section className="gd-cc" aria-label="The Commentator's call">
      <header className="gd-cc-head">
        <img src="/desk/agent-turf.webp" alt="" width={44} height={44} decoding="async" />
        <div>
          <p className="gd-k">The Commentator's call</p>
          <p className="gd-cc-when">{a ? `Week ${a.week} · ${fmtWhen(a.at)} · ${a.trigger === "scheduled" ? "the Tuesday call" : "on request"}` : "Tuesdays 5:39pm Mountain, before waivers"}</p>
        </div>
        {status !== "off" && status !== "signed-out" && (
          <button type="button" className="gd-btn" onClick={() => void useGreenAnalysis.getState().refresh()} disabled={busy || wait > 0} title={wait > 0 ? `Next refresh in ${wait} min` : "Write a fresh one now"}>
            {busy ? "Writing…" : wait > 0 ? `Again in ${wait} min` : "Refresh"}
          </button>
        )}
      </header>
      {a ? (
        <>
          <h3 className="gd-cc-h">{a.headline}</h3>
          <dl className="gd-cc-secs">
            {a.sections.map((s) => (
              <div key={s.key} data-key={s.key}>
                <dt>{s.title}</dt>
                <dd>{s.text}</dd>
              </div>
            ))}
          </dl>
          {a.second.length > 0 && (
            <div className="gd-cc-second">
              <p className="gd-k">Second opinion on the splits · OpenAI</p>
              <ul>
                {a.second.map((s) => (
                  <li key={`${s.start}-${s.sit}`}>
                    <b>
                      {s.start} or {s.sit}:
                    </b>{" "}
                    {s.take}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <footer className="gd-cc-foot">
            <p className="gd-k">How I got this</p>
            <p className="gd-note">
              {a.writer === "claude"
                ? "Words by Claude Haiku from the board's numbers only; a line carrying a number that isn't in them is swapped for the plain numbers."
                : a.scripted === "capped"
                  ? "The month's Claude cap is reached, so this is the board's numbers said plainly."
                  : "The board's numbers said plainly; no model wrote these lines."}
            </p>
            <SourcesList feeds={a.sources} now={now} compact />
          </footer>
        </>
      ) : (
        <p className="gd-cc-empty">
          {status === "idle"
            ? "Fetching the latest call…"
            : status === "signed-out"
              ? "Sign in to the Desk to read the Commentator's call; it's for you only."
              : status === "off"
                ? "The Commentator's call isn't set up on this copy."
                : status === "failed"
                  ? "The call didn't load. Try again in a minute."
                  : "No call written yet. The next lands Tuesday at 5:39pm Mountain, or press Refresh."}
        </p>
      )}
      {note && (
        <p className="gd-note" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

/* ── the league ── */

function Odds({ board }: { board: GreenBoard }) {
  const o = board.odds;
  if (!o) return null;
  const max = Math.max(...o.seeds, 0.01);
  return (
    <section className="gd-sec gd-odds" aria-label="Playoff odds">
      <p className="gd-k">
        The playoff race · {o.weeksLeft} week{o.weeksLeft === 1 ? "" : "s"} left
      </p>
      <div className="gd-odds-big">
        <b>{pct(o.playoff)}</b>
        <span>
          to make the playoffs
          <small>
            top {o.playoffTeams} of {board.league.teams} · {o.sims.toLocaleString("en-US")} simulated seasons
          </small>
        </span>
      </div>
      <ol className="gd-seeds" aria-label="Chance of each seed">
        {o.seeds.map((s, i) => (
          <li key={i} title={`${ordinal(i + 1)} seed: ${pct(s)}`}>
            <em>{s >= 0.005 ? pct(s) : ""}</em>
            <i style={{ height: `${Math.max(3, (s / max) * 100)}%` }} />
            <small>{ordinal(i + 1)}</small>
          </li>
        ))}
      </ol>
      {o.swing.length > 0 && (
        <>
          <p className="gd-k gd-k2">Other games that matter</p>
          <ul className="gd-swing">
            {o.swing.map((s) => (
              <li key={`${s.a}-${s.b}`}>
                <span>
                  Root for <b>{s.root}</b> <small>v {s.root === s.a ? s.b : s.a}</small>
                </span>
                <em title={`Your playoff chance if ${s.root} wins, and if they lose`}>
                  {pct(s.ifWin)} <i>/</i> {pct(s.ifLose)}
                </em>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function BidRow({ b, faab }: { b: GreenBid; faab: boolean }) {
  return (
    <li className="gd-bid">
      <Face p={b.player} size={36} />
      <span className="gd-bid-p">
        <b>{b.player.name}</b>
        <small>
          {b.player.pos} · <Logo team={b.player.team} />
          {b.player.own != null && ` · ${b.player.own}% rostered`}
        </small>
        <span className="gd-bid-why">{b.why}</span>
        {b.drop && <span className="gd-bid-drop">Drop {b.drop.name}</span>}
      </span>
      {faab ? (
        <span className="gd-bid-n" title={`Suggested FAAB bid; ${b.low} to ${b.high} is the sensible range`}>
          <small>Bid</small>
          <b>{b.bid}</b>
          <small>
            {b.low}–{b.high}
          </small>
        </span>
      ) : (
        <span className="gd-bid-n">
          <b>Claim</b>
        </span>
      )}
    </li>
  );
}

function Waivers({ board }: { board: GreenBoard }) {
  const bids = board.bids ?? [];
  const faab = board.league.faab !== null;
  const paid = (board.moves ?? []).map((m) => m.bid).filter((b): b is number => b !== null && b > 0).sort((a, b) => a - b);
  const typical = paid.length ? paid[Math.floor((paid.length - 1) / 2)]! : null;
  return (
    <section className="gd-sec gd-wire" aria-label="Waiver bids">
      <p className="gd-k">The wire{faab && board.me.faabLeft !== null ? ` · ${board.me.faabLeft} of ${board.league.faab} FAAB left` : ""}</p>
      <h2 className="rm-h2">Bids worth placing</h2>
      <p className="gd-note">
        Priced against who else needs the position and what they can pay.{typical !== null ? ` Winning claims here lately: ${typical} in the middle.` : ""}
      </p>
      {bids.length ? (
        <ol>
          {bids.map((b) => (
            <BidRow key={b.player.id} b={b} faab={faab} />
          ))}
        </ol>
      ) : (
        <p className="gd-note">Nobody on the wire stands out today.</p>
      )}
      <a className="gd-link" href={sleeperLeagueUrl(board)} target="_blank" rel="noopener noreferrer">
        Make the moves in Sleeper
      </a>
    </section>
  );
}

function Trade({ board }: { board: GreenBoard }) {
  const t = board.trade;
  return (
    <section className="gd-sec gd-trade" aria-label="Trade idea">
      <p className="gd-k">One trade idea</p>
      {t ? (
        <>
          <div className="gd-trade-swap">
            <span>
              <small>You send</small>
              {t.give.map((p) => (
                <span key={p.id} className="gd-trade-p">
                  <Face p={p} size={34} />
                  <b>{p.name}</b>
                </span>
              ))}
            </span>
            <i aria-hidden="true">⇄</i>
            <span>
              <small>{t.team} sends</small>
              {t.get.map((p) => (
                <span key={p.id} className="gd-trade-p">
                  <Face p={p} size={34} />
                  <b>{p.name}</b>
                </span>
              ))}
            </span>
          </div>
          <p className="gd-note">{t.why}</p>
        </>
      ) : (
        <p className="gd-note">No trade lines up cleanly: nobody is deep where you're thin and thin where you're deep.</p>
      )}
    </section>
  );
}

function Byes({ board }: { board: GreenBoard }) {
  const weeks = board.byeWeeks ?? [];
  if (!weeks.length) return null;
  return (
    <section className="gd-sec gd-byes" aria-label="Bye calendar, next four weeks">
      <p className="gd-k">Bye calendar · next four weeks</p>
      <ol>
        {weeks.map((w) => (
          <li key={w.week} data-hole={w.holes.length ? "" : undefined}>
            <b>Wk {w.week}</b>
            <span className="gd-byes-out">
              {w.out.length ? (
                w.out.map((o) => (
                  <span key={o.id} title={`${o.name} (${o.pos}) on bye`}>
                    <Face p={{ ...o, team: null }} size={22} />
                  </span>
                ))
              ) : (
                <small>clear</small>
              )}
            </span>
            {w.holes.length > 0 ? <em>Short at {w.holes.join(", ")}</em> : w.out.length > 0 ? <small>covered</small> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Standings({ board }: { board: GreenBoard }) {
  const teams = board.teams ?? [];
  const byId = new Map(teams.map((t) => [t.rosterId, t]));
  const cut = board.odds?.playoffTeams ?? 0;
  return (
    <section className="gd-sec gd-table" aria-label="Standings">
      <p className="gd-k">
        {board.league.name} · {board.league.teams} teams · {board.league.scoring}
      </p>
      <h2 className="rm-h2">The table</h2>
      <table className="gd-tbl is-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Team</th>
            <th scope="col" className="gd-n">
              W-L
            </th>
            <th scope="col" className="gd-n">
              PF
            </th>
            {board.league.faab !== null && (
              <th scope="col" className="gd-n">
                FAAB
              </th>
            )}
            {board.odds && (
              <th scope="col" className="gd-n">
                Playoffs
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {board.standings.map((s, i) => {
            const t = byId.get(s.rosterId);
            return (
              <tr key={s.rosterId} className={`${s.me ? "is-me" : ""}${cut && i === cut - 1 ? " is-cut" : ""}`}>
                <td>{i + 1}</td>
                <td>
                  <span className="gd-team">
                    <TeamBadge name={s.team} me={s.me} />
                    <span>
                      {s.team}
                      {t && t.needs.length > 0 && <small>short at {t.needs.join(", ")}</small>}
                    </span>
                  </span>
                </td>
                <td className="gd-n">
                  {s.wins}-{s.losses}
                  {s.ties ? `-${s.ties}` : ""}
                </td>
                <td className="gd-n">{Math.round(s.pf)}</td>
                {board.league.faab !== null && <td className="gd-n">{t?.faab ?? "–"}</td>}
                {board.odds && <td className="gd-n">{t?.playoff != null ? pct(t.playoff) : "–"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const VERB: Record<string, string> = { waiver: "claimed", free_agent: "signed", trade: "traded for" };

function Moves({ board, now }: { board: GreenBoard; now: number }) {
  const moves = board.moves ?? [];
  if (!moves.length) return null;
  return (
    <section className="gd-sec gd-moves" aria-label="Latest league moves">
      <p className="gd-k">Latest moves in the league</p>
      <ol>
        {moves.slice(0, 8).map((m, i) => (
          <li key={i}>
            <span>
              <b>{m.team}</b> {m.adds.length ? `${VERB[m.kind]} ${m.adds.join(", ")}` : "dropped"}
              {m.bid !== null && <em> for {m.bid} FAAB</em>}
              {m.drops.length > 0 && <span className="gd-moves-drop">{m.adds.length ? " · dropped " : " "}{m.drops.join(", ")}</span>}
            </span>
            {m.at && <small>{ago(m.at, now)}</small>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── the page ── */

function headline(board: GreenBoard): string {
  const m = board.matchup;
  if (!m) return "No game this week.";
  if (!m.them) return "Bye week.";
  if (m.win === null) return "Kickoff pending.";
  const wins = Number(board.me.record.split("-")[0]);
  return m.win >= 0.5 ? `${pct(m.win)} to make it ${Number.isFinite(wins) ? wins + 1 : "one more"}.` : `${pct(m.win)} and a long field.`;
}

export function Green() {
  useEffect(() => startGreen(), []);
  const status = useGreen((s) => s.status);
  const board = useGreen((s) => s.board);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="wv-page rm rm-green gd" data-room="green">
      {board && <Ticker board={board} />}
      <header className="rm-head gd-head">
        <div>
          <p className="wv-eyb">The Green · {board ? `${board.league.name} · week ${board.week}` : "the analyst desk"}</p>
          <h1 className="wv-h1 desk__title gd-h1">
            {board ? (
              <>
                {board.me.team}, <span className="gd-nowrap">{board.me.record}.</span> <em>{headline(board)}</em>
              </>
            ) : (
              <>
                The desk is <em>warming up.</em>
              </>
            )}
          </h1>
        </div>
        <Keeper page="green" />
      </header>

      <ScoreBug board={board} status={status} />

      {board && (
        <>
          <div className="gd-desk">
            <div className="gd-main">
              <Calls board={board} />
              <Lineup board={board} />
            </div>
            <aside className="gd-rail">
              <Commentator now={now} />
            </aside>
          </div>
          <div className="gd-league">
            <Odds board={board} />
            <Waivers board={board} />
            <div className="gd-stack">
              <Trade board={board} />
              <Byes board={board} />
            </div>
          </div>
          <div className="gd-league is-two">
            <Standings board={board} />
            <Moves board={board} now={now} />
          </div>
        </>
      )}

      <AskedSkippy room="green" />
      <SetupAsks room="green" />
      <RoomFeed room="green" />

      <footer className="gd-sources" aria-label="Where the numbers come from">
        <p className="gd-k">Sources · how the board is put together</p>
        {board?.feeds?.length ? <SourcesList feeds={board.feeds} now={now} /> : <p className="gd-note">{status === "ready" ? "Sleeper's public league data." : "Waiting for the league."}</p>}
        <p className="gd-note">
          Read-only. FantasyPros makes the start/sit calls; Sleeper's projection sits beside it, never averaged. The win and playoff chances are worked out here from both teams' projections. Team and
          player names only; the Desk never makes a move in your league.
          {board?.stale ? ` Sleeper isn't answering: this is the last good read, ${ago(board.at, now)}.` : ""}
        </p>
      </footer>
    </div>
  );
}
