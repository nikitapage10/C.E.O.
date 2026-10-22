import { useEffect, useMemo, useRef } from "react";
import { Keeper, Waits, type Wait } from "./parts.tsx";
import { AskedSkippy } from "../skippy/AskedSkippy.tsx";
import { Parts, Poly, TAU, useViz, weave, type VizSpec } from "../wvCanvas.ts";
import { callsWord, commentatorCall, fpLine, onBye, ordinal, pct, pts, sleeperLeagueUrl, startGreen, useGreen, yardLine, type GreenBoard, type GreenPlayer, type GreenSlot, type GreenStatus, type GreenSwap } from "../green/league.ts";
import "./rooms.css";
import "../green/green.css";

/**
 * The Green (#225, live since #252): Nikita's Sleeper league, "Horse Meat", as a floodlit pitch at night. The scoreboard
 * carries this week's matchup and the win chance, with the ball placed on the field where that chance puts it; then the
 * matchup slot by slot, the lineup as cards that turn over to a start-or-sit call, the booth's calls, the waiver wire
 * with who to cut, and the table. Read from Sleeper's public API (and FantasyPros' projections and rankings where its
 * key is set, on Azure) by /api/green-league; read-only, so every move links out to Sleeper.
 */

const TURF = "172,200,114";

const INJ_WORD: Record<string, string> = { Q: "Questionable", D: "Doubtful", O: "Out", IR: "On IR", SUS: "Suspended", PUP: "PUP", NA: "Not active" };

/** The pitch: yard lines as threads under two floodlights, motes drifting in the light. */
function pitchSpec(): VizSpec {
  return {
    lay(V) {
      const lines: { p: Poly; P: Parts }[] = [];
      const n = 11;
      for (let i = 0; i < n; i++) {
        const x = (V.W * (i + 0.5)) / n;
        const lean = (x - V.W / 2) * 0.18;
        lines.push({ p: new Poly().set([x - lean, x + lean * 0.4], [0, V.H]), P: new Parts(i === 5 ? 40 : 12, 0.1) });
      }
      V.s.g = { lines };
    },
    draw(V, c, t, dt) {
      const { lines } = V.s.g as { lines: { p: Poly; P: Parts }[] };
      for (const [x, s] of [
        [V.W * 0.08, 1],
        [V.W * 0.92, -1],
      ] as const) {
        const g = c.createRadialGradient(x, -20, 0, x, -20, V.H * 1.3);
        g.addColorStop(0, "rgba(236,240,220,.16)");
        g.addColorStop(0.5, "rgba(172,200,114,.05)");
        g.addColorStop(1, "rgba(172,200,114,0)");
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x, -20);
        c.lineTo(x + s * V.W * 0.62, V.H);
        c.lineTo(x + s * V.W * 0.08, V.H);
        c.closePath();
        c.globalAlpha = 0.8 + 0.2 * Math.sin(t * 0.6 + s);
        c.fill();
        c.globalAlpha = 1;
      }
      lines.forEach((l, i) => weave(c, l.p, l.P, { a: i === 5 ? 0.6 : 0.3, sp: 0.5, sz: 0.6, v: 6 + (i % 3) * 3, rgb: TURF, rgb2: "236,240,220", line: i === 5 ? 0.22 : 0.09 }, t, dt));
      c.strokeStyle = `rgba(${TURF},.16)`;
      c.lineWidth = 0.8;
      c.beginPath();
      c.ellipse(V.W / 2, V.H * 0.55, V.W * 0.08, V.H * 0.2, 0, 0, TAU);
      c.stroke();
    },
  };
}

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s) || s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** A player's tag: BYE when his team has no game this week, else his injury word. */
function InjTag({ p, week }: { p: GreenPlayer | null | undefined; week: number }) {
  if (onBye(p, week))
    return (
      <span className="gl-inj is-bye" title="On bye this week: no game">
        BYE
      </span>
    );
  if (!p?.inj) return null;
  return (
    <span className={`gl-inj is-${p.inj === "Q" ? "q" : "out"}`} title={INJ_WORD[p.inj]}>
      {p.inj}
    </span>
  );
}

