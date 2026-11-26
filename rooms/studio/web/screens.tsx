import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { clock, isAd, isDone, NOTE_STATE_TEXT, short, STAGE_LINE, STATUS_TEXT, versionsOf, type DeskAction, type DeskView, type Episode, type Note, type Stage } from "../data/desk.ts";
import type { Sprite } from "../../../api/_studio/desk.ts";
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

/** The platform's own player for a post (#1233): TikTok's embed by video id, Instagram's by its post or reel code. */
export function embedOf(url: string | undefined): string | null {
  if (!url) return null;
  const tt = /tiktok\.com\/.*\/video\/(\d{6,30})/.exec(url);
  if (tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  const ig = /instagram\.com\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/.exec(url);
  if (ig) return `https://www.instagram.com/${ig[1] === "reels" ? "reel" : ig[1]}/${ig[2]}/embed`;
  return null;
}
const PROFILE = new URL("./props/profile.webp", import.meta.url).href;

/* ───────────────────────────── Edit ───────────────────────────── */

export interface EditProps {
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
}

/**
 * The Edit screen's state and actions, shared by the monitor's layout (EditScreen) and the phone's (PhoneEdit.tsx), so
 * the two never drift apart in what they can do: the notes here, marks in and out, the note box, Send notes (and its
 * ask while a render runs), Approve or Publish, and the title's edit and re-roll.
 */
export function useEdit(p: EditProps) {
  const { desk, ep, sel, player, run } = p;
  const stage = STAGE_LINE[sel]!;
  const st = ep?.stages[stage.id];
  const versions = versionsOf(st);
  const timed = versions.length > 0;
  const [mark, setMark] = useState<{ a?: number; b?: number }>({});
  const [text, setText] = useState("");
  const notes = useMemo(() => desk.notes.filter((n) => ep && n.episode === ep.id && n.stage === stage.id), [desk.notes, ep, stage.id]);
  const here = notes.filter((n) => !timed || n.version === undefined || n.version === p.version).sort((a, b) => (a.t ?? -1) - (b.t ?? -1));
  const drafts = notes.filter((n) => n.state === "draft");
  // A render under way (#1233): sound notes just go (the mix is fixed and laid on the cut, no restart); notes on the
  // picture ask whether to interrupt it or wait for the next version.
  const rendering = ep?.stages.render?.status === "working";
  const asks = rendering && stage.id !== "mix";
  const [asking, setAsking] = useState(false);
  const sendNow = (hold: boolean) => {
    if (!ep) return;
    setAsking(false);
    const k = `${drafts.length} note${drafts.length === 1 ? "" : "s"}`;
    void run({ action: "send", episode: ep.id, stage: stage.id, ...(hold ? { hold: true } : {}) }, hold ? `Holding ${k} for the next version. They go to the Director when it lands.` : `Sent ${k} to the Director.`);
  };
  const [titling, setTitling] = useState(false);
  const [titleText, setTitleText] = useState("");
  const reroll = () => {
    if (!ep) return;
    const alts = (ep.titles ?? []).filter((x) => x !== ep.title);
    if (!alts.length) return;
    const pick = alts[Math.floor(Math.random() * alts.length)]!;
    void run({ action: "title", episode: ep.id, title: pick }, `Retitled: ${pick}`);
  };
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

  const approve = () => {
    if (!ep) return;
    if (stage.id === "post") void run({ action: "publish", episode: ep.id }, "Publishing in a minute, to Instagram and TikTok.");
    else void run({ action: "approve", episode: ep.id, stage: stage.id as Stage }, `${stage.t} approved. The Director moves on.`);
  };
  const canApprove = stage.id === "post" ? st?.status === "ready" && !!st?.draft : st?.status === "ready";
  const saveTitle = (t: string) => {
    const x = t.trim();
    if (ep && x && x !== ep.title) void run({ action: "title", episode: ep.id, title: x }, "Retitled.");
    setTitling(false);
  };
  const canReroll = !!ep && (ep.titles ?? []).some((x) => x !== ep.title);
  const cur = versions.find((v) => v.v === p.version) ?? versions[versions.length - 1];
  return { cur, stage, st, versions, timed, mark, setMark, text, setText, here, drafts, asks, asking, setAsking, sendNow, titling, setTitling, titleText, setTitleText, reroll, canReroll, saveTitle, range, at, add, approve, canApprove };
}

export function EditScreen(p: EditProps) {
  const { ep, sel, player, run, busy } = p;
  const { cur, stage, st, versions, timed, mark, setMark, text, setText, here, drafts, asks, asking, setAsking, sendNow, titling, setTitling, titleText, setTitleText, reroll, range, at, add } = useEdit(p);
  const [adsOpen, setAdsOpen] = useState(false);
  const eps = p.inProduction.filter((e) => !isAd(e));
  const ads = p.desk.episodes.filter(isAd);
  const onAd = !!ep && isAd(ep);
  const script = stage.id === "pitch" ? ep?.stages.mix?.text : undefined;
  return (
    <div className="sx sx-edit">
      <header className="sx-bar">
        <b className="sx-k">Edit</b>
        {ep && titling ? (
          <form
            className="sx-title sx-retitle"
            onSubmit={(e) => {
              e.preventDefault();
              const t = titleText.trim();
              if (t && t !== ep.title) void run({ action: "title", episode: ep.id, title: t }, "Retitled.");
              setTitling(false);
            }}
          >
            <input value={titleText} onChange={(e) => setTitleText(e.target.value)} maxLength={200} aria-label="Episode title" autoFocus onKeyDown={(e) => e.key === "Escape" && setTitling(false)} />
            <button type="submit">Save</button>
          </form>
        ) : (
          <span className="sx-title">
            {ep ? (
              <>
                Ep {ep.n} ·{" "}
                <button
                  type="button"
                  className="sx-titlebtn"
                  title="Click to retitle"
                  onClick={() => {
                    setTitleText(ep.title);
                    setTitling(true);
                  }}
                >
                  {ep.title}
                </button>
                {(ep.titles ?? []).some((x) => x !== ep.title) && (
                  <button type="button" className="sx-reroll" disabled={busy} onClick={reroll} aria-label="Re-roll the title" title="Re-roll the title">
                    ⟳
                  </button>
                )}
              </>
            ) : (
              "Nothing in production"
            )}
          </span>
        )}
        <nav className="sx-eps" aria-label="In production">
          <span>In production</span>
          {eps.map((e) => (
            <button key={e.id} type="button" aria-pressed={e.id === ep?.id} onClick={() => p.openEp(e.id)}>
              Ep {e.n}
            </button>
          ))}
          {eps.length === 0 && <em>none</em>}
          {ads.length > 0 && (
            <span className="sx-folder">
              <button type="button" className="sx-folderbtn" aria-expanded={adsOpen} aria-pressed={onAd} onClick={() => setAdsOpen((o) => !o)} title="Ads and other cuts">
                ▤ Ads <small>{ads.length}</small>
              </button>
              {adsOpen && (
                <span className="sx-folderlist" role="menu" aria-label="Ads">
                  {ads.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      role="menuitem"
                      aria-pressed={e.id === ep?.id}
                      onClick={() => {
                        setAdsOpen(false);
                        p.openEp(e.id);
                      }}
                    >
                      {e.title.replace(/^ad:\s*/i, "")}
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
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
                <Scrub player={player} notes={here} mark={mark} setMark={setMark} sprite={stage.id === "render" ? cur?.sprite : undefined} peaks={stage.id === "mix" ? cur?.peaks : undefined} />
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
                <p className="sx-hint">Pause anywhere and type, or hold L and say it. Mark in and out to note a whole stretch.</p>
              </>
            ) : (
              <div className="sx-read">
                {st?.cover && (
                  <figure className="sx-coverimg">
                    <img src={st.cover} alt={`Cover for ${ep.title}`} loading="lazy" />
                    <figcaption>{stage.id === "post" ? "Posted as the cover" : "Cover"}</figcaption>
                  </figure>
                )}
                {st?.text ? <pre>{st.text}</pre> : !script && !st?.captions?.length && !st?.cover && <p className="sx-empty">Nothing here yet. The Director fills it in when this stage starts.</p>}
                {script && (
                  <>
                    <h4 className="sx-scripthead">Script</h4>
                    <pre className="sx-script">{script}</pre>
                  </>
                )}
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
              {asking ? (
                <span className="sx-ask" role="group" aria-label="A render is under way">
                  <em>A render is under way.</em>
                  <button type="button" className="sx-send" disabled={busy} onClick={() => sendNow(false)}>
                    Send now, interrupt it
                  </button>
                  <button type="button" disabled={busy} onClick={() => sendNow(true)}>
                    Hold for the next version
                  </button>
                  <button type="button" onClick={() => setAsking(false)} aria-label="Cancel">
                    ×
                  </button>
                </span>
              ) : (
                <button type="button" className="sx-send" disabled={busy || drafts.length === 0} onClick={() => (asks ? setAsking(true) : sendNow(false))}>
                  Send notes{drafts.length ? ` (${drafts.length})` : ""}
                </button>
              )}
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

export function NoteRow({ n, seek, drop }: { n: Note; seek?: (t: number) => void; drop?: () => void }) {
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

/** A mix's waveform: the peaks JSON the render kit writes (`{ rate, peaks }`), fetched once per URL. */
function usePeaks(url: string | undefined): { rate: number; peaks: number[] } | null {
  const [got, setGot] = useState<{
    url: string;
    rate: number;
    peaks: number[];
  } | null>(null);
  useEffect(() => {
    if (!url) return;
    let dead = false;
    void fetch(url, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        const o = j as { rate?: unknown; peaks?: unknown } | null;
        if (dead || !o || typeof o.rate !== "number" || !Array.isArray(o.peaks)) return;
        setGot({
          url,
          rate: o.rate,
          peaks: o.peaks.map((x) => (typeof x === "number" ? Math.max(0, Math.min(1, x)) : 0)),
        });
      })
      .catch(() => undefined);
    return () => void (dead = true);
  }, [url]);
  return got && got.url === url ? got : null;
}

/** The waveform under the voice scrub (Nikita, 2026-11-26: "the voice and mix should be a waveform"). */
function Wave({ url, dur, t }: { url: string; dur: number; t: number }) {
  const data = usePeaks(url);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current;
    if (!c || !data) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(c.clientWidth * dpr));
    const H = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, W, H);
    const total = dur || data.peaks.length / data.rate;
    const step = 2 * dpr;
    const played = (t / total) * W;
    for (let x = 0; x < W; x += step) {
      const i0 = Math.floor((x / W) * total * data.rate);
      const i1 = Math.max(i0 + 1, Math.floor(((x + step) / W) * total * data.rate));
      let v = 0;
      for (let i = i0; i < i1 && i < data.peaks.length; i++) v = Math.max(v, data.peaks[i]!);
      const h = Math.max(dpr, v * (H - 4 * dpr));
      g.fillStyle = x < played ? "rgba(255,226,170,.95)" : "rgba(201,168,92,.45)";
      g.fillRect(x, (H - h) / 2, step - dpr * 0.6, h);
    }
  }, [data, dur, t]);
  return <canvas ref={cv} className="sx-wave" aria-hidden="true" />;
}

/** One frame of the cut's thumbnail sheet, as CSS background, at a given height. */
function frameStyle(sp: Sprite, i: number, h: number) {
  const k = h / sp.h;
  const n = Math.max(0, Math.min(sp.n - 1, i));
  return {
    width: `${sp.w * k}px`,
    height: `${h}px`,
    backgroundImage: `url("${sp.url}")`,
    backgroundSize: `${sp.cols * sp.w * k}px auto`,
    backgroundPosition: `${-(n % sp.cols) * sp.w * k}px ${-Math.floor(n / sp.cols) * sp.h * k}px`,
  };
}

export function Scrub({
  player,
  notes,
  mark,
  setMark,
  sprite,
  peaks,
}: {
  player: Player;
  notes: Note[];
  mark: { a?: number; b?: number };
  setMark: (m: { a?: number; b?: number }) => void;
  sprite?: Sprite;
  peaks?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const d = player.dur || 1;
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / d) * 100))}%`;
  const tAt = (e: RPointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(d, ((e.clientX - r.left) / r.width) * d));
  };
  // The thumbnail strip: as many frames as fit across at the strip's height, each the moment under its middle.
  const STRIP_H = 64;
  const tileW = sprite ? (sprite.w * STRIP_H) / sprite.h : 0;
  const tiles = sprite && width ? Math.max(1, Math.ceil(width / tileW)) : 0;
  const peek = hover;
  return (
    <div
      ref={bar}
      className="sx-scrub"
      data-rich={sprite ? "sprite" : peaks ? "wave" : undefined}
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
        setHover(t);
        if (e.shiftKey) {
          drag.current = t;
          setMark({ a: t });
        } else player.seek(t);
      }}
      onPointerMove={(e) => {
        const t = tAt(e);
        if (e.pointerType === "mouse" || e.buttons === 1) setHover(t);
        if (e.buttons !== 1) return;
        if (drag.current !== null) setMark(t > drag.current ? { a: drag.current, b: t } : { a: t, b: drag.current });
        else player.seek(t);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.pointerType !== "mouse") setHover(null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      {sprite && tiles > 0 && (
        <div className="sx-strip" aria-hidden="true">
          {Array.from({ length: tiles }, (_, i) => {
            const t = ((i + 0.5) / tiles) * d;
            return <i key={i} style={frameStyle(sprite, Math.floor(t / sprite.every), STRIP_H)} />;
          })}
        </div>
      )}
      {peaks && <Wave url={peaks} dur={player.dur} t={player.t} />}
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
            <span
              key={n.id}
              className="sx-mk is-range"
              data-state={n.state ?? "sent"}
              style={{
                left: pct(n.t!),
                width: `calc(${pct(n.t2)} - ${pct(n.t!)})`,
              }}
              title={n.text}
            />
          ) : (
            <span key={n.id} className="sx-mk" data-state={n.state ?? "sent"} style={{ left: pct(n.t!) }} title={n.text} />
          ),
        )}
      {mark.a !== undefined && (
        <span
          className="sx-sel"
          style={{
            left: pct(mark.a),
            width: mark.b !== undefined ? `calc(${pct(mark.b)} - ${pct(mark.a)})` : "2px",
          }}
        />
      )}
      <span className="sx-head" style={{ left: pct(player.t) }} />
      {peek !== null && (
        <span
          className="sx-peek"
          style={{
            left: `clamp(${sprite ? 50 : 24}px, ${pct(peek)}, calc(100% - ${sprite ? 50 : 24}px))`,
          }}
          aria-hidden="true"
        >
          {sprite && <i style={frameStyle(sprite, Math.floor(peek / sprite.every), 168)} />}
          <b>{clock(peek)}</b>
        </span>
      )}
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

type Plat = "all" | "tiktok" | "instagram";
const keyOf = (x: PostStat) => `${x.platform}-${x.at}`;
const sum = (xs: PostStat[], f: (x: PostStat) => number) => xs.reduce((n, x) => n + f(x), 0);

/** Per-post views as bars, oldest at the left, with how much of each was watched as a line (Nikita, 2026-11-26:
 * "the analytics are kind of the priority… graphs and stuff front and center"). A click picks the post below. */
function ViewsChart({ posts, on, pick }: { posts: PostStat[]; on?: string; pick: (k: string) => void }) {
  const xs = [...posts].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(-24);
  const W = 640;
  const H = 190;
  const L = 8;
  const R = 34;
  const T = 22;
  const B = 26;
  const max = Math.max(1, ...xs.map((x) => x.views));
  const bw = (W - L - R) / Math.max(1, xs.length);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const yp = (v: number) => T + (H - T - B) * (1 - v / 100);
  const line = xs.map((x, i) => (x.completion === null ? null : ([L + bw * (i + 0.5), yp(x.completion)] as const))).filter((p): p is readonly [number, number] => p !== null);
  return (
    <svg className="sx-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Views per post, with percent watched to the end">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} className="sx-grid" />
      ))}
      <text x={W - R + 4} y={yp(100) + 4} className="sx-axis">
        100%
      </text>
      <text x={W - R + 4} y={yp(50) + 4} className="sx-axis">
        50%
      </text>
      {xs.map((x, i) => {
        const k = keyOf(x);
        const bx = L + bw * i + Math.min(6, bw * 0.15);
        const w = Math.max(3, bw - Math.min(12, bw * 0.3));
        return (
          <g key={k} className="sx-bar" data-on={k === on || undefined} data-p={x.platform} onClick={() => pick(k)}>
            <title>{`${PLATFORM[x.platform] ?? x.platform}, ${new Date(x.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: ${x.views.toLocaleString()} views${x.completion === null ? "" : `, ${Math.round(x.completion)}% watched`}`}</title>
            <rect x={L + bw * i} y={T} width={bw} height={H - T - B} fill="transparent" />
            <rect x={bx} y={y(x.views)} width={w} height={Math.max(1, H - B - y(x.views))} rx={2} className="sx-barfill" />
            {xs.length <= 14 && (
              <text x={bx + w / 2} y={y(x.views) - 5} textAnchor="middle" className="sx-val">
                {short(x.views)}
              </text>
            )}
            {xs.length <= 14 && (
              <text x={bx + w / 2} y={H - 8} textAnchor="middle" className="sx-axis">
                {new Date(x.at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </text>
            )}
          </g>
        );
      })}
      {line.length > 1 && <polyline points={line.map((p) => p.join(",")).join(" ")} className="sx-line" />}
      {line.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={3.5} className="sx-dot" />
      ))}
    </svg>
  );
}

/** Where each post's attention went: shares, sends, saves, likes and follows, per thousand reached. */
function MixBars({ posts }: { posts: PostStat[] }) {
  const reach = sum(posts, (x) => x.reach || x.views);
  const rows: [string, number][] = [
    ["Sends", sum(posts, (x) => x.sends)],
    ["Shares", sum(posts, (x) => x.shares)],
    ["Saves", sum(posts, (x) => x.saves)],
    ["Likes", sum(posts, (x) => x.likes)],
    ["Comments", sum(posts, (x) => x.comments)],
    ["Follows", sum(posts, (x) => x.follows)],
  ];
  const per = (n: number) => (reach ? (n / reach) * 1000 : 0);
  const max = Math.max(1, ...rows.map(([, n]) => per(n)));
  return (
    <ul className="sx-mix" aria-label="Per thousand reached">
      {rows.map(([k, n]) => (
        <li key={k}>
          <span>{k}</span>
          <i style={{ width: `${(per(n) / max) * 100}%` }} />
          <b>{per(n) >= 10 ? Math.round(per(n)) : per(n).toFixed(1)}</b>
        </li>
      ))}
    </ul>
  );
}

export function FeedScreen({ social }: { social: Social | null }) {
  // Analytics first, the feed under it (Nikita, 2026-11-26); one platform or both, posts apart from stories.
  const [plat, setPlat] = useState<Plat>("all");
  const [kind, setKind] = useState<"post" | "story">("post");
  const all = useMemo(() => [...(social?.posts ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [social]);
  const posts = useMemo(() => all.filter((x) => (plat === "all" || x.platform === plat) && (x.kind ?? "post") === kind), [all, plat, kind]);
  const count = (pl: Plat, k: string) => all.filter((x) => (pl === "all" || x.platform === pl) && (x.kind ?? "post") === k).length;
  const [onKey, setOnKey] = useState<string | undefined>(undefined);
  useEffect(() => setOnKey(undefined), [plat, kind]);
  const post: PostStat | undefined = posts.find((x) => keyOf(x) === onKey) ?? posts[0];
  const comments = (social?.comments ?? []).filter((c) => post && c.platform === post.platform && (c.post === post.text || post.text.startsWith(c.post) || c.post.startsWith(post.text.slice(0, 40))));
  const profs = (social?.profiles ?? []).filter((pr) => plat === "all" || pr.platform === plat);
  const prof = profs[0];
  const followers = profs.reduce((n, pr) => n + pr.followers, 0);
  const views = sum(posts, (x) => x.views);
  const reach = sum(posts, (x) => x.reach);
  const watched = posts.filter((x) => x.completion !== null);
  const avgWatched = watched.length ? sum(watched, (x) => x.completion ?? 0) / watched.length : null;
  const sendRate = reach ? (sum(posts, (x) => x.sends + x.shares) / reach) * 100 : null;
  const follows = sum(posts, (x) => x.follows);
  return (
    <div className="sx sx-feed">
      <header className="sx-feedhead">
        <img src={prof?.avatar ?? PROFILE} alt="The show's profile photo" />
        <div>
          <b>@{prof?.username || "eatingyourneighbors"}</b>
          <span>So, they're eating your neighbors.</span>
        </div>
        <nav className="sx-feedtabs" aria-label="Feed">
          <span role="tablist" aria-label="Platform">
            {(["all", "tiktok", "instagram"] as const).map((pl) => (
              <button key={pl} type="button" role="tab" aria-selected={pl === plat} onClick={() => setPlat(pl)}>
                {pl === "all" ? "Both" : (PLATFORM[pl] ?? pl)}
              </button>
            ))}
          </span>
          <span role="tablist" aria-label="Kind" className="sx-feedkind">
            {(["post", "story"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={k === kind} onClick={() => setKind(k)}>
                {k === "post" ? "Posts" : "Stories"} <small>{count(plat, k)}</small>
              </button>
            ))}
          </span>
        </nav>
      </header>
      {!social ? (
        <p className="sx-empty">The numbers aren't in yet. Zernio answers within a few minutes.</p>
      ) : (
        <>
          <section className="sx-analytics" aria-label="Analytics">
            <dl className="sx-kpis">
              {(
                [
                  ["Followers", profs.length ? short(followers) : "—"],
                  ["Views", short(views)],
                  ["Reached", short(reach)],
                  ["Watched to the end", avgWatched === null ? "—" : `${Math.round(avgWatched)}%`],
                  ["Sent or shared", sendRate === null ? "—" : `${sendRate.toFixed(1)}%`],
                  ["New follows", short(follows)],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            {posts.length === 0 ? (
              <p className="sx-empty">{kind === "story" ? "No stories yet." : "Nothing posted here yet."}</p>
            ) : (
              <div className="sx-charts">
                <figure>
                  <figcaption>
                    Views per post{" "}
                    <span className="sx-key">
                      <i className="is-bar" /> views <i className="is-line" /> watched to the end
                    </span>
                  </figcaption>
                  <ViewsChart posts={posts} on={post ? keyOf(post) : undefined} pick={setOnKey} />
                </figure>
                <figure>
                  <figcaption>Per thousand reached</figcaption>
                  <MixBars posts={posts} />
                </figure>
              </div>
            )}
          </section>
          {posts.length > 0 && (
            <div className="sx-feed-grid">
              <ol className="sx-posts" aria-label="Posted videos">
                {posts.map((x) => (
                  <li key={keyOf(x)}>
                    <button type="button" aria-pressed={post !== undefined && keyOf(x) === keyOf(post)} onClick={() => setOnKey(keyOf(x))}>
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
                  {embedOf(post.url) ? (
                    <iframe
                      key={post.url}
                      className="sx-embed"
                      data-p={post.platform}
                      src={embedOf(post.url)!}
                      title={`The ${PLATFORM[post.platform] ?? post.platform} post`}
                      allow="autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      loading="lazy"
                    />
                  ) : post.thumb ? (
                    <img className="sx-embed" src={post.thumb} alt="" />
                  ) : null}
                  <p className="sx-post-t">{post.text || "Untitled"}</p>
                  <p className="sx-post-m">
                    {PLATFORM[post.platform]} ·{" "}
                    {new Date(post.at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
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
        </>
      )}
    </div>
  );
}
