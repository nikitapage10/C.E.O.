import { type ReactNode } from "react";
import { micPress, micRelease } from "@ceo/desk/roomvoice/roomVoice.ts";
import { clock, STAGE_LINE, STATUS_TEXT } from "../data/desk.ts";
import { NoteRow, Scrub, useEdit, type EditProps } from "./screens.tsx";

/**
 * The Edit screen on a phone (Nikita, 2026-11-25 21:12Z: "all the same functionality, but in a much more sophisticated
 * version for the mobile experience"). The same state and actions as the monitor's EditScreen (useEdit), laid out for a
 * thumb: the cut plays at the top, tap it to play or pause; under it a tall touch scrub with his notes on it, the
 * transport with mark in and out for a stretch, the stages and versions as chips, the notes, and a dock pinned over the
 * Desk's bottom bar with the note box, a hold-to-say mic (the room voice, so what's said lands at this moment like a
 * held L), Send notes and Approve or Publish.
 */
export function PhoneEdit(p: EditProps & { video: ReactNode }) {
  const { ep, sel, player, run, busy } = p;
  const e = useEdit(p);
  const { stage, st, versions, timed, mark, setMark, text, setText, here, drafts, range, at, add } = e;
  if (!ep) return <p className="px-empty">Nothing in production. Pitch an idea and the Director writes it up; it lands here.</p>;
  const say = {
    onPointerDown: (ev: React.PointerEvent) => {
      ev.preventDefault();
      micPress("studio");
    },
    onPointerUp: () => micRelease(),
    onPointerCancel: () => micRelease(),
    onContextMenu: (ev: React.MouseEvent) => ev.preventDefault(),
  };

  return (
    <div className="px-edit">
      <div className="px-title">
        {e.titling ? (
          <form
            onSubmit={(f) => {
              f.preventDefault();
              e.saveTitle(e.titleText);
            }}
          >
            <input value={e.titleText} onChange={(x) => e.setTitleText(x.target.value)} maxLength={200} aria-label="Episode title" autoFocus />
            <button type="submit">Save</button>
            <button type="button" onClick={() => e.setTitling(false)} aria-label="Cancel">
              ×
            </button>
          </form>
        ) : (
          <>
            <button
              type="button"
              className="px-titlebtn"
              onClick={() => {
                e.setTitleText(ep.title);
                e.setTitling(true);
              }}
            >
              <small>Ep {ep.n}</small>
              {ep.title}
            </button>
            {e.canReroll && (
              <button type="button" className="px-reroll" disabled={busy} onClick={e.reroll} aria-label="Re-roll the title">
                ⟳
              </button>
            )}
          </>
        )}
      </div>

      <div className="px-stages" role="tablist" aria-label="Stages">
        {STAGE_LINE.map((s, i) => {
          const status = ep.stages[s.id]?.status ?? "waiting";
          return (
            <button key={s.id} type="button" role="tab" aria-selected={i === sel} data-status={status} onClick={() => p.setSel(i)}>
              <i aria-hidden="true" />
              <b>{s.t}</b>
              <em>{STATUS_TEXT[status]}</em>
            </button>
          );
        })}
      </div>

      {timed ? (
        <>
          <div className="px-player" data-playing={player.playing || undefined}>
            {p.video}
            <span className="px-what">
              {stage.id === "mix" ? "Sound mix · the picture is a still" : `${stage.t} · v${p.version}`}
            </span>
            {/* One tap layer over the picture, always mounted, so a tap plays or pauses exactly once (no second tap
                landing on the video as the play button leaves). */}
            <button type="button" className="px-tap" onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"}>
              <span className="px-bigplay" data-hide={player.playing || undefined} aria-hidden="true">
                ▶
              </span>
            </button>
            <span className="px-tc">
              {clock(player.t)} <small>/ {clock(player.dur)}</small>
            </span>
            <button type="button" className="px-full" onClick={p.fullscreen} aria-label="Full screen">
              ⛶
            </button>
          </div>
          <div className="px-scrub">
            <Scrub player={player} notes={here} mark={mark} setMark={setMark} />
          </div>
          <div className="px-transport">
            <button type="button" onClick={() => player.seek(Math.max(0, player.t - 5))} aria-label="Back 5 seconds">
              −5
            </button>
            <button type="button" className="px-play" onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"}>
              {player.playing ? "❚❚" : "▶"}
            </button>
            <button type="button" onClick={() => player.seek(Math.min(player.dur, player.t + 5))} aria-label="Forward 5 seconds">
              +5
            </button>
            <span className="px-sp" />
            <button type="button" className="px-mark" aria-pressed={mark.a !== undefined} onClick={() => setMark((m) => ({ a: player.t, b: m.b !== undefined && m.b > player.t ? m.b : undefined }))}>
              In{mark.a !== undefined ? <small>{clock(mark.a)}</small> : null}
            </button>
            <button type="button" className="px-mark" aria-pressed={mark.b !== undefined} disabled={mark.a === undefined} onClick={() => setMark((m) => (m.a !== undefined && player.t > m.a ? { ...m, b: player.t } : m))}>
              Out{mark.b !== undefined ? <small>{clock(mark.b)}</small> : null}
            </button>
            {(mark.a !== undefined || mark.b !== undefined) && (
              <button type="button" onClick={() => setMark({})} aria-label="Clear the marks">
                ×
              </button>
            )}
          </div>
          {versions.length > 1 && (
            <div className="px-versions" aria-label="Versions">
              {[...versions].reverse().map((v, i) => (
                <button key={v.v} type="button" aria-pressed={v.v === p.version} onClick={() => p.setVersion(v.v)} title={v.label}>
                  <b>v{v.v}</b>
                  {i === 0 && <small>latest</small>}
                </button>
              ))}
            </div>
          )}
          {versions.find((v) => v.v === p.version)?.label && <p className="px-vlabel">{versions.find((v) => v.v === p.version)!.label}</p>}
        </>
      ) : (
        <div className="px-read">
          {st?.cover && <img className="px-cover" src={st.cover} alt={`Cover for ${ep.title}`} loading="lazy" />}
          {st?.text ? <pre>{st.text}</pre> : !st?.captions?.length && !st?.cover && <p className="px-empty">Nothing here yet. The Director fills it in when this stage starts.</p>}
          {!!st?.captions?.length && (
            <ol className="px-caps" aria-label="Caption options">
              {st.captions.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      <section className="px-notes" aria-label="Notes">
        <h4>
          Notes{timed ? ` on v${p.version}` : ""} <small>{here.length}</small>
        </h4>
        <ul className="sx-notes-list">
          {here.map((n) => (
            <NoteRow key={n.id} n={n} seek={timed ? player.seek : undefined} drop={n.state === "draft" ? () => void run({ action: "unnote", id: n.id }, "Draft dropped.") : undefined} />
          ))}
          {here.length === 0 && <li className="px-empty">No notes yet. Pause on a moment and type, or hold the mic and say it.</li>}
        </ul>
      </section>

      <div className="px-dock">
        <form
          className="px-compose"
          onSubmit={(f) => {
            f.preventDefault();
            add();
          }}
        >
          {timed && (
            <span className="px-at" data-range={range ? "1" : undefined}>
              {at}
            </span>
          )}
          <input value={text} onChange={(x) => setText(x.target.value)} maxLength={2000} placeholder={range ? "This stretch…" : timed ? "A note here…" : "A note on this stage…"} aria-label="Note" enterKeyHint="send" />
          {text.trim() ? (
            <button type="submit" className="px-add" disabled={busy}>
              Add
            </button>
          ) : (
            <button type="button" className="px-mic" aria-label="Hold to say a note" {...say}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2Z" fill="currentColor" />
              </svg>
            </button>
          )}
        </form>
        <div className="px-acts">
          {e.asking ? (
            <span className="px-ask" role="group" aria-label="A render is under way">
              <em>A render is running.</em>
              <button type="button" className="px-send" disabled={busy} onClick={() => e.sendNow(false)}>
                Interrupt
              </button>
              <button type="button" disabled={busy} onClick={() => e.sendNow(true)}>
                Hold for next
              </button>
              <button type="button" onClick={() => e.setAsking(false)} aria-label="Cancel">
                ×
              </button>
            </span>
          ) : (
            <>
              <button type="button" className="px-send" disabled={busy || drafts.length === 0} onClick={() => (e.asks ? e.setAsking(true) : e.sendNow(false))}>
                Send notes{drafts.length ? ` · ${drafts.length}` : ""}
              </button>
              <button type="button" className="px-go" disabled={busy || !e.canApprove} onClick={e.approve}>
                {stage.id === "post" ? "Publish" : "Approve"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
