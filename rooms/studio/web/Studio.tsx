import { useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { PORTRAITS } from "@ceo/desk/portraits.ts";
import { Keeper } from "@ceo/desk/rooms/parts.tsx";
import "@ceo/desk/rooms/rooms.css";
import { BUDGETS, CAST, EPISODES, LINE, WAITS, stepTo } from "./line.ts";
import { ReelSigils } from "./ReelSigils.tsx";
import { StudioStage } from "./StudioStage.tsx";
import "./studio.css";

/**
 * The Studio (#311; the edit suite on a sound stage, #828; filling the screen, #932): the line that will make a series
 * of short, tall videos teaching how the internet works through apps everyone uses, simple analogy first, then deeper.
 * The Spire's Executive runs the business side; the Studio makes the videos.
 *
 * The page opens on the stage in 3D, the whole screen under the bar (StudioStage.tsx): the edit suite in front, its
 * monitors showing the plan, and the set behind it. Under it, one console that is the suite's own software: the episode
 * line as an edit timeline (nine clips on a track, the selected one in the tall viewer with what it waits on; arrow
 * keys, Home and End move the playhead, and the stage's monitors follow), the bin of first episodes, the budgets as a
 * two-channel mixer, the hero-art slots and what it waits on, one tab at a time. Nothing is connected yet, so every
 * step says what it waits on, both budgets read $0 of $10 with nothing spent, the hero-art slots are planned and the
 * first episodes are a plan, not progress. Nothing is ever posted without Nikita's tap.
 */

const TABS = [
  { id: "line", k: "Timeline", b: `${LINE.length} steps` },
  { id: "bin", k: "Bin", b: `${EPISODES.length} planned` },
  { id: "mixer", k: "Mixer", b: `$0 of $${BUDGETS.reduce((s, b) => s + b.cap, 0)}` },
  { id: "art", k: "Hero art", b: `${CAST.length} slots` },
  { id: "waits", k: "Waits on", b: `${WAITS.length} links` },
] as const;
type Tab = (typeof TABS)[number]["id"];
/** The mixing desk's strips: one per capped service, then the master over both (#932). */
const STRIPS = [
  ...BUDGETS.map((b, i) => ({ ...b, ch: `CH ${String(i + 1).padStart(2, "0")}` })),
  { t: "Master", who: "Both caps", cap: BUDGETS.reduce((n, b) => n + b.cap, 0), why: "The month's whole spend, stopped hard at the sum of the caps", ch: "MST" },
];

export function Studio() {
  const [sel, setSel] = useState(0);
  const [tab, setTab] = useState<Tab>("line");
  const clips = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
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
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = TABS.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to]!.id);
    tabs.current[to]?.focus();
  };
  const cap = BUDGETS.reduce((s, b) => s + b.cap, 0);

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
            Short, tall videos for TikTok and Reels on the tech behind apps everyone uses: a simple analogy first, then how it works, then how it's built. Nothing is connected yet, and nothing posts without your tap.
          </p>
          <p className="st-tally" aria-label="Not rolling">
            <i aria-hidden="true" />
            Not rolling
          </p>
        </header>
        <dl className="st-stats">
          <div>
            <dt>On the line</dt>
            <dd>
              {step.k}
              <small>/{String(LINE.length).padStart(2, "0")}</small>
            </dd>
          </div>
          <div>
            <dt>Episodes</dt>
            <dd>
              0<small>/{EPISODES.length} planned</small>
            </dd>
          </div>
          <div>
            <dt>Spent</dt>
            <dd>
              $0<small>/${cap}</small>
            </dd>
          </div>
          <div>
            <dt>Posted</dt>
            <dd>0</dd>
          </div>
        </dl>
      </StudioStage>

      {/* Under the stage, the suite's own software (#932): the timeline, the bin, the mixer, the art and what it waits
          on, one at a time behind a row of tabs, so the page ends about a screen below the stage. */}
      <section className="st-deck" aria-label="The edit suite">
        <ReelSigils />
        <div className="st-deck-top">
          <div className="st-deck-tabs" role="tablist" aria-label="The edit suite">
            {TABS.map((t, i) => (
              <button
                key={t.id}
                ref={(el) => void (tabs.current[i] = el)}
                type="button"
                role="tab"
                id={`st-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="st-panel"
                tabIndex={tab === t.id ? 0 : -1}
                className="st-deck-tab"
                onClick={() => setTab(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                <span>{t.k}</span> <b>{t.b}</b>
              </button>
            ))}
          </div>
          <Keeper page="studio" className="st-keeper" />
        </div>

        <div className="st-deck-p" role="tabpanel" id="st-panel" aria-labelledby={`st-tab-${tab}`}>
          {tab === "line" && (
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
                  <span>The episode line · nine steps from topic to post</span>
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
          )}

          {tab === "bin" && (
            <section className="st-eps" aria-label="The first episodes">
              <p className="st-note">A plan, in order. None is made yet.</p>
              <ol>
                {EPISODES.map((e, i) => (
                  <li key={e.t}>
                    <span className="st-thumb" aria-hidden="true">
                      <i />
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <b>{e.t}</b>
                    <span className="st-ep-a">{e.a}</span>
                    <em>Planned</em>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {tab === "mixer" && (
            <section className="st-budgets" aria-label="Budgets">
              <p className="st-note">Two monthly caps, each with a hard stop. Nothing is spent until a key is connected.</p>
              {/* The edit bay's mixing desk (#932): a channel strip per paid service and the master, each fader sitting at what
                  has been spent this month against its cap (all at zero until a key is connected), the hard stop as the red
                  line at the top of its throw. */}
              <ul className="st-mixer st-desk">
                {STRIPS.map((b) => (
                  <li key={b.t} className={b.ch === "MST" ? "is-master" : undefined}>
                    <span className="st-strip-k" aria-hidden="true">
                      {b.ch}
                    </span>
                    <span className="st-knob" aria-hidden="true" />
                    <div className="st-meter" role="meter" aria-valuemin={0} aria-valuemax={b.cap} aria-valuenow={0} aria-label={`${b.who}: $0 of $${b.cap} this month, not connected`}>
                      <i style={{ height: "0%" }} />
                      <span className="st-stop" aria-hidden="true" />
                      <span className="st-cap" aria-hidden="true" style={{ bottom: "0%" }} />
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
          )}

          {tab === "art" && (
            <section className="st-art" aria-label="Hero art">
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
          )}

          {tab === "waits" && (
            <ol className="st-waits st-patch">
              {WAITS.map((w) => (
                <li key={w.what} data-state={w.state ?? "needed"}>
                  {/* A patch bay (#932): each thing the line waits on is an input with its jack still empty. */}
                  <span className="st-jack" aria-hidden="true">
                    <i />
                  </span>
                  <span className="st-waits-k" aria-hidden="true">
                    {w.state === "later" ? "LATER" : "OFFLINE"}
                  </span>
                  <b>{w.what}</b>
                  <span>{w.why}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
