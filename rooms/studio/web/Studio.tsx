import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Keeper } from "@ceo/desk/rooms/parts.tsx";
import "@ceo/desk/rooms/rooms.css";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { act, isPosted, loadDesk, onNoteKept, openOn, setFocus, short, STAGE_LINE, STATUS_TEXT, stageOn, stepsOf, versionsOf, type DeskAction, type DeskView, type Episode } from "../data/desk.ts";
import { PhoneEdit } from "./PhoneEdit.tsx";
import { EditScreen, FeedScreen, PitchScreen, type Player } from "./screens.tsx";
import { StudioStage, type StageApi } from "./StudioStage.tsx";
import type { Mark, ScreenId, StudioView } from "./soundstage.ts";
import "./studio.css";

/**
 * The Studio (#311; the edit suite on a sound stage, #828; live as the zombie guide's desk, #1227; a review suite,
 * #1229): "So, they're eating your neighbors.", short tall explainers on adulting at the end of the world, made by the
 * Director's thread through Nikita's four gates (pitch, script/voice/mix, render, post).
 *
 * The whole desk lives on the suite's monitors in 3D (StudioStage.tsx): Edit in the middle (the episodes in
 * production, their versions, a scrub bar with his notes pinned to a moment or a stretch, Send notes, Approve or
 * Publish), Pitch on the left, the Feed on the right (every posted video, its numbers and its comments). A click on a
 * monitor dollies in to it; Esc or Back steps out. The cut under review plays on the stage's tall frame; a click on the
 * frame docks it beside the edit screen as a reference monitor. On a phone, or without WebGL, the screens lay flat
 * under the stage; on a phone (PhoneEdit.tsx) the desk is its own app: the episodes as cards, Edit, Pitch and Feed
 * behind a tab row, the cut playing at the top of Edit, and a dock with the note box, a hold-to-say mic and the actions. A held L keeps what's said as a note at the moment on screen (../voice.ts). Everything is real
 * (GET /api/studio-desk); nothing posts without Nikita's tap, and he can't change a cut here, only note it.
 */

const SCREENS: { id: ScreenId; t: string }[] = [
  { id: "pitch", t: "Pitch" },
  { id: "edit", t: "Edit" },
  { id: "stats", t: "Feed" },
];
const PHONE_TABS: { id: ScreenId; t: string }[] = [
  { id: "edit", t: "Edit" },
  { id: "pitch", t: "Pitch" },
  { id: "stats", t: "Feed" },
];
const isVideo = (url: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url);
const isPhone = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 760px)").matches;
const REF_SHIFT = 0.3;

