import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { clock, isDone, NOTE_STATE_TEXT, short, STAGE_LINE, STATUS_TEXT, versionsOf, type DeskAction, type DeskView, type Episode, type Note, type Stage } from "../data/desk.ts";
import type { PostStat, Social } from "../../../api/_studio/stats.ts";

/**
 * The Studio desk's three working screens (#1229), drawn on the edit suite's monitors in 3D (soundstage.ts lays each on
 * its glass) and flat when there's no 3D or on a phone:
 *
 * - Edit, the big middle screen: the episodes in production, the selected one's four stages, its versions, the
 *   transport and scrub bar with Nikita's notes on it (a moment, or a range from mark in to mark out), the note box,
 *   his drafts and what the Director did with the sent ones, Send notes, and Approve or Publish.
 * - Pitch, at the left: a rough idea in, the ideas so far, and each episode's progress.
 * - Feed, at the right: both profiles under the show's photo, every posted video with its own numbers, and its comments.
 *
 * Nikita can't change a cut here; he watches, highlights and comments (2026-11-25). Notes stay his drafts until Send
 * notes hands the batch to the Director.
 */

export interface Player {
  t: number;
  dur: number;
  playing: boolean;
  toggle: () => void;
  seek: (t: number) => void;
}

type Run = (body: DeskAction, done: string, after?: () => void) => Promise<void>;

const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok" };
const PROFILE = new URL("./props/profile.webp", import.meta.url).href;

/* ───────────────────────────── Edit ───────────────────────────── */

