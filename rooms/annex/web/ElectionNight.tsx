import { useMemo, useState } from "react";
import { useNow } from "../../../apps/world/src/desk/motion.tsx";
import { useAnnex } from "../data/annex.ts";
import { useElections } from "../data/feed.ts";
import { ago, GRID_H, GRID_W, leaderOf, matches, ordered, PARTY_NAME, placeOf, STATE_NAMES, TABS, TILES, tileFill, votes, type Filters, type PartyKey, type Race, type Tab, type TileFill } from "../data/model.ts";
import "./elections.css";

/**
 * Election night (#618), the Annex's first pop-up: live results for the 2026 midterms in the plain layout a results
 * page is read in. Tabs for the Senate, governors, the House and ballot measures; a bar of the calls so far by party;
 * a map of the states as equal tiles (tap one to zoom to its races); filters by party and state, a search, and stars
 * to follow races, which sit on top. Every number is civicAPI's, as the server last read it; a race is "Called" only
 * when civicAPI marks a winner. Form follows function (Nikita, 23:12Z): no house look forced onto it.
 */

const LIST_STEP = 60;

export function ElectionNight() {
  const { status, board, checkedAt, flash, refresh } = useElections();
  const now = useNow(5_000);
  const followsList = useAnnex((s) => s.follows.elections);
  const toggleFollow = useAnnex((s) => s.toggleFollow);
  const follows = useMemo(() => new Set(followsList), [followsList]);
  const [f, setF] = useState<Filters>({ tab: "senate", state: null, party: null, following: false, query: "" });
  const [shown, setShown] = useState(LIST_STEP);
  const set = (patch: Partial<Filters>) => {
    setF((x) => ({ ...x, ...patch }));
    setShown(LIST_STEP);
  };

  const races = useMemo(() => board?.races ?? [], [board]);
  const inTab = useMemo(() => races.filter((r) => r.office === f.tab), [races, f.tab]);
  const list = useMemo(() => ordered(races.filter((r) => matches(r, f, follows)), follows), [races, f, follows]);
  const byState = useMemo(() => {
    const m = new Map<string, Race[]>();
    for (const r of inTab) m.set(r.state, [...(m.get(r.state) ?? []), r]);
    return m;
  }, [inTab]);
  const states = useMemo(() => [...new Set(inTab.map((r) => r.state))].sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b)), [inTab]);
  const followingHere = inTab.filter((r) => follows.has(r.id)).length;

  if (status === "archived") return null;

  const at = board?.at ? Date.parse(board.at) : null;
  const src = board?.source.state;

  return (
    <section className="el" aria-label="Election night">
      <header className="el-head">
        <div>
          <h2 className="el-title">Election night</h2>
          <p className="el-sub">2026 US midterms · Tuesday, November 3</p>
        </div>
        <p className="el-fresh" aria-live="polite">
          {src === "stale" || src === "down" ? <b className="el-warn">Results source not answering</b> : null}
          {at ? (
            <span>
              Updated {ago(now - at)}
              {src === "stale" ? " · showing the last good results" : ""}
            </span>
          ) : status === "loading" ? (
            <span>Reading the results…</span>
          ) : status === "failed" ? (
            <span>The results aren't reachable right now</span>
          ) : (
            <span>Waiting for the first results</span>
          )}
          <button type="button" className="el-link" onClick={refresh} disabled={!checkedAt}>
            Refresh
          </button>
        </p>
      </header>

      <nav className="el-tabs" role="tablist" aria-label="Which races">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={f.tab === t.id} className="el-tab" onClick={() => set({ tab: t.id, state: f.state && races.some((r) => r.office === t.id && r.state === f.state) ? f.state : null, party: t.id === "measure" ? null : f.party })}>
            {t.label}
          </button>
        ))}
      </nav>

      {f.tab !== "measure" && board && <Control tab={f.tab} tally={board.tally[f.tab]} />}

      <div className="el-body">
        <TileMap tab={f.tab} byState={byState} selected={f.state} onPick={(s) => set({ state: s === f.state ? null : s })} />

        <div className="el-side">
          <div className="el-filters">
            <input className="el-search" type="search" placeholder="Search a state, race or candidate" value={f.query} onChange={(e) => set({ query: e.target.value })} aria-label="Search races" />
            <select className="el-select" value={f.state ?? ""} onChange={(e) => set({ state: e.target.value || null })} aria-label="State">
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {STATE_NAMES[s] ?? s}
                </option>
              ))}
            </select>
            {f.tab !== "measure" && (
              <div className="el-chips" role="group" aria-label="Leading party">
                {([null, "D", "R", "I"] as (PartyKey | null)[]).map((p) => (
                  <button key={p ?? "all"} type="button" className="el-chip" data-party={p ?? undefined} aria-pressed={f.party === p} onClick={() => set({ party: p })}>
                    {p ? `${PARTY_NAME[p]} ahead` : "Any party"}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="el-chip el-follow-filter" aria-pressed={f.following} onClick={() => set({ following: !f.following })}>
              <Star on={f.following} /> Following{followingHere ? ` (${followingHere})` : ""}
            </button>
          </div>

          {f.state && (
            <p className="el-zoomed">
              <b>{STATE_NAMES[f.state] ?? f.state}</b>
              <button type="button" className="el-link" onClick={() => set({ state: null })}>
                Back to all states
              </button>
            </p>
          )}

          <ol className="el-list">
            {list.slice(0, shown).map((r) => (
              <RaceRow key={r.id} race={r} now={now} followed={follows.has(r.id)} flash={flash.has(r.id)} onFollow={() => toggleFollow("elections", r.id)} />
            ))}
          </ol>
          {list.length > shown && (
            <button type="button" className="el-more" onClick={() => setShown(shown + LIST_STEP)}>
              Show more ({list.length - shown} left)
            </button>
          )}
          {board && !list.length && <p className="el-empty">{f.following ? "No followed races here yet. Tap a star to follow one." : races.length ? "No races match." : "No results yet."}</p>}
        </div>
      </div>

      <footer className="el-credit">
        Results:{" "}
        <a href="https://civicapi.org" target="_blank" rel="noreferrer">
          civicAPI
        </a>
        . Calls are civicAPI's; seat bars count called races only.
      </footer>
    </section>
  );
}

function Star({ on }: { on: boolean }) {
  return (
    <svg className="el-star" viewBox="0 0 20 20" aria-hidden="true" data-on={on || undefined}>
      <path d="M10 2.2l2.4 5 5.4.6-4 3.7 1.1 5.4L10 14.2 5.1 16.9l1.1-5.4-4-3.7 5.4-.6z" />
    </svg>
  );
}

const SEGS: PartyKey[] = ["D", "I", "O", "R"];

function Control({ tab, tally }: { tab: Exclude<Tab, "measure">; tally: { total: number; called: Record<PartyKey, number> } }) {
  const { total, called } = tally;
  if (!total) return null;
  const done = SEGS.reduce((s, k) => s + called[k], 0);
  const left = total - done;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const label = tab === "senate" ? "Senate seats on the ballot" : tab === "governor" ? "Governor races" : "House seats";
  return (
    <div className="el-control" aria-label={`${label}: called so far`}>
      <div className="el-control-nums">
        <span data-party="D">
          <b>{called.D}</b> Dem
        </span>
        <span className="el-control-mid">
          Called so far · {label} · {left} not called
        </span>
        <span data-party="R">
          Rep <b>{called.R}</b>
        </span>
      </div>
      <div className="el-bar">
        {called.D > 0 && <i data-party="D" style={{ width: pct(called.D) }} />}
        {called.I > 0 && <i data-party="I" style={{ width: pct(called.I) }} />}
        {called.O > 0 && <i data-party="O" style={{ width: pct(called.O) }} />}
        {left > 0 && <i data-party="none" style={{ width: pct(left) }} />}
        {called.R > 0 && <i data-party="R" style={{ width: pct(called.R) }} />}
        {tab === "house" && total >= 435 && <em className="el-mark" style={{ left: "50%" }} title="218 for a majority" />}
      </div>
      {(called.I > 0 || called.O > 0) && (
        <p className="el-control-foot">
          {called.I > 0 && `${called.I} independent`}
          {called.I > 0 && called.O > 0 && " · "}
          {called.O > 0 && `${called.O} other`}
        </p>
      )}
      {tab === "house" && <p className="el-control-foot">218 seats make a majority.</p>}
      {tab === "senate" && <p className="el-control-foot">Only this year's races: the seats not up tonight aren't counted.</p>}
    </div>
  );
}

const T = 46;
const G = 4;

function fillClass(fill: TileFill): string {
  if (fill.kind === "none") return "el-tile--none";
  if (fill.kind === "waiting") return "el-tile--wait";
  if (fill.kind === "measures") return "el-tile--measure";
  return `el-tile--${fill.party}${fill.called ? " el-tile--called" : ""}${fill.split ? " el-tile--split" : ""}`;
}

function TileMap({ tab, byState, selected, onPick }: { tab: Tab; byState: Map<string, Race[]>; selected: string | null; onPick: (s: string) => void }) {
  const W = GRID_W * (T + G);
  const H = GRID_H * (T + G);
  const pos = selected ? TILES[selected] : undefined;
  // Zoomed: the picked state, centred, at about 2.4x, the rest of the country faded around it.
  const zoom = pos ? 2.4 : 1;
  const cx = pos ? pos[0] * (T + G) + T / 2 : W / 2;
  const cy = pos ? pos[1] * (T + G) + T / 2 : H / 2;
  const tx = Math.min(0, Math.max(W - W * zoom, W / 2 - cx * zoom));
  const ty = Math.min(0, Math.max(H - H * zoom, H / 2 - cy * zoom));
  return (
    <figure className="el-map" data-zoomed={pos ? true : undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`Map of the states, ${TABS.find((t) => t.id === tab)?.label}`}>
        <g style={{ transform: `translate(${tx}px, ${ty}px) scale(${zoom})` }} className="el-map-g">
          {Object.entries(TILES).map(([s, [c, r]]) => {
            const rs = byState.get(s) ?? [];
            const fill = tileFill(rs);
            const x = c * (T + G);
            const y = r * (T + G);
            const has = rs.length > 0;
            return (
              <g
                key={s}
                className={`el-tile ${fillClass(fill)}`}
                data-picked={selected === s || undefined}
                data-dim={(selected && selected !== s) || undefined}
                role={has ? "button" : undefined}
                tabIndex={has ? 0 : undefined}
                aria-label={has ? `${STATE_NAMES[s]}: ${tileWord(fill, rs)}` : undefined}
                onClick={has ? () => onPick(s) : undefined}
                onKeyDown={has ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(s)) : undefined}
              >
                <rect x={x} y={y} width={T} height={T} rx={5} />
                <text x={x + T / 2} y={y + T / 2 + (fill.kind === "measures" ? -2 : 4)} textAnchor="middle">
                  {s}
                </text>
                {fill.kind === "measures" && (
                  <text className="el-tile-n" x={x + T / 2} y={y + T / 2 + 12} textAnchor="middle">
                    {fill.count}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <figcaption className="el-legend">
        {tab === "measure" ? (
          <span>Tap a state for its measures</span>
        ) : (
          <>
            <span>
              <i className="el-key el-tile--D el-tile--called" /> Called
            </span>
            <span>
              <i className="el-key el-tile--D" /> Ahead
            </span>
            <span>
              <i className="el-key el-tile--wait" /> No votes yet
            </span>
            <span>Tap a state to zoom in</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

function tileWord(fill: TileFill, rs: Race[]): string {
  if (fill.kind === "measures") return `${fill.count} measure${fill.count === 1 ? "" : "s"}`;
  if (fill.kind === "waiting") return "no votes counted yet";
  if (fill.kind === "party") return `${PARTY_NAME[fill.party]} ${fill.called ? "called" : "ahead"}${rs.length > 1 ? ` in most of ${rs.length} races` : ""}`;
  return "";
}

function RaceRow({ race: r, now, followed, flash, onFollow }: { race: Race; now: number; followed: boolean; flash: boolean; onFollow: () => void }) {
  const lead = leaderOf(r);
  const total = r.candidates.reduce((s, c) => s + c.votes, 0);
  const shown = r.candidates.slice(0, r.office === "measure" ? 2 : 3);
  const others = r.candidates.length - shown.length;
  const updated = r.updated ? `Updated ${ago(now - Date.parse(r.updated))}` : r.moved && total > 0 ? `Last change seen ${ago(now - Date.parse(r.moved))}` : null;
  const closes = !total && r.pollsClose ? `Polls close ${new Date(r.pollsClose).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : null;
  return (
    <li className="el-race" data-called={r.called || undefined} data-flash={flash || undefined} data-followed={followed || undefined}>
      <div className="el-race-head">
        <button type="button" className="el-star-btn" aria-pressed={followed} aria-label={followed ? `Stop following ${r.name}` : `Follow ${r.name}`} onClick={onFollow}>
          <Star on={followed} />
        </button>
        <h3>
          <span className="el-place">{placeOf(r)}</span> {r.name}
        </h3>
        {r.called && lead ? (
          <span className="el-called" data-party={r.office === "measure" ? undefined : lead.key}>
            ✓ Called
          </span>
        ) : null}
      </div>
      <table className="el-cands">
        <tbody>
          {shown.map((c) => (
            <tr key={c.name} data-party={r.office === "measure" ? (c.name.toLowerCase() === "yes" ? "yes" : c.name.toLowerCase() === "no" ? "no" : "O") : c.key} data-winner={c.winner || undefined}>
              <th scope="row">
                <span className="el-dot" aria-hidden="true" />
                {c.name}
                {c.incumbent && <span className="el-inc" title="Incumbent">inc.</span>}
                {r.office !== "measure" && c.party && <span className="el-party">{c.party}</span>}
                {c.winner && <span className="el-check" aria-label="Winner">✓</span>}
              </th>
              <td className="el-num">{votes(c.votes)}</td>
              <td className="el-pct">
                <span>{c.pct.toFixed(1)}%</span>
                <i style={{ width: `${Math.min(100, c.pct)}%` }} aria-hidden="true" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="el-race-foot">
        <span>{r.reporting.toFixed(r.reporting % 1 ? 1 : 0)}% reporting</span>
        {others > 0 && <span>{others} more on the ballot</span>}
        {closes && <span>{closes}</span>}
        {updated && <span>{updated}</span>}
      </p>
    </li>
  );
}