export function Studio() {
  const auth = useDeskAuth((s) => s.auth.status);
  const signedIn = auth === "in";
  const [desk, setDesk] = useState<DeskView | null>(null);
  const [down, setDown] = useState(false);
  const [epId, setEpId] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [api, setApi] = useState<StageApi | null>(null);
  const [focused, setFocused] = useState<ScreenId | null>(null);
  const [refOn, setRefOn] = useState(false);
  const [flatTab, setFlatTab] = useState<ScreenId>("edit");
  const [phone, setPhone] = useState(isPhone);
  const [clockT, setClockT] = useState({ t: 0, dur: 0, playing: false });
  const video = useRef<HTMLVideoElement | null>(null);
  // The player can move (the stage's dock on a big screen, the top of Edit on a phone), so its clock follows the element.
  const [vEl, setVEl] = useState<HTMLVideoElement | null>(null);
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    video.current = el;
    setVEl(el);
  }, []);
  const dock = useRef<HTMLDivElement>(null);
  const chose = useRef(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setPhone(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  const read = useCallback(() => {
    if (!signedIn) return;
    void loadDesk().then((l) => {
      if (l.state === "out") return useDeskAuth.getState().lost();
      if (l.state === "down") return setDown(true);
      setDown(false);
      setDesk(l.view);
      if (!chose.current) {
        const at = openOn(l.view.episodes);
        const e = l.view.episodes[at];
        if (e) {
          setEpId(e.id);
          setSel(stageOn(e));
        }
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
  const inProduction = useMemo(() => episodes.filter((e) => !isPosted(e)), [episodes]);
  const ep: Episode | undefined = episodes.find((e) => e.id === epId);
  const stage = STAGE_LINE[sel]!;
  const st = ep?.stages[stage.id];
  const versions = useMemo(() => versionsOf(st), [st]);
  const cur = versions.find((v) => v.v === version) ?? versions[versions.length - 1];
  const media = cur?.media;
  const steps = useMemo(() => stepsOf(ep), [ep]);
  const rolling = episodes.some((e) => Object.values(e.stages).some((s) => s?.status === "working"));
  const view = useMemo<StudioView>(() => ({ steps, sel, episodes: episodes.slice(-6).map((e) => `${e.n}. ${e.title}`), rolling }), [steps, sel, episodes, rolling]);
  const flat = phone || api === null;

  // The newest version opens whenever the stage or episode changes.
  useEffect(() => setVersion(versions[versions.length - 1]?.v ?? 0), [ep?.id, stage.id, versions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A held L pins a note to this version, at this moment.
  useEffect(() => {
    setFocus(ep ? { episode: ep.id, stage: stage.id, at: () => (cur ? { version: cur.v, t: Math.round((video.current?.currentTime ?? 0) * 10) / 10 } : {}) } : {});
  }, [ep, stage.id, cur]);

  // The player's clock, for the transport and scrub bar.
  useEffect(() => {
    const v = vEl;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      setClockT({ t: v.currentTime, dur: Number.isFinite(v.duration) ? v.duration : 0, playing: !v.paused });
      if (!v.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const evs = ["timeupdate", "seeked", "loadedmetadata", "pause", "ended", "emptied"] as const;
    for (const e of evs) v.addEventListener(e, tick);
    v.addEventListener("play", onPlay);
    return () => {
      cancelAnimationFrame(raf);
      for (const e of evs) v.removeEventListener(e, tick);
      v.removeEventListener("play", onPlay);
    };
  }, [vEl]);

  const notes = useMemo(() => (desk?.notes ?? []).filter((n) => ep && n.episode === ep.id && n.stage === stage.id && n.t !== undefined && (n.version === undefined || n.version === cur?.v)), [desk, ep, stage.id, cur]);
  const marks = useMemo<Mark[]>(() => notes.map((n) => ({ t: n.t!, ...(n.t2 !== undefined ? { t2: n.t2 } : {}), sent: n.state !== "draft" })), [notes]);

  // The cut plays on the stage's tall frame.
  useEffect(() => {
    if (!api) return;
    api.setVideo(media && isVideo(media) ? vEl : null, marks);
  }, [api, media, marks, vEl]);

  useEffect(() => {
    if (!api || phone) return;
    api.focus(focused, focused === "edit" && refOn ? REF_SHIFT : 0);
  }, [api, phone, focused, refOn]);

  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.fullscreenElement) return;
      setFocused(null);
      setRefOn(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focused]);

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
  useEffect(() => {
    if (!said) return;
    const t = window.setTimeout(() => setSaid(null), 6_000);
    return () => window.clearTimeout(t);
  }, [said]);

  const openEp = (id: string) => {
    const e = episodes.find((x) => x.id === id);
    if (!e) return;
    chose.current = true;
    setEpId(id);
    setSel(stageOn(e));
    if (!flat) setFocused("edit");
    else setFlatTab("edit");
    // On a phone the chosen episode's cut comes up under the tab row.
    if (phone) window.setTimeout(() => document.querySelector(".px-player")?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  };
  const player: Player = {
    ...clockT,
    toggle: () => {
      const v = video.current;
      if (!v || !media) return;
      if (v.paused) {
        void v.play().catch(() => undefined);
        // Play brings the reference monitor up beside the edit screen by itself (Nikita, 2026-11-25).
        if (!flat) {
          setRefOn(true);
          setFocused("edit");
        }
      } else v.pause();
    },
    seek: (t) => {
      const v = video.current;
      if (v && Number.isFinite(t)) v.currentTime = t;
    },
  };
  const fullscreen = () => {
    // A phone's own player goes full screen (iOS only lets a video do that itself).
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (phone && v) {
      if (v.requestFullscreen) void v.requestFullscreen().catch(() => v.webkitEnterFullscreen?.());
      else v.webkitEnterFullscreen?.();
      return;
    }
    const d = dock.current;
    if (d && !document.fullscreenElement) void d.requestFullscreen?.().catch(() => undefined);
  };
  const onFrame = useCallback(() => {
    setFocused("edit");
    setRefOn(true);
  }, []);
  // A click on the room, off the monitors: back to the stage (Nikita, 2026-11-25).
  const onAway = useCallback(() => {
    setFocused(null);
    setRefOn(false);
  }, []);

  // Space plays and pauses the cut (#1233: talking moved to a held L), wherever focus is, except in a field. Taken on
  // the way down so a focused button is never pressed by it as well.
  const toggleRef = useRef(player.toggle);
  toggleRef.current = player.toggle;
  useEffect(() => {
    if (!media) return;
    const typing = (t: EventTarget | null) => !!(t as Element | null)?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
    const isSpace = (e: KeyboardEvent) => (e.code === "Space" || e.key === " ") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !typing(e.target);
    const down = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) toggleRef.current();
    };
    const up = (e: KeyboardEvent) => {
      if (!isSpace(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, [media]);

  const social = desk?.social ?? null;
  const followers = social?.profiles.reduce((n, p) => n + p.followers, 0) ?? 0;
  const posted = episodes.filter(isPosted).length;

  const screenOf = (id: ScreenId) => {
    if (!signedIn) return <p className="sx-gate">{auth === "checking" ? "Opening the desk…" : "Sign in with your passkey to open the desk."}</p>;
    if (!desk) return <p className="sx-gate">{down ? "The desk is out of reach right now. It'll try again in a minute." : "Opening the desk…"}</p>;
    if (id === "pitch") return <PitchScreen desk={desk} episodes={episodes} openEp={openEp} run={run} busy={busy} />;
    if (id === "stats") return <FeedScreen social={social} />;
    return <EditScreen {...editProps(desk)} />;
  };
  const editProps = (d: DeskView) => ({
    desk: d,
    ep,
    inProduction,
    openEp,
    sel,
    setSel,
    version: cur?.v ?? 0,
    setVersion,
    player,
    refOn,
    toggleRef: () => {
      setRefOn((r) => !r);
      if (!flat) setFocused("edit");
    },
    fullscreen,
    run,
    busy,
  });

  return (
    <div className="wv-page rm rm-studio st-page" data-room="studio" data-phone={phone || undefined} data-focus={focused ?? undefined} data-ref={refOn && !flat ? "on" : undefined}>
      <StudioStage view={view} onReady={setApi} onFrame={onFrame} onAway={onAway}>
        <header className="st-head">
          <p className="st-eyb">
            The Studio <i /> edit suite and sound stage
          </p>
          <h1 className="st-h1 desk__title">
            So, they're eating <em>your neighbors.</em>
          </h1>
          <p className="st-sub">
            {phone
              ? "Adulting at the end of the world, for TikTok and Reels. Watch a cut, pin notes to a moment, send them when you're done."
              : "Adulting at the end of the world, for TikTok and Reels. Click a monitor to work on it, or the stage to watch the cut beside your notes. Hold L to leave a note at that moment. Space plays and pauses."}
          </p>
          <p className={`st-tally${rolling ? " is-on" : ""}`} aria-label={rolling ? "Rolling" : "Not rolling"}>
            <i aria-hidden="true" />
            {rolling ? "Rolling" : "Not rolling"}
          </p>
          <Keeper page="studio" className="st-keeper" />
        </header>
        <dl className="st-stats">
          <div>
            <dt>In production</dt>
            <dd>{inProduction.length}</dd>
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

        {!flat && (
          <nav className="st-jump" aria-label="The monitors">
            {focused ? (
              <button
                type="button"
                className="st-back"
                onClick={() => {
                  setFocused(null);
                  setRefOn(false);
                }}
              >
                ← Back to the stage <kbd>Esc</kbd>
              </button>
            ) : (
              SCREENS.map((s) => (
                <button key={s.id} type="button" onClick={() => setFocused(s.id)}>
                  {s.t}
                </button>
              ))
            )}
            {focused &&
              SCREENS.filter((s) => s.id !== focused).map((s) => (
                <button key={s.id} type="button" onClick={() => setFocused(s.id)}>
                  {s.t}
                </button>
              ))}
          </nav>
        )}

        <div ref={dock} className="st-ref" data-on={(refOn && !flat) || undefined} aria-hidden={!refOn || undefined}>
          {!phone && <video ref={videoRef} className="st-ref-v" src={media} crossOrigin="anonymous" playsInline preload="metadata" onClick={player.toggle} />}
          {refOn && !flat && <p className="st-ref-k">Reference · v{cur?.v ?? "–"}</p>}
        </div>

        {said && (
          <p className="st-said" role="status">
            {said}
            <button type="button" onClick={() => setSaid(null)} aria-label="Dismiss">
              ×
            </button>
          </p>
        )}
      </StudioStage>

      {!flat &&
        api &&
        SCREENS.map(({ id, t }) =>
          createPortal(
            <>
              {screenOf(id)}
              {focused !== id && (
                <button type="button" className="sx-cover" onClick={() => setFocused(id)} aria-label={`Open the ${t} screen`}>
                  <span>{t}</span>
                </button>
              )}
            </>,
            api.screens[id],
            id,
          ),
        )}

      {phone && (
        <section className="px" aria-label="The Studio desk">
          <div className="px-tabs" role="tablist" aria-label="Screens">
            {PHONE_TABS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={flatTab === s.id}
                onClick={(ev) => {
                  setFlatTab(s.id);
                  // A new tab opens at its top, under the tab row.
                  const px = (ev.currentTarget as HTMLElement).closest(".px");
                  if (px && px.getBoundingClientRect().top < 0) px.scrollIntoView({ block: "start" });
                }}
              >
                {s.t}
                {s.id === "edit" && rolling && <i className="px-live" aria-label="Rolling" />}
              </button>
            ))}
          </div>
          {flatTab === "edit" && episodes.length > 0 && (
            <div className="px-eps" aria-label="Episodes">
              {[...episodes]
                .sort((a, b) => Number(isPosted(a)) - Number(isPosted(b)) || a.n - b.n)
                .map((e) => {
                  const on = STAGE_LINE[stageOn(e)]!;
                  const status = e.stages[on.id]?.status ?? "waiting";
                  return (
                    <button key={e.id} type="button" aria-pressed={e.id === ep?.id} data-status={isPosted(e) ? "posted" : status} onClick={() => openEp(e.id)}>
                      <small>{e.n}</small>
                      <b>{e.title}</b>
                      <em>{isPosted(e) ? "Posted" : `${on.t} · ${STATUS_TEXT[status]}`}</em>
                    </button>
                  );
                })}
            </div>
          )}
          <div className="px-body" data-screen={flatTab}>
            {!desk ? (
              <p className="sx-gate">{down ? "The desk is out of reach right now. It'll try again in a minute." : "Opening the desk…"}</p>
            ) : flatTab === "edit" ? (
              <PhoneEdit {...editProps(desk)} video={<video ref={videoRef} className="px-video" src={media} crossOrigin="anonymous" playsInline preload="metadata" onClick={player.toggle} />} />
            ) : (
              <div className="st-screen is-flat" data-screen={flatTab}>
                {screenOf(flatTab)}
              </div>
            )}
          </div>
        </section>
      )}

      {flat && !phone && (
        <section className="st-flatdesk" aria-label="The edit suite">
          <div className="st-flattabs" role="tablist" aria-label="Screens">
            {SCREENS.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={flatTab === s.id} onClick={() => setFlatTab(s.id)}>
                {s.t}
              </button>
            ))}
          </div>
          {flatTab === "edit" && media && isVideo(media) && (
            <button type="button" className="st-flatwatch" onClick={fullscreen}>
              ▶ Watch v{cur?.v} full screen
            </button>
          )}
          <div className="st-screen is-flat" data-screen={flatTab}>
            {screenOf(flatTab)}
          </div>
        </section>
      )}
    </div>
  );
}
