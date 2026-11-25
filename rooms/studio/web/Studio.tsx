import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Keeper } from "@ceo/desk/rooms/parts.tsx";
import "@ceo/desk/rooms/rooms.css";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { act, isPosted, loadDesk, onNoteKept, openOn, setFocus, short, STAGE_LINE, stageOn, STATUS_TEXT, stepsOf, type DeskAction, type DeskView, type Episode } from "../data/desk.ts";
import { stepTo } from "./line.ts";
import { ReelSigils } from "./ReelSigils.tsx";
import { StudioStage } from "./StudioStage.tsx";
import type { StudioView } from "./soundstage.ts";
import "./studio.css";

/**
 * The Studio (#311; the edit suite on a sound stage, #828; filling the screen, #932; live as the zombie guide's desk,
 * #1227): "So, they're eating your neighbors.", short tall explainers on adulting at the end of the world, made by
 * the Director's thread through Nikita's four gates (pitch, script/voice/mix, render, post).
 *
 * The page opens on the stage in 3D (StudioStage.tsx), its monitors showing the episode on the line. Under it, the
 * suite's own software, one tab at a time: the Timeline is the selected episode's four stages as clips (arrow keys,
 * Home and End move the playhead) with what to review at each (the pitch or script, the mix, the cut and its stills,
 * caption options), Approve, a note box, and Publish on the post stage; Pitch takes a new idea; the Bin lists the
 * episodes; Profiles shows both accounts' numbers; Comments shows the newest. Held Space on this page keeps what's
 * said as a note on the stage on screen (../voice.ts). Everything is real (GET /api/studio-desk); nothing posts
 * without Nikita's tap.
 */

