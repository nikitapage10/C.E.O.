import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Keeper } from "./parts.tsx";
import { SetupAsks } from "../skippy/SetupAsks.tsx";
import { reducedMotion, useViz } from "../wvCanvas.ts";
import {
  onBye,
  ordinal,
  pct,
  pts,
  sleeperLeagueUrl,
  startGreen,
  useGreen,
  yardLine,
  type GreenBid,
  type GreenBoard,
  type GreenCall,
  type GreenFeed,
  type GreenNews,
  type GreenPlayer,
  type GreenSlot,
  type GreenStatus,
} from "../green/league.ts";
import { useGreenAnalysis, type GreenAnalysis } from "../green/analysis.ts";
import { formation, makeStadium, modeFor, place, yardAt, type Mode, type StadiumData, type StadiumState, type Tok, type TokState } from "../green/stadium.ts";
import "@fontsource-variable/bodoni-moda/opsz.css";
import "@fontsource-variable/bodoni-moda/opsz-italic.css";
import "@fontsource-variable/jost/wght.css";
import "./rooms.css";
import "../green/green.css";

/**
 * The Green (#225, live since #252, an analyst desk since #276, its own stadium since #389): Nikita's Sleeper league,
 * "Horse Meat", as the broadcast's field-view of a stadium at night. The matchup is the scoreboard over the stands; the
 * starters of both teams stand as tokens on the turf in formation, each on a pool of floodlight haze that is his points
 * (bright motes rising are what he has scored, dim ones hanging are what FantasyPros still projects), and the line of
 * scrimmage sits at the win chance. New points flare their player and lift that side's crowd (green/stadium.ts).
 * Under the field: FantasyPros' start-or-sit calls as broadcast strips, each a duel of faces with its late-game-risk,
 * tiebreak, split and bye flags and why on a tap; then the stat rail, each stat opening one drawer: the full lineup
 * with FantasyPros' range, tier, rank move and roster share; the playoff race; the wire; one trade idea; the byes; the
 * table; the league's moves; the news; the Commentator's written call; and where every number came from.
 *
 * Read-only: the moves are made in Sleeper. Faces and logos are Sleeper's public images; a picture that doesn't load
 * falls back to initials. Barlow Condensed carries the numbers and names, Barlow the words, lime is the accent.
 * Nothing moves under prefers-reduced-motion.
 */

const INJ_WORD: Record<string, string> = {
  Q: "Questionable",
  D: "Doubtful",
  O: "Out",
  IR: "On IR",
  SUS: "Suspended",
  PUP: "PUP",
  NA: "Not active",
};

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
        <i
          style={{
            left: `${at(r.min)}%`,
            width: `${Math.max(1, at(r.max) - at(r.min))}%`,
          }}
        />
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

const fmtWhen = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Denver",
  }).format(Date.parse(iso));

/** The FantasyPros figure to show: its own number as published (#340), else the board's projection (form, or an older board). */
const fpPts = (p: GreenPlayer): number | null => (p.fp != null ? p.fp : p.proj);
/** Says when the projection the calls use differs from FantasyPros' own figure (doubtful, out, on bye). */
const fpTitle = (p: GreenPlayer): string | undefined =>
  p.fp != null && p.proj !== null && Math.abs(p.fp - p.proj) >= 0.05
    ? `FantasyPros ${p.fp.toFixed(1)}; ${p.proj.toFixed(1)} after ${p.inj === "D" ? "the doubtful tag" : "his status"}`
    : p.src === "form"
      ? "His form here: FantasyPros doesn't project him this week"
      : undefined;

/** Each element stagger-rises in by its index. */
const rise = (i: number) => ({ "--i": i }) as React.CSSProperties;

/** "Tyrone Tracy Jr." → "Tracy"; a defence keeps its name's last word ("D/ST"). */
const surname = (name: string) => {
  const w = name.split(/\s+/).filter((x) => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(x));
  return w[w.length - 1] ?? name;
};

/* ── the stadium: the scoreboard over the stands, the starters on the turf ── */

interface Man {
  tok: Tok;
  p: GreenPlayer | null;
  pts: number;
  mine: boolean;
  risk: boolean;
}