const srcWord = (p: GreenPlayer) => (p.src === "fp" ? `FantasyPros projection${p.wk ? ` · #${p.wk} at ${p.pos} this week` : ""}` : p.src === "form" ? "Projected from his scores here" : "No projection yet");

/** The scoreboard: lit with the matchup, or dark with why. */
function Scoreboard({ board, status }: { board: GreenBoard | null; status: GreenStatus }) {
  const m = board?.matchup ?? null;
  if (!board || !m) {
    const why = status === "idle" ? "Reading the league…" : status === "failed" ? "Sleeper isn't answering. Trying again every two minutes." : status === "absent" ? "No team of yours in this league." : status === "off" ? "Not connected here." : "No game on the board this week.";
    return (
      <>
        <div className="gr-board" role="img" aria-label={`Scoreboard: ${why}`}>
          <div className="gr-side">
            <span>You</span>
            <b>--</b>
          </div>
          <div className="gr-mid">
            <span>Week</span>
            <b>{board ? board.week : "--"}</b>
            <em>Win chance --%</em>
          </div>
          <div className="gr-side">
            <span>Them</span>
            <b>--</b>
          </div>
        </div>
        <p className="gr-pitch-note">{why}</p>
      </>
    );
  }
  const show = (s: { pts: number; proj: number }) => (m.live ? s.pts : s.proj);
  const ball = m.win === null ? null : yardLine(m.win);
  return (
    <div className="gl-pitch-in">
      <div className="gr-board gl-lit" role="img" aria-label={`Week ${m.week}: ${m.me.team} ${m.live ? "" : "projected "}${pts(show(m.me))}, ${m.them ? `${m.them.team} ${pts(show(m.them))}` : "a bye"}${m.win !== null ? `. Win chance ${pct(m.win)}` : ""}.`}>
        <div className="gr-side">
          <span title={m.me.team}>{m.me.team}</span>
          <b>{pts(show(m.me))}</b>
          <i>{m.me.record}</i>
        </div>
        <div className="gr-mid">
          <span>{m.live ? "Live" : "Week"}</span>
          <b>{m.week}</b>
          <em>Win {m.win === null ? "--" : pct(m.win)}</em>
        </div>
        <div className="gr-side">
          <span title={m.them?.team}>{m.them?.team ?? "Bye"}</span>
          <b>{m.them ? pts(show(m.them)) : "--"}</b>
          <i>{m.them?.record ?? ""}</i>
        </div>
      </div>
      {ball && (
        <div className="gl-field" aria-hidden="true">
          <div className="gl-field-track">
            {Array.from({ length: 9 }, (_, i) => (
              <i key={i} style={{ left: `${(i + 1) * 10}%` }} data-yd={i < 5 ? (i + 1) * 10 : (9 - i) * 10} />
            ))}
            <b style={{ left: `${ball.x * 100}%` }} />
          </div>
          <p>
            {ball.words} · {m.live ? "live" : "projected"} {pts(show(m.me))} to {m.them ? pts(show(m.them)) : "--"}
          </p>
        </div>
      )}
    </div>
  );
}

/** The matchup, slot by slot: who has the edge where. */
function HeadToHead({ board }: { board: GreenBoard }) {
  const m = board.matchup;
  if (!m?.them) return null;
  const them = m.them;
  const val = (s: GreenSlot | null | undefined) => (s?.player ? (m.live && s.pts !== 0 ? s.pts : (s.player.proj ?? 0)) : 0);
  return (
    <section className="gl-h2h" aria-label="This week's matchup, slot by slot">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">Week {m.week} · head to head</p>
          <h2 className="wv-h2">
            {m.me.team} <em>v</em> {them.team}
          </h2>
        </div>
        <p className="wv-note">{m.live ? "Live points where a game has kicked off, projections for the rest." : "Projected points, slot by slot. The bar leans to whoever has the edge."}</p>
      </div>
      <ol>
        {m.me.starters.map((a, i) => {
          const b = them.starters[i];
          const va = val(a);
          const vb = val(b);
          const lean = va + vb > 0 ? (va - vb) / Math.max(va, vb, 1) : 0;
          return (
            <li key={i} data-edge={lean > 0.05 ? "me" : lean < -0.05 ? "them" : "even"}>
              <span className="gl-h-me">
                <b>{a.player?.name ?? "Empty"}</b>
                <small>
                  {a.player?.team ?? ""} <InjTag p={a.player} week={board.week} />
                </small>
              </span>
              <span className="gl-h-v">{pts(va)}</span>
              <span className="gl-h-slot">
                <em>{a.slot}</em>
                <i className="gl-edge" style={{ "--lean": lean.toFixed(3) } as React.CSSProperties} />
              </span>
              <span className="gl-h-v">{pts(vb)}</span>
              <span className="gl-h-them">
                <b>{b?.player?.name ?? "Empty"}</b>
                <small>
                  {b?.player?.team ?? ""} <InjTag p={b?.player} week={board.week} />
                </small>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="gl-h-tot">
        <span>{pts(m.live ? m.me.pts : m.me.proj)}</span>
        <em>{m.live ? "so far" : "projected"}</em>
        <span>{pts(m.live ? them.pts : them.proj)}</span>
      </p>
    </section>
  );
}

/** The lineup as cards: the front is the player, the back the booth's call on him. */
function Lineup({ board }: { board: GreenBoard }) {
  const outFor = new Map(board.swaps.filter((s) => s.out).map((s) => [s.out!.id, s]));
  const inFor = new Set(board.swaps.map((s) => s.in.id));
  return (
    <section className="gr-lineup gl-lineup" aria-label="Your lineup">
      <div className="wv-sechead">
        <div>
          <p className="wv-eyb">Start or sit · {board.me.team}</p>
          <h2 className="wv-h2">The lineup, card by card</h2>
        </div>
        <p className="wv-note">
          {callsWord(board)}. Turn a card over (hover or tap) for the call and why.
        </p>
      </div>
      <ul style={{ "--n": board.roster.starters.length } as React.CSSProperties}>
        {board.roster.starters.map((s, i) => {
          const p = s.player;
          const sw = p ? outFor.get(p.id) : undefined;
          const bye = onBye(p, board.week);
          const call = !p ? "EMPTY" : sw ? "SIT" : bye ? "BYE" : p.inj && p.inj !== "Q" ? "RISK" : "START";
          return (
            <li key={i} tabIndex={0} aria-label={p ? `${s.slot}: ${p.name}, projected ${pts(p.proj)}. Call: ${call}${sw ? `, start ${sw.in.name} instead` : ""}.` : `${s.slot}: empty`} data-call={call.toLowerCase()}>
              <span className="gr-card">
                <span className="gr-front gl-front">
                  <em>{s.slot}</em>
                  <strong>{pts(p?.proj)}</strong>
                  <b>{p?.name ?? "Empty slot"}</b>
                  <small>
                    {p?.team ?? ""}
                    {p && p.pos !== s.slot ? ` · ${p.pos}` : ""} <InjTag p={p} week={board.week} />
                  </small>
                </span>
                <span className="gr-back gl-back">
                  <em className="gl-call">{call}</em>
                  {sw ? (
                    <span>
                      Start {sw.in.name} ({pts(sw.in.proj)}): {sw.why}.
                    </span>
                  ) : p && bye ? (
                    <span>On bye this week, and nobody on the bench fits the slot. Sit him in Sleeper.</span>
                  ) : p ? (
                    <span>
                      {p.inj ? `${INJ_WORD[p.inj]}. ` : ""}
                      {p.avg !== null ? `${pts(p.avg)} a game here, ${pts(p.last)} last time.` : "No games for a team here yet."}
                      {p.posRank ? ` FantasyPros ${p.posRank}.` : ""}
                    </span>
                  ) : (
                    <span>Fill this slot in Sleeper.</span>
                  )}
                  {p && <small>{srcWord(p)}</small>}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {board.roster.bench.length + board.roster.reserve.length > 0 && (
        <div className="gl-bench">
          <p className="gl-k">On the bench</p>
          <ul>
            {board.roster.bench.map((p) => (
              <li key={p.id} className={inFor.has(p.id) ? "is-in" : ""}>
                <span>
                  <b>{p.name}</b> <small>{p.pos} · {p.team ?? "FA"}</small> <InjTag p={p} week={board.week} />
                </span>
                <em>{inFor.has(p.id) ? `START · ${pts(p.proj)}` : pts(p.proj)}</em>
              </li>
            ))}
            {board.roster.reserve.map((p) => (
              <li key={p.id} className="is-ir">
                <span>
                  <b>{p.name}</b> <small>{p.pos} · {p.team ?? "FA"}</small> <InjTag p={p} week={board.week} />
                </span>
                <em>IR</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Calls({ board }: { board: GreenBoard }) {
  const swaps: GreenSwap[] = board.swaps;
  return (
    <section className="gl-calls" aria-label="Calls from the booth">
      <p className="wv-eyb">
        Calls from the booth · <span data-src={board.sources.calls}>{callsWord(board)}</span>
      </p>
      <h2 className="rm-h2">{swaps.length ? `${swaps.length === 1 ? "One change" : `${swaps.length} changes`} worth making` : "The lineup's set"}</h2>
      {swaps.length ? (
        <ol>
          {swaps.map((s) => (
            <li key={s.in.id}>
              <span className="gl-swap">
                <b>{s.in.name}</b>
                <i aria-hidden="true">in at</i>
                <em>{s.slot}</em>
                {s.out && (
                  <>
                    <i aria-hidden="true">for</i>
                    <s>{s.out.name}</s>
                  </>
                )}
              </span>
              <span className="gl-gain">+{pts(s.gain)}</span>
              <small>{s.why}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="wv-note">Nobody on the bench projects higher than the starter he'd replace. The booth has nothing to add. (It always has something to add.)</p>
      )}
    </section>
  );
}

function Wire({ board }: { board: GreenBoard }) {
  const fp = board.sources.fantasypros === "live";
  return (
    <section className="gl-wire" aria-label="Waiver pickups">
      <p className="wv-eyb">On the waiver wire{board.me.faabLeft !== null ? ` · $${board.me.faabLeft} FAAB left` : ""}</p>
      <h2 className="rm-h2">The pickups worth a claim</h2>
      <p className="wv-note">{fp ? "Free agents in your league, by FantasyPros' rest-of-season consensus." : "Free agents in your league, by how many Sleeper leagues added them today."} The Desk never makes moves: claim them in Sleeper.</p>
      {board.pickups.length ? (
        <ol>
          {board.pickups.map((p, i) => (
            <li key={p.player.id}>
              <span className="gl-wn">{String(i + 1).padStart(2, "0")}</span>
              <span className="gl-wp">
                <span className="gl-wname">
                  <b>{p.player.name}</b> <small>{p.player.pos} · {p.player.team ?? "FA"}</small> <InjTag p={p.player} week={board.week} />
                </span>
                <span className="gl-why">{p.why}</span>
                {p.drop && <span className="gl-drop">Cut {p.drop.name} for him</span>}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="gl-empty">Nobody on the wire stands out today.</p>
      )}
      {board.dropping.length > 0 && <p className="gl-warn">Other leagues are dropping {board.dropping.map((d) => d.player.name).join(", ")} today.</p>}
      <a className="gl-open" href={sleeperLeagueUrl(board)} target="_blank" rel="noopener noreferrer">
        Open {board.league.name} in Sleeper
      </a>
    </section>
  );
}

function Table({ board }: { board: GreenBoard }) {
  return (
    <section className="gl-table" aria-label="Standings">
      <p className="wv-eyb">
        {board.league.name} · {board.league.teams} teams · {board.league.scoring}
      </p>
      <h2 className="rm-h2">The table</h2>
      <dl className="gl-stats">
        <div>
          <dt>Place</dt>
          <dd>{board.me.rank ? ordinal(board.me.rank) : "–"}</dd>
        </div>
        <div>
          <dt>Points for</dt>
          <dd>{pts(board.me.pf)}</dd>
        </div>
        <div>
          <dt>Left on the bench</dt>
          <dd>{pts(board.me.benchLeft)}</dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd>{board.me.streak ?? "–"}</dd>
        </div>
      </dl>
      <table>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Team</th>
            <th scope="col">W-L</th>
            <th scope="col">PF</th>
          </tr>
        </thead>
        <tbody>
          {board.standings.map((s, i) => (
            <tr key={s.rosterId} className={s.me ? "is-me" : ""}>
              <td>{i + 1}</td>
              <td>{s.team}</td>
              <td>
                {s.wins}-{s.losses}
                {s.ties ? `-${s.ties}` : ""}
              </td>
              <td>{Math.round(s.pf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function waitsFor(board: GreenBoard | null): Wait[] {
  const fp = board?.sources.fantasypros;
  const items: Wait[] = [];
  if (fp !== "live")
    items.push({
      what: "FantasyPros on this copy",
      why: fp === "failed" ? "The key is set but FantasyPros didn't answer; the page runs on Sleeper meanwhile." : "The key is set on Azure only. Here the projections come from each player's own scores in the league, and the wire from Sleeper's trending adds.",
      state: fp === "failed" ? "needed" : "asked",
    });
  items.push({ what: "OpenAI for the weekly take", why: "The Commentator's written preview of the matchup, once a week. Today's call is worked out from the numbers." });
  return items;
}

/** The headline's second half: the win chance, said plainly. */
function headline(board: GreenBoard): string {
  const m = board.matchup;
  if (!m) return "No game this week.";
  if (!m.them) return "Bye week.";
  if (m.win === null) return "Kickoff pending.";
  const wins = Number(board.me.record.split("-")[0]);
  return m.win >= 0.5 ? `${pct(m.win)} to make it ${Number.isFinite(wins) ? wins + 1 : "one more"}.` : `${pct(m.win)} and a long field.`;
}

export function Green() {
  const cv = useRef<HTMLCanvasElement>(null);
  const spec = useMemo(pitchSpec, []);
  useViz(cv, spec);
  useEffect(() => startGreen(), []);
  const status = useGreen((s) => s.status);
  const board = useGreen((s) => s.board);
  const now = Date.now();
  const fp = board?.sources.fantasypros;
  return (
    <div className="wv-page rm rm-green gl" data-room="green">
      <header className="rm-head gr-head">
        <div>
          <p className="wv-eyb">The Green · {board ? `${board.league.name} · week ${board.week}` : "under the floodlights"}</p>
          <h1 className="wv-h1 desk__title">
            {board ? (
              <>
                {board.me.team}, <span className="gl-nowrap">{board.me.record}.</span> <em>{headline(board)}</em>
              </>
            ) : (
              <>
                No kickoff until <em>the league's on the board.</em>
              </>
            )}
          </h1>
          <p className="wv-sub gl-call-line">{board ? commentatorCall(board) : "The Green runs your Sleeper league: the matchup and your chance of winning it, who to start and who to sit, and the pickups worth a claim."}</p>
        </div>
        <Keeper page="green" />
      </header>

      <section className="gr-pitch" aria-label="This week's matchup">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <Scoreboard board={board} status={status} />
      </section>
      <p className="gl-status" data-state={board?.stale ? "stale" : status}>
        <i aria-hidden="true" />
        {status === "ready" && board
          ? board.stale
            ? `Sleeper isn't answering. Last good read ${ago(board.at, now)}.`
            : `Sleeper, read ${ago(board.at, now)} · every two minutes`
          : status === "failed"
            ? "Sleeper isn't answering. Trying again every two minutes."
            : status === "off"
              ? "Not connected here"
              : status === "absent"
                ? "No team of yours in the league"
                : "Reading Sleeper…"}
        <span className="gl-fp" title="What FantasyPros sent on its last read">
          {board ? fpLine(board) : `FantasyPros ${fp === "failed" ? "not answering" : "waiting"}`}
        </span>
        {board && <span>{board.sources.calls === "fp" ? "Start/sit by FantasyPros" : "Start/sit by form here"}</span>}
        {board && board.byes.length > 0 && <span>On bye: {board.byes.join(", ")}</span>}
      </p>

      {board && (
        <>
          <HeadToHead board={board} />
          <Lineup board={board} />
          <Calls board={board} />
          <div className="gr-row gl-row">
            <Wire board={board} />
            <Table board={board} />
          </div>
        </>
      )}

      <AskedSkippy room="green" />

      <Waits items={waitsFor(board)} className="gr-waits" title="Still to come" />
      <p className="rm-guard">
        Read-only: Sleeper's public league data{fp === "live" ? " and FantasyPros' projections" : ""}. Team and player names only; the Desk never makes a move in your league.
      </p>
    </div>
  );
}