const TABS = ["line", "pitch", "bin", "profiles", "comments"] as const;
type Tab = (typeof TABS)[number];
const TAB_K: Record<Tab, string> = { line: "Timeline", pitch: "Pitch", bin: "Bin", profiles: "Profiles", comments: "Comments" };
const PLATFORM: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok" };
const ago = (iso: string) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return m < 60 ? `${m}m` : m < 2_880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1_440)}d`;
};
const fileOf = (url: string) => (/\.(mp4|mov|webm)(\?|$)/i.test(url) ? "Watch the cut" : /\.(m4a|mp3|wav|aac)(\?|$)/i.test(url) ? "Listen to the mix" : "Open it");

export function Studio() {
  const auth = useDeskAuth((s) => s.auth.status);
  const signedIn = auth === "in";
  const [desk, setDesk] = useState<DeskView | null>(null);
  const [down, setDown] = useState(false);
  const [epAt, setEpAt] = useState(-1);
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<Tab>("line");
  const [draft, setDraft] = useState("");
  const [pitch, setPitch] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const clips = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const chose = useRef(false);

  const read = useCallback(() => {
    if (!signedIn) return;
    void loadDesk().then((l) => {
      if (l.state === "out") return useDeskAuth.getState().lost();
      if (l.state === "down") return setDown(true);
      setDown(false);
      setDesk(l.view);
      if (!chose.current) {
        const at = openOn(l.view.episodes);
        setEpAt(at);
        if (at >= 0) setSel(stageOn(l.view.episodes[at]!));
      }
    });
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) {
      setDesk(null);
      return;
    }
    read();
    const t = window.setInterval(read, 60_000);
    const off = onNoteKept(read);
    return () => {
      window.clearInterval(t);
      off();
    };
  }, [signedIn, read]);

  const episodes = useMemo(() => desk?.episodes ?? [], [desk]);
  const ep: Episode | undefined = episodes[epAt];
  const stage = STAGE_LINE[sel]!;
  const st = ep?.stages[stage.id];
  const steps = useMemo(() => stepsOf(ep), [ep]);
  const rolling = episodes.some((e) => Object.values(e.stages).some((s) => s?.status === "working"));
  const view = useMemo<StudioView>(() => ({ steps, sel, episodes: episodes.slice(-6).map((e) => `${e.n}. ${e.title}`), rolling }), [steps, sel, episodes, rolling]);

  useEffect(() => setFocus(ep ? { episode: ep.id, stage: stage.id } : {}), [ep, stage.id]);

  const pick = (i: number, focus = false) => {
    setSel(i);
    const b = clips.current[i];
    if (focus && b) {
      b.focus({ preventScroll: true });
      b.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  };
  const openEp = (i: number) => {
    chose.current = true;
    setEpAt(i);
    setSel(stageOn(episodes[i]!));
    setTab("line");
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = stepTo(e.key, sel, STAGE_LINE.length);
    if (to === null) return;
    e.preventDefault();
    pick(to, true);
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = TABS.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to]!);
    tabs.current[to]?.focus();
  };
  const run = async (body: DeskAction, done: string, after?: () => void) => {
    setBusy(true);
    const why = await act(body);
    setBusy(false);
    setSaid(why ?? done);
    if (!why) {
      after?.();
      read();
    }
  };

  const social = desk?.social ?? null;
  const followers = social?.profiles.reduce((n, p) => n + p.followers, 0) ?? 0;
  const posted = episodes.filter(isPosted).length;
  const notesHere = (desk?.notes ?? []).filter((n) => ep && n.episode === ep.id && n.stage === stage.id).slice(-4);
  const badge: Record<Tab, string> = {
    line: ep ? `Ep ${ep.n}` : "—",
    pitch: `${(desk?.ideas ?? []).filter((i) => i.status === "new").length} new`,
    bin: `${episodes.length}`,
    profiles: social ? short(followers) : "—",
    comments: social ? `${social.comments.length}` : "—",
  };

  return (
    <div className="wv-page rm rm-studio st-page" data-room="studio">
      <StudioStage view={view}>
        <header className="st-head">
          <p className="st-eyb">
            The Studio <i /> edit suite and sound stage
          </p>
          <h1 className="st-h1 desk__title">
            So, they're eating <em>your neighbors.</em>
          </h1>
          <p className="st-sub">Adulting at the end of the world, for TikTok and Reels. Pitch an idea, review each stage as the Director makes it, and publish when it's right. Hold Space to leave a note.</p>
          <p className={`st-tally${rolling ? " is-on" : ""}`} aria-label={rolling ? "Rolling" : "Not rolling"}>
            <i aria-hidden="true" />
            {rolling ? "Rolling" : "Not rolling"}
          </p>
        </header>
        <dl className="st-stats">
          <div>
            <dt>On the line</dt>
            <dd>
              {ep ? `Ep ${ep.n}` : "—"}
              {ep && <small>/{STAGE_LINE[stageOn(ep)]!.t.split(",")[0]}</small>}
            </dd>
          </div>
          <div>
            <dt>Episodes</dt>
            <dd>{episodes.length}</dd>
          </div>
          <div>
            <dt>Followers</dt>
            <dd>{social ? short(followers) : "—"}</dd>
          </div>
          <div>
            <dt>Posted</dt>
            <dd>{posted}</dd>
          </div>
        </dl>
      </StudioStage>

      <section className="st-deck" aria-label="The edit suite">
        <ReelSigils />
        <div className="st-deck-top">
          <div className="st-deck-tabs" role="tablist" aria-label="The edit suite">
            {TABS.map((t, i) => (
              <button
                key={t}
                ref={(el) => void (tabs.current[i] = el)}
                type="button"
                role="tab"
                id={`st-tab-${t}`}
                aria-selected={tab === t}
                aria-controls="st-panel"
                tabIndex={tab === t ? 0 : -1}
                className="st-deck-tab"
                onClick={() => setTab(t)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                <span>{TAB_K[t]}</span> <b>{badge[t]}</b>
              </button>
            ))}
          </div>
          <Keeper page="studio" className="st-keeper" />
        </div>

        <div className="st-deck-p" role="tabpanel" id="st-panel" aria-labelledby={`st-tab-${tab}`}>
          {said && (
            <p className="st-said" role="status">
              {said}
              <button type="button" onClick={() => setSaid(null)} aria-label="Dismiss">
                ×
              </button>
            </p>
          )}
          {!signedIn ? (
            <p className="st-note">{auth === "checking" ? "Opening the desk…" : "Sign in with your passkey to open the desk."}</p>
          ) : !desk ? (
            <p className="st-note">{down ? "The desk is out of reach right now. It'll try again in a minute." : "Opening the desk…"}</p>
          ) : (
            <>
              {tab === "line" && (
                <>
                  {episodes.length > 1 && (
                    <div className="st-epbar" role="group" aria-label="Episode">
                      {episodes.map((e, i) => (
                        <button key={e.id} type="button" aria-pressed={i === epAt} onClick={() => openEp(i)}>
                          Ep {e.n}
                        </button>
                      ))}
                    </div>
                  )}
                  {!ep ? (
                    <p className="st-note">No episode on the line yet. Pitch one, and the Director writes it up here.</p>
                  ) : (
                    <>
                      <div className="st-edit">
                        <div className="st-viewer" role="tabpanel" id="st-viewer" aria-labelledby={`st-clip-${sel}`}>
                          <div className="st-frame">
                            {st?.stills?.[0] && <img className="st-frame-img" src={st.stills[0]} alt="" decoding="async" />}
                            <p className="st-frame-k">
                              Ep {ep.n} · {String(sel + 1).padStart(2, "0")} <span>/ 04</span>
                            </p>
                            <h3>{stage.t}</h3>
                            <p className="st-frame-s">{ep.title}</p>
                            <p className="st-frame-w" data-status={st?.status ?? "waiting"}>
                              {STATUS_TEXT[st?.status ?? "waiting"]}
                            </p>
                          </div>
                        </div>
                        <div className="st-tl">
                          <div className="st-tl-bar" aria-hidden="true">
                            <span>
                              Episode {ep.n} · {ep.title}
                            </span>
                            <span className="st-tl-hint">← → to scrub</span>
                          </div>
                          <div className="st-tl-scroll">
                            <div className="st-tl-inner" style={{ "--n": STAGE_LINE.length, "--at": sel } as CSSProperties}>
                              <ol className="st-ruler" aria-hidden="true">
                                {STAGE_LINE.map((s, i) => (
                                  <li key={s.id}>{String(i + 1).padStart(2, "0")}</li>
                                ))}
                              </ol>
                              <div className="st-track">
                                <span className="st-track-l" aria-hidden="true">
                                  V1
                                </span>
                                <div className="st-clips" role="tablist" aria-label="The episode's stages" aria-orientation="horizontal" onKeyDown={onKey}>
                                  {STAGE_LINE.map((s, i) => {
                                    const at = ep.stages[s.id]?.status ?? "waiting";
                                    return (
                                      <button
                                        key={s.id}
                                        ref={(el) => {
                                          clips.current[i] = el;
                                        }}
                                        type="button"
                                        role="tab"
                                        id={`st-clip-${i}`}
                                        className="st-clip"
                                        data-status={at}
                                        aria-selected={i === sel}
                                        aria-controls="st-viewer"
                                        tabIndex={i === sel ? 0 : -1}
                                        onClick={() => pick(i)}
                                      >
                                        <span className="st-k">{String(i + 1).padStart(2, "0")}</span>
                                        <b>{s.t}</b>
                                        <em>{STATUS_TEXT[at]}</em>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="st-track is-empty" aria-hidden="true">
                                <span className="st-track-l">A1</span>
                                <div className="st-empty">Voice and mix · {STATUS_TEXT[ep.stages.mix?.status ?? "waiting"].toLowerCase()}</div>
                              </div>
                              <div className="st-track is-empty" aria-hidden="true">
                                <span className="st-track-l">C1</span>
                                <div className="st-empty">Captions · burned in with the render</div>
                              </div>
                              <i className="st-playhead" aria-hidden="true" />
                            </div>
                          </div>
                        </div>
                      </div>

                      <article className="st-review" aria-label={`${stage.t}, episode ${ep.n}`}>
                        <p className="st-review-what">
                          {stage.s} <b>{stage.you}</b>
                        </p>
                        {st?.text && <pre className="st-script">{st.text}</pre>}
                        {st?.media && (
                          <a className="st-media" href={st.media} target="_blank" rel="noopener noreferrer">
                            ▶ {fileOf(st.media)}
                          </a>
                        )}
                        {!!st?.stills?.length && (
                          <ul className="st-stills" aria-label="Stills">
                            {st.stills.map((u) => (
                              <li key={u}>
                                <a href={u} target="_blank" rel="noopener noreferrer">
                                  <img src={u} alt="A still from the cut" loading="lazy" decoding="async" />
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                        {!!st?.captions?.length && (
                          <ol className="st-captions" aria-label="Caption options">
                            {st.captions.map((c) => (
                              <li key={c}>{c}</li>
                            ))}
                          </ol>
                        )}
                        {!!st?.links?.length && (
                          <p className="st-links">
                            Live:{" "}
                            {st.links.map((u) => (
                              <a key={u} href={u} target="_blank" rel="noopener noreferrer">
                                {/tiktok/i.test(u) ? "TikTok" : /instagram/i.test(u) ? "Instagram" : "the post"}
                              </a>
                            ))}
                          </p>
                        )}
                        {!st && <p className="st-note">Nothing here yet. The Director fills it in when this stage starts.</p>}

                        <div className="st-actions">
                          {stage.id === "post" ? (
                            <button type="button" className="st-go" disabled={busy || st?.status !== "ready" || !st?.draft} onClick={() => void run({ action: "publish", episode: ep.id }, "Publishing in a minute, to Instagram and TikTok.")}>
                              Publish
                            </button>
                          ) : (
                            <button type="button" className="st-go" disabled={busy || st?.status !== "ready"} onClick={() => void run({ action: "approve", episode: ep.id, stage: stage.id }, `${stage.t} approved. The Director moves on.`)}>
                              Approve
                            </button>
                          )}
                        </div>
                        <form
                          className="st-notebox"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (draft.trim()) void run({ action: "note", text: draft.trim(), episode: ep.id, stage: stage.id, via: "typed" }, "Noted. The Director has it.", () => setDraft(""));
                          }}
                        >
                          <label htmlFor="st-note-in">A note for the Director on this stage</label>
                          <textarea id="st-note-in" rows={2} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="The poster's too small. Make the second joke land harder." />
                          <button type="submit" disabled={busy || !draft.trim()}>
                            Send note
                          </button>
                        </form>
                        {notesHere.length > 0 && (
                          <ul className="st-notes" aria-label="Notes on this stage">
                            {notesHere.map((n) => (
                              <li key={n.id}>
                                <span>{n.via === "said" ? "Said" : "Typed"}</span> {n.text}
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    </>
                  )}
                </>
              )}

              {tab === "pitch" && (
                <section className="st-pitch" aria-label="Pitch an idea">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (pitch.trim()) void run({ action: "pitch", text: pitch.trim() }, "Pitched. The Director writes it up as a full pitch for you to approve.", () => setPitch(""));
                    }}
                  >
                    <label htmlFor="st-pitch-in">A rough idea is enough: the topic, a joke, a lesson.</label>
                    <textarea id="st-pitch-in" rows={3} maxLength={2000} value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="Credit scores, but the bank is a lich who only lends to the undead." />
                    <button type="submit" className="st-go" disabled={busy || !pitch.trim()}>
                      Pitch it
                    </button>
                  </form>
                  {desk.ideas.length > 0 && (
                    <ol className="st-ideas">
                      {[...desk.ideas].reverse().map((i) => (
                        <li key={i.id} data-status={i.status}>
                          <b>{i.text}</b>
                          <em>{i.status === "new" ? "New" : i.status === "taken" ? "Taken up" : "Set aside"}</em>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              )}

              {tab === "bin" && (
                <section className="st-eps" aria-label="Episodes">
                  {episodes.length === 0 ? (
                    <p className="st-note">No episodes yet.</p>
                  ) : (
                    <ol>
                      {[...episodes].reverse().map((e) => {
                        const i = episodes.indexOf(e);
                        const thumb = e.stages.render?.stills?.[0];
                        return (
                          <li key={e.id}>
                            <button type="button" className="st-thumb" onClick={() => openEp(i)} aria-label={`Open episode ${e.n}`}>
                              {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" /> : <i />}
                              {String(e.n).padStart(2, "0")}
                            </button>
                            <b>{e.title}</b>
                            <span className="st-ep-a">{STAGE_LINE[stageOn(e)]!.t}</span>
                            <em>{isPosted(e) ? "Posted" : STATUS_TEXT[e.stages[STAGE_LINE[stageOn(e)]!.id]?.status ?? "waiting"]}</em>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              )}

              {tab === "profiles" && (
                <section className="st-profiles" aria-label="Both profiles">
                  {!social ? (
                    <p className="st-note">Zernio can't be read right now, so the numbers are waiting.</p>
                  ) : (
                    <>
                      <ul className="st-prof">
                        {social.profiles.map((p) => (
                          <li key={p.platform}>
                            <p className="st-prof-k">{PLATFORM[p.platform] ?? p.platform}</p>
                            <p className="st-prof-h">
                              {p.avatar && <img src={p.avatar} alt="" width={40} height={40} decoding="async" />}
                              {p.url ? (
                                <a href={p.url} target="_blank" rel="noopener noreferrer">
                                  @{p.username}
                                </a>
                              ) : (
                                <span>@{p.username}</span>
                              )}
                            </p>
                            {p.bio && <p className="st-prof-bio">{p.bio}</p>}
                            <dl>
                              <div>
                                <dt>Followers</dt>
                                <dd>{short(p.followers)}</dd>
                              </div>
                              <div>
                                <dt>Posts</dt>
                                <dd>{short(p.posts)}</dd>
                              </div>
                              {p.likes !== undefined && (
                                <div>
                                  <dt>Likes</dt>
                                  <dd>{short(p.likes)}</dd>
                                </div>
                              )}
                            </dl>
                          </li>
                        ))}
                      </ul>
                      {social.posts.length > 0 && (
                        <table className="st-poststats">
                          <caption>Recent posts</caption>
                          <thead>
                            <tr>
                              <th scope="col">Post</th>
                              <th scope="col">Views</th>
                              <th scope="col">Watched</th>
                              <th scope="col">Shares</th>
                              <th scope="col">Sends</th>
                              <th scope="col">Saves</th>
                              <th scope="col">Follows</th>
                            </tr>
                          </thead>
                          <tbody>
                            {social.posts.slice(0, 12).map((p, i) => (
                              <tr key={`${p.platform}-${p.at}-${i}`}>
                                <th scope="row">
                                  <span>{PLATFORM[p.platform] ?? p.platform}</span>{" "}
                                  {p.url ? (
                                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                                      {p.text.split("\n")[0] || "Post"}
                                    </a>
                                  ) : (
                                    p.text.split("\n")[0] || "Post"
                                  )}
                                </th>
                                <td>{short(p.views)}</td>
                                <td>{p.completion !== null ? `${Math.round(p.completion)}%` : p.watchS !== null ? `${p.watchS}s` : "—"}</td>
                                <td>{short(p.shares)}</td>
                                <td>{short(p.sends)}</td>
                                <td>{short(p.saves)}</td>
                                <td>{short(p.follows)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <p className="st-note">From Zernio, refreshed every five minutes. Watched is the share of plays seen to the end (or the average watch on Reels); shares, sends and saves count for more than likes.</p>
                    </>
                  )}
                </section>
              )}

              {tab === "comments" && (
                <section className="st-comments" aria-label="Newest comments">
                  {!social ? (
                    <p className="st-note">Zernio can't be read right now, so the comments are waiting.</p>
                  ) : social.comments.length === 0 ? (
                    <p className="st-note">No comments yet.</p>
                  ) : (
                    <>
                      <ul>
                        {social.comments.map((c, i) => (
                          <li key={`${c.at}-${i}`}>
                            <p className="st-c-h">
                              <b>@{c.from || "someone"}</b> <span>{PLATFORM[c.platform] ?? c.platform}</span> <span>{ago(c.at)}</span>
                              {c.likes > 0 && <span>♥ {c.likes}</span>}
                            </p>
                            <p className="st-c-t">{c.text}</p>
                            {c.post && <p className="st-c-p">on “{c.post.split("\n")[0]}”</p>}
                          </li>
                        ))}
                      </ul>
                      <p className="st-note">Replies are drafted in your voice in the Director's thread and go out only after your OK.</p>
                    </>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