/** Both teams' starters as the stadium draws them: what each has scored, what FantasyPros still has him for, his mark. */
function lineups(board: GreenBoard | null): { mine: Man[]; theirs: Man[] } {
  if (!board) return { mine: [], theirs: [] };
  const m = board.matchup;
  const live = !!m?.live;
  const calls = board.calls ?? [];
  const outs = new Set(calls.filter((c) => c.change).map((c) => c.sit.id));
  const risks = new Set(calls.filter((c) => c.lateRisk).map((c) => c.sit.id));
  const man = (s: GreenSlot, i: number, mine: boolean): Man => {
    const p = s.player;
    const state: TokState = !p ? "empty" : onBye(p, board.week) ? "bye" : p.inj && ["O", "IR", "SUS"].includes(p.inj) ? "out" : mine && outs.has(p.id) ? "sit" : "";
    const scored = live ? Math.max(0, s.pts) : 0;
    const proj = p ? (fpPts(p) ?? p.sl ?? 0) : 0;
    return { tok: { id: p?.id ?? `${mine ? "m" : "t"}-${i}`, slot: s.slot, pos: p?.pos ?? s.slot, banked: scored, proj: Math.max(scored, proj), state }, p, pts: s.pts, mine, risk: !!p && risks.has(p.id) };
  };
  return {
    mine: board.roster.starters.map((s, i) => man(s, i, true)),
    theirs: (m?.them?.starters ?? []).map((s, i) => man(s, i, false)),
  };
}

const MARK_WORD: Record<TokState, string> = { "": "", sit: "FantasyPros sits him", bye: "on bye", out: "out", empty: "empty" };

function Token({ man, mode, along, across, live, week, i }: { man: Man; mode: Mode; along: number; across: number; live: boolean; week: number; i: number }) {
  const at = place(mode, along, across);
  const { p, tok, mine } = man;
  const shown = live ? man.pts : tok.proj;
  const what = p ? `${tok.slot} ${p.name}${tok.state ? `, ${tok.state === "out" && p.inj ? INJ_WORD[p.inj] : MARK_WORD[tok.state]}` : ""}: ${live ? `${pts(man.pts)} scored, ` : ""}FantasyPros ${pts(fpPts(p))}${man.risk ? " (late-game risk)" : ""}` : `${tok.slot}: empty`;
  return (
    <li
      className={`gd-tok ${mine ? "is-mine" : "is-theirs"}`}
      data-mark={tok.state || undefined}
      data-risk={man.risk || undefined}
      style={{ left: `${(at.x * 100).toFixed(2)}%`, top: `${(at.y * 100).toFixed(2)}%`, "--k": at.s.toFixed(3), "--d": `${i * 55}ms` } as React.CSSProperties}
      title={what}
    >
      <span className="gd-tok-in">
        {p ? <Face p={p} size={mine ? 42 : 34} /> : <span className="gd-face is-empty" style={{ "--s": `${mine ? 42 : 34}px` } as React.CSSProperties} />}
        <span className="gd-tok-t">
          <b>{p ? pts(shown) : "–"}</b>
          <small>
            <i>{/FLEX/.test(tok.slot) ? "FX" : tok.slot}</i>
            {p ? ` ${surname(p.name)}` : ""}
          </small>
        </span>
        {mine && tok.state === "sit" && <em className="gd-tok-mk">Sit</em>}
        {tok.state === "bye" && <em className="gd-tok-mk">Bye</em>}
        {tok.state === "out" && p?.inj && <em className="gd-tok-mk is-out">{p.inj}</em>}
        {!tok.state && p && onBye(p, week) && <em className="gd-tok-mk">Bye</em>}
      </span>
      <span className="gd-sr">{what}</span>
    </li>
  );
}