export function EditScreen(p: {
  desk: DeskView;
  ep: Episode | undefined;
  inProduction: Episode[];
  openEp: (id: string) => void;
  sel: number;
  setSel: (i: number) => void;
  version: number;
  setVersion: (v: number) => void;
  player: Player;
  refOn: boolean;
  toggleRef: () => void;
  fullscreen: () => void;
  run: Run;
  busy: boolean;
}) {
  const { desk, ep, sel, player, run, busy } = p;
  const stage = STAGE_LINE[sel]!;
  const st = ep?.stages[stage.id];
  const versions = versionsOf(st);
  const timed = versions.length > 0;
  const [mark, setMark] = useState<{ a?: number; b?: number }>({});
  const [text, setText] = useState("");
  const notes = useMemo(() => desk.notes.filter((n) => ep && n.episode === ep.id && n.stage === stage.id), [desk.notes, ep, stage.id]);
  const here = notes.filter((n) => !timed || n.version === undefined || n.version === p.version).sort((a, b) => (a.t ?? -1) - (b.t ?? -1));
  const drafts = notes.filter((n) => n.state === "draft");
  const range = mark.a !== undefined && mark.b !== undefined && mark.b > mark.a ? { t: mark.a, t2: mark.b } : null;
  const at = range ? `${clock(range.t)}–${clock(range.t2)}` : timed ? clock(player.t) : "";

  const add = () => {
    if (!ep || !text.trim()) return;
    const where = timed ? { version: p.version, ...(range ?? { t: Math.round(player.t * 10) / 10 }) } : {};
    void run({ action: "note", text: text.trim(), episode: ep.id, stage: stage.id, via: "typed", ...where }, timed ? `Noted at ${at}. It's a draft until you send your notes.` : "Noted. It's a draft until you send your notes.", () => {
      setText("");
      setMark({});
    });
  };

  return (
    <div className="sx sx-edit">
      <header className="sx-bar">
        <b className="sx-k">Edit</b>
        <span className="sx-title">{ep ? `Ep ${ep.n} · ${ep.title}` : "Nothing in production"}</span>
        <nav className="sx-eps" aria-label="In production">
          <span>In production</span>
          {p.inProduction.map((e) => (
            <button key={e.id} type="button" aria-pressed={e.id === ep?.id} onClick={() => p.openEp(e.id)}>
              Ep {e.n}
            </button>
          ))}
          {p.inProduction.length === 0 && <em>none</em>}
        </nav>
      </header>
      {!ep ? (
        <p className="sx-empty">Pitch an idea on the left screen. The Director writes it up and it lands here.</p>
      ) : (
        <div className="sx-edit-grid">
          <aside className="sx-col sx-stages">
            <ol aria-label="Stages">
              {STAGE_LINE.map((s, i) => {
                const status = ep.stages[s.id]?.status ?? "waiting";
                return (
                  <li key={s.id}>
                    <button type="button" aria-pressed={i === sel} data-status={status} onClick={() => p.setSel(i)}>
                      <i aria-hidden="true" />
                      <span>
                        <b>{s.t}</b>
                        <em>{STATUS_TEXT[status]}</em>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {timed && (
              <div className="sx-versions" aria-label="Versions">
                <h4>Versions</h4>
                {[...versions].reverse().map((v, i) => (
                  <button key={v.v} type="button" aria-pressed={v.v === p.version} onClick={() => p.setVersion(v.v)}>
                    <b>v{v.v}</b>
                    <span>{v.label ?? (i === 0 ? "latest" : "")}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="sx-col sx-main">
            {timed ? (
              <>
                <div className="sx-transport">
                  <button type="button" className="sx-play" onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"}>
                    {player.playing ? "❚❚" : "▶"}
                  </button>
                  <span className="sx-tc">
                    {clock(player.t)}
                    <small> / {clock(player.dur)}</small>
                  </span>
                  <button type="button" onClick={() => player.seek(Math.max(0, player.t - 5))}>
                    −5s
                  </button>
                  <button type="button" onClick={() => player.seek(Math.min(player.dur, player.t + 5))}>
                    +5s
                  </button>
                  <span className="sx-sp" />
                  <button type="button" className="sx-in" onClick={() => setMark((m) => ({ a: player.t, b: m.b !== undefined && m.b > player.t ? m.b : undefined }))}>
                    Mark in{mark.a !== undefined ? ` · ${clock(mark.a)}` : ""}
                  </button>
                  <button type="button" className="sx-in" onClick={() => setMark((m) => (m.a !== undefined && player.t > m.a ? { ...m, b: player.t } : m))} disabled={mark.a === undefined}>
                    Mark out{mark.b !== undefined ? ` · ${clock(mark.b)}` : ""}
                  </button>
                  {(mark.a !== undefined || mark.b !== undefined) && (
                    <button type="button" onClick={() => setMark({})}>
                      Clear
                    </button>
                  )}
                  <button type="button" aria-pressed={p.refOn} onClick={p.toggleRef}>
                    Reference
                  </button>
                  <button type="button" onClick={p.fullscreen} aria-label="Full screen">
                    ⛶
                  </button>
                </div>
                <Scrub player={player} notes={here} mark={mark} setMark={setMark} />
                <form
                  className="sx-compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    add();
                  }}
                >
                  <span className="sx-at" data-range={range ? "1" : undefined}>
                    {at}
                  </span>
                  <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={range ? "What did you notice in this stretch?" : "What did you notice here?"} aria-label="Note" />
                  <button type="submit" disabled={busy || !text.trim()}>
                    Add note
                  </button>
                </form>
                <p className="sx-hint">Pause anywhere and type, or hold Space and say it. Mark in and out to note a whole stretch.</p>
              </>
            ) : (
              <div className="sx-read">
                {st?.cover && (
                  <figure className="sx-coverimg">
                    <img src={st.cover} alt={`Cover for ${ep.title}`} loading="lazy" />
                    <figcaption>{stage.id === "post" ? "Posted as the cover" : "Cover"}</figcaption>
                  </figure>
                )}
                {st?.text ? <pre>{st.text}</pre> : !st?.captions?.length && !st?.cover && <p className="sx-empty">Nothing here yet. The Director fills it in when this stage starts.</p>}
                {!!st?.captions?.length && (
                  <ol className="sx-caps" aria-label="Caption options">
                    {st.captions.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ol>
                )}
                <form
                  className="sx-compose"
                  onSubmit={(e) => {
                    e.preventDefault();
                    add();
                  }}
                >
                  <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="A note on this stage" aria-label="Note" />
                  <button type="submit" disabled={busy || !text.trim()}>
                    Add note
                  </button>
                </form>
              </div>
            )}
          </section>

          <aside className="sx-col sx-notes">
            <h4>
              Notes{timed ? ` on v${p.version}` : ""} <small>{here.length}</small>
            </h4>
            <ul>
              {here.map((n) => (
                <NoteRow key={n.id} n={n} seek={timed ? player.seek : undefined} drop={n.state === "draft" ? () => void run({ action: "unnote", id: n.id }, "Draft dropped.") : undefined} />
              ))}
              {here.length === 0 && <li className="sx-empty">No notes yet.</li>}
            </ul>
            <div className="sx-acts">
              <button type="button" className="sx-send" disabled={busy || drafts.length === 0} onClick={() => void run({ action: "send", episode: ep.id, stage: stage.id }, `Sent ${drafts.length} note${drafts.length === 1 ? "" : "s"} to the Director.`)}>
                Send notes{drafts.length ? ` (${drafts.length})` : ""}
              </button>
              {stage.id === "post" ? (
                <button type="button" className="sx-go" disabled={busy || st?.status !== "ready" || !st?.draft} onClick={() => void run({ action: "publish", episode: ep.id }, "Publishing in a minute, to Instagram and TikTok.")}>
                  Publish
                </button>
              ) : (
                <button type="button" className="sx-go" disabled={busy || st?.status !== "ready"} onClick={() => void run({ action: "approve", episode: ep.id, stage: stage.id as Stage }, `${stage.t} approved. The Director moves on.`)}>
                  Approve
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function NoteRow({ n, seek, drop }: { n: Note; seek?: (t: number) => void; drop?: () => void }) {
  const state = n.state ?? "sent";
  return (
    <li className="sx-note" data-state={state}>
      {n.t !== undefined && (
        <button type="button" className="sx-tchip" onClick={() => seek?.(n.t!)} disabled={!seek}>
          {clock(n.t)}
          {n.t2 !== undefined ? `–${clock(n.t2)}` : ""}
        </button>
      )}
      <p>
        {n.text}
        {n.reply && <em className="sx-reply">{n.reply}</em>}
      </p>
      <span className="sx-state">{n.via === "said" ? `Said · ${NOTE_STATE_TEXT[state]}` : NOTE_STATE_TEXT[state]}</span>
      {drop && (
        <button type="button" className="sx-x" onClick={drop} aria-label="Drop this draft">
          ×
        </button>
      )}
    </li>
  );
}

function Scrub({ player, notes, mark, setMark }: { player: Player; notes: Note[]; mark: { a?: number; b?: number }; setMark: (m: { a?: number; b?: number }) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const d = player.dur || 1;
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / d) * 100))}%`;
  const tAt = (e: RPointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(d, ((e.clientX - r.left) / r.width) * d));
  };
  return (
    <div
      ref={bar}
      className="sx-scrub"
      role="slider"
      aria-label="Scrub"
      aria-valuemin={0}
      aria-valuemax={Math.round(d)}
      aria-valuenow={Math.round(player.t)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") player.seek(Math.min(d, player.t + 1));
        else if (e.key === "ArrowLeft") player.seek(Math.max(0, player.t - 1));
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        bar.current!.setPointerCapture(e.pointerId);
        const t = tAt(e);
        if (e.shiftKey) {
          drag.current = t;
          setMark({ a: t });
        } else player.seek(t);
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        const t = tAt(e);
        if (drag.current !== null) setMark(t > drag.current ? { a: drag.current, b: t } : { a: t, b: drag.current });
        else player.seek(t);
      }}
      onPointerUp={() => void (drag.current = null)}
    >
      <div className="sx-ticks" aria-hidden="true">
        {Array.from({ length: Math.floor(d / 10) + 1 }, (_, i) => (
          <i key={i} style={{ left: pct(i * 10) }} data-big={i % 6 === 0 ? "1" : undefined}>
            {i % 6 === 0 ? clock(i * 10) : ""}
          </i>
        ))}
      </div>
      {notes
        .filter((n) => n.t !== undefined)
        .map((n) =>
          n.t2 !== undefined ? (
            <span key={n.id} className="sx-mk is-range" data-state={n.state ?? "sent"} style={{ left: pct(n.t!), width: `calc(${pct(n.t2)} - ${pct(n.t!)})` }} title={n.text} />
          ) : (
            <span key={n.id} className="sx-mk" data-state={n.state ?? "sent"} style={{ left: pct(n.t!) }} title={n.text} />
          ),
        )}
      {mark.a !== undefined && <span className="sx-sel" style={{ left: pct(mark.a), width: mark.b !== undefined ? `calc(${pct(mark.b)} - ${pct(mark.a)})` : "2px" }} />}
      <span className="sx-head" style={{ left: pct(player.t) }} />
    </div>
  );
}

/* ───────────────────────────── Pitch ───────────────────────────── */

export function PitchScreen({ desk, episodes, openEp, run, busy }: { desk: DeskView; episodes: Episode[]; openEp: (id: string) => void; run: Run; busy: boolean }) {
  const [text, setText] = useState("");
  return (
    <div className="sx sx-pitch">
      <header className="sx-bar">
        <b className="sx-k">Pitch</b>
        <span className="sx-title">A rough idea is enough</span>
      </header>
      <form
        className="sx-pitchbox"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) void run({ action: "pitch", text: text.trim() }, "Pitched. The Director writes it up as a full pitch for you to approve.", () => setText(""));
        }}
      >
        <textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Credit scores, but the bank is a lich who only lends to the undead." aria-label="Your idea" />
        <button type="submit" className="sx-go" disabled={busy || !text.trim()}>
          Pitch it
        </button>
      </form>
      <div className="sx-pitch-cols">
        <section>
          <h4>Ideas</h4>
          <ol className="sx-ideas">
            {[...desk.ideas].reverse().map((i) => (
              <li key={i.id} data-status={i.status}>
                <p>{i.text}</p>
                <em>{i.status === "new" ? "New" : i.status === "taken" ? "Taken up" : "Set aside"}</em>
              </li>
            ))}
            {desk.ideas.length === 0 && <li className="sx-empty">No ideas yet.</li>}
          </ol>
        </section>
        <section>
          <h4>On the line</h4>
          <ol className="sx-line">
            {[...episodes].reverse().map((e) => (
              <li key={e.id}>
                <button type="button" onClick={() => openEp(e.id)}>
                  <b>Ep {e.n}</b>
                  <span>{e.title}</span>
                  <i className="sx-prog" aria-label={`${STAGE_LINE.filter((s) => isDone(e.stages[s.id])).length} of 4 stages done`}>
                    {STAGE_LINE.map((s) => (
                      <u key={s.id} data-status={e.stages[s.id]?.status ?? "waiting"} />
                    ))}
                  </i>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

/* ───────────────────────────── Feed ───────────────────────────── */

const pctOrDash = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);

export function FeedScreen({ social }: { social: Social | null }) {
  const posts = useMemo(() => [...(social?.posts ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [social]);
  const [at, setAt] = useState(0);
  const post: PostStat | undefined = posts[at];
  const comments = (social?.comments ?? []).filter((c) => post && c.platform === post.platform && (c.post === post.text || post.text.startsWith(c.post) || c.post.startsWith(post.text.slice(0, 40))));
  return (
    <div className="sx sx-feed">
      <header className="sx-feedhead">
        <img src={PROFILE} alt="The show's profile photo" />
        <div>
          <b>@eatingyourneighbors</b>
          <span>So, they're eating your neighbors.</span>
        </div>
        <dl>
          {(social?.profiles ?? []).map((pr) => (
            <div key={pr.platform}>
              <dt>{PLATFORM[pr.platform] ?? pr.platform}</dt>
              <dd>{short(pr.followers)}</dd>
            </div>
          ))}
        </dl>
      </header>
      {!social ? (
        <p className="sx-empty">The numbers aren't in yet. Zernio answers within a few minutes.</p>
      ) : posts.length === 0 ? (
        <p className="sx-empty">Nothing posted yet.</p>
      ) : (
        <div className="sx-feed-grid">
          <ol className="sx-posts" aria-label="Posted videos">
            {posts.map((x, i) => (
              <li key={`${x.platform}-${x.at}`}>
                <button type="button" aria-pressed={i === at} onClick={() => setAt(i)}>
                  {x.thumb ? <img src={x.thumb} alt="" loading="lazy" /> : <span className="sx-thumb" aria-hidden="true" />}
                  <span className="sx-pf" data-p={x.platform}>
                    {PLATFORM[x.platform] ?? x.platform}
                  </span>
                  <b>{short(x.views)}</b>
                </button>
              </li>
            ))}
          </ol>
          {post && (
            <article className="sx-post">
              <p className="sx-post-t">{post.text || "Untitled"}</p>
              <p className="sx-post-m">
                {PLATFORM[post.platform]} · {new Date(post.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {post.url && (
                  <>
                    {" · "}
                    <a href={post.url} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  </>
                )}
              </p>
              <dl className="sx-metrics">
                {(
                  [
                    ["Views", short(post.views)],
                    ["Watched", pctOrDash(post.completion)],
                    ["Avg watch", post.watchS === null ? "—" : `${post.watchS.toFixed(1)}s`],
                    ["Shares", short(post.shares)],
                    ["Sends", short(post.sends)],
                    ["Saves", short(post.saves)],
                    ["Likes", short(post.likes)],
                    ["Follows", short(post.follows)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              <h4>Comments {post.comments ? <small>{post.comments}</small> : null}</h4>
              <ul className="sx-comments">
                {comments.map((c) => (
                  <li key={`${c.from}-${c.at}`}>
                    <b>{c.from}</b> {c.text}
                  </li>
                ))}
                {comments.length === 0 && <li className="sx-empty">{post.comments ? "Older comments open on the platform." : "No comments yet."}</li>}
              </ul>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
