import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { PORTRAITS } from "@ceo/desk/portraits.ts";
import { Keeper, Waits } from "@ceo/desk/rooms/parts.tsx";
import "@ceo/desk/rooms/rooms.css";
import { BUDGETS, CAST, EPISODES, LINE, WAITS, stepTo } from "./line.ts";
import { StudioStage } from "./StudioStage.tsx";
import "./studio.css";

/**
 * The Studio (#311; the edit suite on a sound stage, #828): the line that will make a series of short, tall videos
 * teaching how the internet works through apps everyone uses, simple analogy first, then deeper. The Spire's Executive
 * runs the business side; the Studio makes the videos.
 *
 * The page opens on the stage in 3D (StudioStage.tsx): the edit suite in front, its monitors showing the plan, and the
 * set behind it. Under it, the episode line is an edit timeline: nine clips on a track, the selected one in the tall
 * viewer with what it waits on (arrow keys, Home and End move the playhead). Nothing is connected yet, so every step
 * says what it waits on, both budgets read $0 of $10 with nothing spent, the hero-art slots are planned and the first
 * episodes are a plan, not progress. Nothing is ever posted without Nikita's tap.
 */

export function Studio() {
  const [sel, setSel] = useState(0);
  const clips = useRef<(HTMLButtonElement | null)[]>([]);
  const step = LINE[sel]!;
  const pick = (i: number, focus = false) => {
    setSel(i);
    const b = clips.current[i];
    if (focus && b) {
      b.focus({ preventScroll: true });
      b.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = stepTo(e.key, sel);
    if (to === null) return;
    e.preventDefault();
    pick(to, true);
  };

  return (
    <div className="wv-page rm rm-studio st-page" data-room="studio">
      <StudioStage sel={sel}>
        <header className="st-head">
          <p className="st-eyb">
            The Studio <i /> edit suite and sound stage
          </p>
          <h1 className="st-h1 desk__title">
            How the internet works, <em>in under a minute.</em>
          </h1>
          <p className="st-sub">
            Short, tall videos for TikTok and Reels that explain the tech behind apps everyone uses: a simple analogy first, then how it works, then how it's built. The Spire runs
            the business side; the Studio makes the videos. Nothing is connected yet, and nothing posts without your tap.
          </p>
          <p className="st-tally" aria-label="Not rolling">
            <i aria-hidden="true" />
            Not rolling
          </p>
        </header>
      </StudioStage>

      <div className="st-body">
        <Keeper page="studio" className="st-keeper" />

        <section className="st-suite" aria-labelledby="st-line-h">
          <div className="st-suite-head">
            <h2 id="st-line-h" className="rm-h2">
              The episode line
            </h2>
            <p className="st-note">Nine steps from topic to post. Each waits on something; pick a clip to see what.</p>
          </div>
          <div className="st-edit">
            <div className="st-viewer" role="tabpanel" id="st-viewer" aria-labelledby={`st-clip-${sel}`}>
              <div className="st-frame">
                <p className="st-frame-k">
                  Step {step.k} <span>/ {String(LINE.length).padStart(2, "0")}</span>
                </p>
                <h3>{step.t}</h3>
                <p className="st-frame-s">{step.s}</p>
                <p className="st-frame-w">{step.w}</p>
                <p className="st-frame-tc" aria-hidden="true">
                  00:00:00:00 · 9:16
                </p>
              </div>
            </div>
            <div className="st-tl">
              <div className="st-tl-bar" aria-hidden="true">
                <span>Timeline</span>
                <span className="st-tc">00:00:00:00</span>
                <span className="st-tl-hint">← → to scrub</span>
              </div>
              <div className="st-tl-scroll">
                <div className="st-tl-inner" style={{ "--n": LINE.length, "--at": sel } as CSSProperties}>
                  <ol className="st-ruler" aria-hidden="true">
                    {LINE.map((s) => (
                      <li key={s.k}>{s.k}</li>
                    ))}
                  </ol>
                  <div className="st-track">
                    <span className="st-track-l" aria-hidden="true">
                      V1
                    </span>
                    <div className="st-clips" role="tablist" aria-label="The episode line's steps" aria-orientation="horizontal" onKeyDown={onKey}>
                      {LINE.map((s, i) => (
                        <button
                          key={s.k}
                          ref={(el) => {
                            clips.current[i] = el;
                          }}
                          type="button"
                          role="tab"
                          id={`st-clip-${i}`}
                          className="st-clip"
                          aria-selected={i === sel}
                          aria-controls="st-viewer"
                          tabIndex={i === sel ? 0 : -1}
                          onClick={() => pick(i)}
                        >
                          <span className="st-k">{s.k}</span>
                          <b>{s.t}</b>
                          <em>{s.w.replace(/^Waits on /, "")}</em>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="st-track is-empty" aria-hidden="true">
                    <span className="st-track-l">A1</span>
                    <div className="st-empty">Voice · waits on the ElevenLabs key</div>
                  </div>
                  <div className="st-track is-empty" aria-hidden="true">
                    <span className="st-track-l">C1</span>
                    <div className="st-empty">Captions · burned in once there's a voice</div>
                  </div>
                  <i className="st-playhead" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="st-row">
          <section className="st-eps" aria-label="The first episodes">
            <h2 className="rm-h2">The bin: first episodes</h2>
            <p className="st-note">A plan, in order. None is made yet.</p>
            <ol>
              {EPISODES.map((e, i) => (
                <li key={e.t}>
                  <span className="st-thumb" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <b>{e.t}</b>
                  <span className="st-ep-a">{e.a}</span>
                  <em>Planned</em>
                </li>
              ))}
            </ol>
          </section>

          <div className="st-side">
            <section className="st-budgets" aria-label="Budgets">
              <h2 className="rm-h2">Budgets</h2>
              <p className="st-note">Two monthly caps, each with a hard stop. Nothing is spent until a key is connected.</p>
              <ul className="st-mixer">
                {BUDGETS.map((b) => (
                  <li key={b.t}>
                    <div className="st-meter" role="meter" aria-valuemin={0} aria-valuemax={b.cap} aria-valuenow={0} aria-label={`${b.who}: $0 of $${b.cap} this month, not connected`}>
                      <i style={{ height: "0%" }} />
                      <span className="st-stop" aria-hidden="true" />
                    </div>
                    <div className="st-ch">
                      <p>
                        <b>{b.t}</b> <span>{b.who}</span>
                      </p>
                      <p className="st-meter-n">
                        <strong>$0 of ${b.cap}</strong> a month · hard stop · <em>not connected</em>
                      </p>
                      <p className="st-meter-why">{b.why}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="st-art" aria-label="Hero art">
              <h2 className="rm-h2">Hero art</h2>
              <p className="st-note">A slot per character for art you make by hand. Planned: uploads open in a later slice.</p>
              <ul>
                {CAST.map((id) => (
                  <li key={id}>
                    <img src={`/desk/agent-${id}.webp`} alt="" width={44} height={44} decoding="async" />
                    <b>{PORTRAITS[id]?.name ?? id}</b>
                    <span className="st-slot" aria-label="Upload slot, not open yet">
                      9:16 · planned
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <Waits items={WAITS} className="st-waits" />
      </div>
    </div>
  );
}