function Stadium({ board, status }: { board: GreenBoard | null; status: GreenStatus }) {
  const stage = useRef<HTMLElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>(() => (typeof window !== "undefined" ? modeFor(window.innerWidth) : "wide"));
  useEffect(() => {
    const on = () => setMode(modeFor(window.innerWidth));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const m = board?.matchup ?? null;
  const live = !!m?.live;
  const win = m?.win ?? null;
  const ups = useMemo(() => lineups(board), [board]);
  // Only what the light is drawn from: a fresh poll with the same numbers leaves the stadium alone.
  const key = JSON.stringify([live, win, ups.mine.map((x) => x.tok), ups.theirs.map((x) => x.tok)]);
  const data = useMemo<StadiumData>(() => ({ live, win, mine: ups.mine.map((x) => x.tok), theirs: ups.theirs.map((x) => x.tok) }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const S = useRef<StadiumState>({ data: null });
  const spec = useMemo(() => makeStadium(() => stage.current, S.current), []);
  const viz = useViz(cv, spec);
  useEffect(() => {
    S.current.data = board ? data : null;
    viz.current?.relayout();
  }, [data, board, mode, viz]);
  // The scores' width settles once the display face has loaded: lay the streams again then.
  useEffect(() => {
    void document.fonts?.ready.then(() => viz.current?.relayout());
  }, [viz]);

  const spotsMine = formation(
    ups.mine.map((x) => x.tok),
    "mine",
  );
  const spotsTheirs = formation(
    ups.theirs.map((x) => x.tok),
    "theirs",
  );
  const yd = win === null ? null : yardLine(win);
  // The line's label sits over the far sideline; on a phone the scoreboard above already says it.
  const los = win === null || mode === "tall" ? null : place(mode, yardAt(win * 100), 0);
  const them = m?.them ?? null;
  const mine = m ? (live ? m.me.pts : m.me.proj) : null;
  const theirs = m?.them ? (live ? m.them.pts : m.them.proj) : null;
  const why =
    status === "idle"
      ? "Reading the league…"
      : status === "failed"
        ? "Sleeper isn't answering. Trying again every two minutes."
        : status === "absent"
          ? "No team of yours in this league."
          : status === "off"
            ? "Not connected here."
            : `No game on the board in week ${board?.week ?? "–"}.`;
  const label = m ? `Week ${m.week}. Projected ${pts(m.me.proj)} to ${them ? pts(them.proj) : "a bye"}. Live ${pts(m.me.pts)} to ${them ? pts(them.pts) : "–"}.${win !== null ? ` Win chance ${pct(win)}.` : ""}` : why;

  return (
    <section ref={stage} className={`gd-stage is-${mode}${live ? " is-live" : ""}`} aria-label={`This week's matchup. ${label}`}>
      <canvas className="gd-cv" data-gd-field="" aria-hidden="true" />
      <canvas ref={cv} className="gd-cv" aria-hidden="true" />
      <div className="gd-board">
        <p className="gd-eyb">
          <span className="gd-eyb-hot">{m ? (live ? "Live" : "Kickoff to come") : "The Green"}</span>
          <i aria-hidden="true" />
          <span>{m ? `Week ${m.week}` : board ? `Week ${board.week}` : "Under the floodlights"}</span>
          {board && (
            <>
              <i aria-hidden="true" />
              <span>{board.league.name}</span>
            </>
          )}
        </p>
        {m ? (
          <div className="gd-sb" aria-hidden="true">
            <div className="gd-sb-side is-me">
              <b>{m.me.team}</b>
              <small>
                {m.me.record}
                {board?.me.rank ? ` · ${ordinal(board.me.rank)} of ${board.league.teams}` : ""}
              </small>
            </div>
            <b className="gd-sb-n is-me" data-gd-score="me">
              {pts(mine)}
            </b>
            <span className="gd-sb-mid">
              {win !== null ? (
                <>
                  <b>{pct(win)}</b>
                  <small>to win</small>
                </>
              ) : (
                <small>{them ? "versus" : "a bye"}</small>
              )}
            </span>
            <b className="gd-sb-n" data-gd-score="them">
              {them ? pts(theirs) : "–"}
            </b>
            <div className="gd-sb-side is-them">
              <b>{them?.team ?? "Bye week"}</b>
              <small>{them?.record ?? ""}</small>
            </div>
          </div>
        ) : (
          <p className="gd-sb-empty">{why}</p>
        )}
        {m && (
          <p className="gd-sb-sub" aria-hidden="true">
            {live ? `Projected ${pts(m.me.proj)} – ${them ? pts(them.proj) : "–"}` : "Projected · live from kickoff"}
            {yd && <> · {yd.words.toLowerCase()}</>}
          </p>
        )}
      </div>
      <div className="gd-pitch" data-gd-pitch="">
        {los && yd && (
          <span className="gd-los" style={{ left: `${(los.x * 100).toFixed(2)}%`, top: `${(los.y * 100).toFixed(2)}%` } as React.CSSProperties} aria-hidden="true">
            line of scrimmage · <b>{pct(win!)}</b>
          </span>
        )}
        {board && (
          <>
            <ol className="gd-turf" aria-label={`Your starters, ${board.me.team}`}>
              {ups.mine.map((x, i) => (
                <Token key={`m${i}`} man={x} mode={mode} along={spotsMine[i]!.along} across={spotsMine[i]!.across} live={live} week={board.week} i={i} />
              ))}
            </ol>
            {ups.theirs.length > 0 && (
              <ol className="gd-turf" aria-label={`Their starters, ${them?.team ?? ""}`}>
                {ups.theirs.map((x, i) => (
                  <Token key={`t${i}`} man={x} mode={mode} along={spotsTheirs[i]!.along} across={spotsTheirs[i]!.across} live={live} week={board.week} i={i + ups.mine.length} />
                ))}
              </ol>
            )}
          </>
        )}
      </div>
      {board && (
        <p className="gd-key" aria-hidden="true">
          <i className="is-line" /> each thread is a starter&rsquo;s points, running up into his team&rsquo;s score
          {live && (
            <>
              <i className="is-b" /> scored <i className="is-p" /> still projected
            </>
          )}
        </p>
      )}
    </section>
  );
}

/** The week's ledger: four plain figures under the rule, Today's readout in the Green's light. */
function Ledger({ board }: { board: GreenBoard }) {
  const m = board.matchup;
  const o = board.odds;
  return (
    <dl className="gd-ledger">
      <div className="is-hot">
        <dt>Win chance</dt>
        <dd>{m?.win != null ? pct(m.win) : "–"}</dd>
      </div>
      <div>
        <dt>Projected</dt>
        <dd>
          {m ? pts(m.me.proj) : "–"}
          {m?.them && <small> to {pts(m.them.proj)}</small>}
        </dd>
      </div>
      <div>
        <dt>In the table</dt>
        <dd>
          {board.me.rank ? ordinal(board.me.rank) : "–"}
          <small> of {board.league.teams}</small>
        </dd>
      </div>
      <div>
        <dt>Playoffs</dt>
        <dd>{o ? pct(o.playoff) : "–"}</dd>
      </div>
    </dl>
  );
}

/* ── the calls ── */

function Duelist({ p, week, role }: { p: GreenPlayer; week: number; role: "start" | "sit" }) {
  return (
    <span className={`gd-du is-${role}`}>
      <Face p={p} size={role === "start" ? 56 : 42} />
      <span className="gd-du-t">
        <small className="gd-du-role">{role === "start" ? "Start" : "Over"}</small>
        <b>{p.name}</b>
        <small>
          <Logo team={p.team} />
          {p.opp && <> v {p.opp}</>} <Tag p={p} week={week} />
        </small>
      </span>
      <strong title={fpTitle(p)}>{pts(fpPts(p))}</strong>
    </span>
  );
}

function CallRow({ c, week, fp, i, most }: { c: GreenCall; week: number; fp: boolean; i: number; most: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const sl = c.sleeper;
  const edge = Math.abs(c.edge);
  return (
    <li className={`gd-cl gd-rise${c.change ? " is-change" : ""}${c.lateRisk ? " is-risk" : ""}`} style={rise(i + 2)}>
      <span className="gd-cl-slot">
        <b>{c.slot}</b>
        <small>{c.change ? "Change" : "Keep"}</small>
      </span>
      <Duelist p={c.start} week={week} role="start" />
      <span className="gd-cl-edge" title={`${fp ? "FantasyPros" : "Form"} has the start ${pts(edge)} points ahead`}>
        <b>+{pts(edge)}</b>
        <i aria-hidden="true">
          <i style={{ width: `${Math.max(6, (edge / Math.max(most, 1)) * 100)}%` }} />
        </i>
        <small>{fp ? "FantasyPros" : "on form"}</small>
      </span>
      <Duelist p={c.sit} week={week} role="sit" />
      <span className="gd-cl-tail">
        <span className="gd-cl-flags">
          {c.lateRisk && (
            <em className="gd-flag is-risk" title={c.lateRisk}>
              Late-game risk
            </em>
          )}
          {c.tiebreak && <em className="gd-flag is-tie">Tiebreak</em>}
          {c.split && <em className="gd-flag is-split">Split</em>}
          <em className={`gd-flag is-sl is-${sl}`}>{sl === "unknown" ? "Sleeper: no projection" : `Sleeper ${sl}`}</em>
        </span>
        <button type="button" className="gd-why-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {open ? "Less" : "Why"}
        </button>
      </span>
      {open && (
        <div className="gd-cl-why" id={id}>
          <p>{c.why}</p>
          {c.lateRisk && <p className="is-risk">{c.lateRisk}</p>}
          {c.tiebreak && <p className="is-tie">{c.tiebreak}</p>}
          <p className="gd-cl-slnum">
            Sleeper projects {c.start.name} {pts(c.start.sl)} and {c.sit.name} {pts(c.sit.sl)}: beside the call, never averaged in.
          </p>
        </div>
      )}
    </li>
  );
}

function Calls({ board, onLineup }: { board: GreenBoard; onLineup: () => void }) {
  const calls = board.calls ?? [];
  const changes = calls.filter((c) => c.change).length;
  const risks = calls.filter((c) => c.lateRisk).length;
  const fp = board.sources.calls === "fp";
  const most = Math.max(...calls.map((c) => Math.abs(c.edge)), 1);
  return (
    <section className="gd-calls" aria-label="Start or sit">
      <header className="gd-calls-head gd-rise" style={rise(2)}>
        <h2 className="gd-h2">
          {changes ? (
            <>
              <em>{changes === 1 ? "One change" : `${changes} changes`}</em> to make
            </>
          ) : (
            "The lineup's set"
          )}
        </h2>
        <p className="gd-k">
          Start / sit · {fp ? "FantasyPros decides" : "form decides while FantasyPros waits"} · byes counted
        </p>
        <p className="gd-note">
          {calls.length ? `${calls.length} close call${calls.length === 1 ? "" : "s"}${risks ? `, ${risks} with a late-game risk` : ""}.` : "No close calls this week."}{" "}
          <button type="button" className="gd-link-btn" onClick={onLineup}>
            Full lineup and ranks
          </button>
        </p>
      </header>
      {calls.length > 0 && (
        <ol className="gd-cl-list">
          {calls.map((c, i) => (
            <CallRow key={`${c.slot}-${c.start.id}-${c.sit.id}`} c={c} week={board.week} fp={fp} i={i} most={most} />
          ))}
        </ol>
      )}
    </section>
  );
}

/* ── the lineup ── */

type RowCall = "start" | "sit" | "bye" | "out" | "";

function LineRow({ slot, p, live, week, call, tie = false, risk = false }: { slot: string; p: GreenPlayer | null; live: number | null; week: number; call: RowCall; tie?: boolean; risk?: boolean }) {
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
            {tie && <em className="gd-tag is-tie">TIEBREAK</em>}
            {risk && <em className="gd-tag is-tie">LATE-GAME RISK</em>}
          </small>
        </span>
      </td>
      <td className="gd-n is-fp">{live !== null && live !== 0 ? <span title="Live points so far">{pts(live)}</span> : <span title={fpTitle(p)}>{pts(fpPts(p))}</span>}</td>
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
  // The player a tiebreak put in his slot (#340): labelled, whether the call keeps him or brings him in.
  const ties = new Set((board.calls ?? []).filter((c) => c.tiebreak).map((c) => c.start.id));
  // Players a late-game-risk call (#370) moved: the Q/D starter going to the bench and the earlier-kicking bench player coming in.
  const risks = new Set((board.calls ?? []).filter((c) => c.lateRisk).flatMap((c) => [c.start.id, c.sit.id]));
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
              <LineRow key={i} slot={s.slot} p={s.player} live={s.pts} week={board.week} call={callOf(s.player, true)} tie={!!s.player && ties.has(s.player.id)} risk={!!s.player && risks.has(s.player.id)} />
            ))}
          </tbody>
          {open && (
            <tbody className="is-bench">
              {bench.map((p) => (
                <LineRow key={p.id} slot="BN" p={p} live={null} week={board.week} call={callOf(p, false)} tie={ties.has(p.id)} risk={risks.has(p.id)} />
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

/* ── the newsdesk (a drawer now, no longer a ticker) ── */

const WHOSE: Record<GreenNews["whose"], string> = {
  mine: "Yours",
  opp: "Theirs",
  league: "League",
  free: "Wire",
};
const ORDER: Record<GreenNews["whose"], number> = {
  mine: 0,
  opp: 1,
  free: 2,
  league: 3,
};

function News({ board, now }: { board: GreenBoard; now: number }) {
  const items = [...(board.news ?? [])].sort((a, b) => ORDER[a.whose] - ORDER[b.whose]);
  const team = (id: string) => (/^[A-Z]{2,3}$/.test(id) ? id : null);
  return (
    <section className="gd-sec gd-news" aria-label="League news">
      <p className="gd-k">Newsdesk · yours first</p>
      {items.length ? (
        <ol>
          {items.map((n, i) => (
            <li key={i} data-whose={n.whose}>
              {n.id ? (
                <Face
                  p={{
                    id: n.id,
                    name: n.name,
                    pos: team(n.id) ? "DEF" : "WR",
                    team: team(n.id),
                  }}
                  size={30}
                />
              ) : (
                <span className="gd-news-dot" aria-hidden="true" />
              )}
              <span>
                <em>{WHOSE[n.whose]}</em>
                <b>{n.name}</b> {n.text}
              </span>
              {n.at && <small>{ago(n.at, now)}</small>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="gd-note">Quiet: no news on anyone who matters to you.</p>
      )}
    </section>
  );
}

/* ── go deeper ── */

type DeepId = "lineup" | "odds" | "wire" | "trade" | "byes" | "table" | "moves" | "news" | "booth" | "sources";
interface Drawer {
  id: DeepId;
  k: string;
  stat: string;
  label: string;
  body: () => React.ReactNode;
}

function drawers(board: GreenBoard, now: number): Drawer[] {
  const starters = board.roster.starters.reduce((a, s) => a + (s.player ? (fpPts(s.player) ?? 0) : 0), 0);
  const o = board.odds;
  const bids = board.bids ?? [];
  const holes = (board.byeWeeks ?? []).filter((w) => w.holes.length).length;
  const feeds = board.feeds ?? [];
  const out: Drawer[] = [
    {
      id: "lineup",
      k: "Lineup and ranks",
      stat: pts(starters),
      label: "projected · range, tier, bench",
      body: () => <Lineup board={board} />,
    },
  ];
  if (o)
    out.push({
      id: "odds",
      k: "Playoff race",
      stat: pct(o.playoff),
      label: `top ${o.playoffTeams} · ${o.weeksLeft} week${o.weeksLeft === 1 ? "" : "s"} left`,
      body: () => <Odds board={board} />,
    });
  out.push({
    id: "wire",
    k: "The wire",
    stat: String(bids.length),
    label: `bid${bids.length === 1 ? "" : "s"} worth placing${board.me.faabLeft !== null ? ` · ${board.me.faabLeft} FAAB` : ""}`,
    body: () => <Waivers board={board} />,
  });
  out.push({
    id: "trade",
    k: "Trade idea",
    stat: board.trade ? "1" : "0",
    label: board.trade ? `with ${board.trade.team}` : "nothing lines up",
    body: () => <Trade board={board} />,
  });
  if (board.byeWeeks?.length)
    out.push({
      id: "byes",
      k: "Byes",
      stat: String(holes),
      label: `week${holes === 1 ? "" : "s"} short · next four`,
      body: () => <Byes board={board} />,
    });
  out.push({
    id: "table",
    k: "The table",
    stat: board.me.rank ? ordinal(board.me.rank) : "–",
    label: `of ${board.league.teams} · ${board.league.scoring}`,
    body: () => <Standings board={board} />,
  });
  if (board.moves?.length)
    out.push({
      id: "moves",
      k: "League moves",
      stat: String(board.moves.length),
      label: "claims, signings, trades",
      body: () => <Moves board={board} now={now} />,
    });
  out.push({
    id: "news",
    k: "Newsdesk",
    stat: String(board.news?.length ?? 0),
    label: "notes on the league",
    body: () => <News board={board} now={now} />,
  });
  out.push({
    id: "booth",
    k: "The booth",
    stat: "Tue",
    label: "the Commentator's written call",
    body: () => <Commentator now={now} />,
  });
  out.push({
    id: "sources",
    k: "Sources",
    stat: feeds.length ? `${feeds.filter((f) => f.state === "live").length}/${feeds.length}` : "1",
    label: "feeds live · where it comes from",
    body: () => <Sources board={board} now={now} />,
  });
  return out;
}

function Sources({ board, now }: { board: GreenBoard; now: number }) {
  return (
    <section className="gd-sec gd-sources" aria-label="Where the numbers come from">
      <p className="gd-k">Sources · how the board is put together</p>
      {board.feeds?.length ? <SourcesList feeds={board.feeds} now={now} /> : <p className="gd-note">Sleeper's public league data.</p>}
      <p className="gd-note">
        Read-only. FantasyPros makes the start/sit calls; Sleeper's projection sits beside it, never averaged. The win and playoff chances are worked out here from both teams' projections. Team and
        player names only; the Desk never makes a move in your league.
      </p>
    </section>
  );
}

/** The stat rail: one line of the broadcast's numbers, each opening its drawer underneath. */
function Deeper({ board, now, open, setOpen }: { board: GreenBoard; now: number; open: DeepId | null; setOpen: (d: DeepId | null) => void }) {
  const list = drawers(board, now);
  const cur = list.find((d) => d.id === open) ?? null;
  const panel = useRef<HTMLDivElement>(null);
  const base = useId();
  useEffect(() => {
    if (!open) return;
    const el = panel.current;
    if (!el || typeof el.getBoundingClientRect !== "function") return;
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.7)
      el.scrollIntoView({
        behavior: reducedMotion() ? "auto" : "smooth",
        block: "start",
      });
  }, [open]);
  return (
    <section className="gd-deep gd-rise" style={rise(7)} aria-label="Go deeper">
      <p className="gd-k">Go deeper · one drawer at a time</p>
      <ul className="gd-rail">
        {list.map((d) => (
          <li key={d.id}>
            <button type="button" id={`${base}-${d.id}`} className="gd-stat" aria-expanded={open === d.id} aria-controls={`${base}-panel`} onClick={() => setOpen(open === d.id ? null : d.id)}>
              <small>{d.k}</small>
              <b>{d.stat}</b>
              <span>{d.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <div ref={panel} id={`${base}-panel`} className="gd-drawer-wrap">
        {cur && (
          <div key={cur.id} className="gd-drawer" role="region" aria-labelledby={`${base}-${cur.id}`}>
            <button type="button" className="gd-drawer-x" onClick={() => setOpen(null)} aria-label={`Close ${cur.k}`}>
              ×
            </button>
            {cur.body()}
          </div>
        )}
      </div>
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
  const [open, setOpen] = useState<DeepId | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="wv-page rm rm-green gd" data-room="green">
      <Stadium board={board} status={status} />

      <header className="gd-chyron gd-rise" style={rise(1)}>
        <div>
          <p className="gd-eyb is-left">
            <span className="gd-eyb-hot">The Green</span>
            <i aria-hidden="true" />
            <span>{board ? `${board.league.name} · week ${board.week}` : "Under the floodlights"}</span>
          </p>
          <h1 className="gd-h1 desk__title">
            {board ? (
              <>
                {board.me.team}, <span className="gd-nowrap">{board.me.record}.</span> <em>{headline(board)}</em>
              </>
            ) : (
              <>
                The Green. <em>The lights are coming up.</em>
              </>
            )}
          </h1>
          {board && <Ledger board={board} />}
        </div>
        <Keeper page="green" className="gd-keeper" />
      </header>

      {board && (
        <>
          <Calls board={board} onLineup={() => setOpen("lineup")} />
          <Deeper board={board} now={now} open={open} setOpen={setOpen} />
        </>
      )}

      <SetupAsks room="green" />

      <p className="gd-foot">
        Read-only: the moves are made in{" "}
        {board ? (
          <a href={sleeperLeagueUrl(board)} target="_blank" rel="noopener noreferrer">
            Sleeper
          </a>
        ) : (
          "Sleeper"
        )}
        . Calls from FantasyPros, Sleeper's projection beside them.
        {board?.stale ? ` Sleeper isn't answering: this is the last good read, ${ago(board.at, now)}.` : ""}
        {!board && status === "ready" ? " Sleeper's public league data." : ""}
      </p>
    </div>
  );
}
