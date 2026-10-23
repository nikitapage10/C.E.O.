import { PORTRAITS } from "../portraits.ts";
import { Keeper, Waits, type Wait } from "./parts.tsx";
import "./rooms.css";

/**
 * The Studio (#311, slice 1): the line that will make a series of short, tall videos teaching how the internet works
 * through apps everyone uses, simple analogy first, then deeper. The Spire's Executive runs the business side; the
 * Studio makes the videos. Nothing is connected yet, so every step says what it waits on, both budgets read $0 of $10
 * with nothing spent, the hero-art slots are planned, and the first episodes are a plan, not progress. Apps are named
 * only as topics: no logos, no numbers the page doesn't have. Nothing is ever posted without Nikita's tap.
 */

interface Step {
  k: string;
  t: string;
  s: string;
  w: string;
}

const LINE: Step[] = [
  { k: "01", t: "Topic", s: "From the Spire: the Executive picks what's next for the series", w: "Waits on the Spire's topic list" },
  { k: "02", t: "Script", s: "The analogy, how it works, how it's built. 45 to 60 seconds", w: "Waits on episode 1, written in the Foundry" },
  { k: "03", t: "Storyboard", s: "One card per shot, each in the phone's tall 9:16 frame", w: "Waits on the script" },
  { k: "04", t: "Art", s: "OpenAI images in saved style presets; Claude-drawn vector art once the cap is hit; your hand-made hero art", w: "Waits on the OpenAI images key" },
  { k: "05", t: "Voice and captions", s: "ElevenLabs, one fixed voice per character; captions burned in", w: "Waits on the ElevenLabs key in Azure Key Vault" },
  { k: "06", t: "Animation", s: "Scenes as code, drawn and moved by Claude", w: "Waits on the scenes in the repo" },
  { k: "07", t: "Render 9:16", s: "A GitHub Actions job renders the MP4", w: "Waits on the render job" },
  { k: "08", t: "Review", s: "You watch it here, with a download, a caption and hashtags", w: "Waits on a first render" },
  { k: "09", t: "Post", s: "TikTok and Instagram, only when you tap", w: "Waits on TikTok, Instagram and your tap" },
];

/** The series' first ideas: a plan, in order, nothing made yet. */
const EPISODES = [
  { t: "Instagram: the front end and the back end", a: "The dining room you sit in, and the kitchen you never see" },
  { t: "Spotify and caching", a: "A fridge by the front door, so you don't walk to the shop for every song" },
  { t: "Rotate your phone: responsive layouts", a: "Furniture that rearranges itself when the room turns" },
  { t: "Why Instagram remembers dark mode", a: "A note the app leaves itself, so it knows how you like the lights" },
  { t: "YouTube's spinner and async JavaScript", a: "Ordering at the counter and getting a buzzer, instead of standing in the kitchen" },
  { t: "TikTok, responsive design and the DOM", a: "The page as a family tree of boxes, and how it fits any screen" },
];

/** Two caps, each with a hard stop, and nothing spent: neither key is connected. */
const BUDGETS = [
  { t: "Voice", who: "ElevenLabs", cap: 10, why: "Waits on the ElevenLabs key in Azure Key Vault" },
  { t: "Images", who: "OpenAI images", cap: 10, why: "Waits on the OpenAI images key" },
];

/** Who gets a slot for hand-made hero art: the crew and the Director. */
const CAST = ["dot", "folio", "arc", "tally"];

const WAITS: Wait[] = [
  { what: "The ElevenLabs key, in Azure Key Vault", why: "One fixed voice per character for the narration. Its own $10 a month cap, with a hard stop. Kept on the server, never here." },
  { what: "The OpenAI images key", why: "The art, in saved style presets. Its own $10 a month cap, with a hard stop; past it the Studio falls back to vector art Claude draws in code." },
  { what: "The render job", why: "A GitHub Actions job that renders the scenes to a 9:16 MP4 with the captions burned in, for review here." },
  { what: "The Spire's topics", why: "The Executive runs the series' business side: which topic is next, and when it goes out." },
  { what: "TikTok and Instagram", why: "Posting, later. Each post goes out only when you tap it.", state: "later" },
];

export function Studio() {
  return (
    <div className="wv-page rm rm-studio" data-room="studio">
      <header className="rm-head">
        <div>
          <p className="wv-eyb">The Studio · the sound stage</p>
          <h1 className="wv-h1 desk__title">
            How the internet works, <em>in under a minute.</em>
          </h1>
          <p className="wv-sub">
            Short, tall videos for TikTok and Reels that explain the tech behind apps everyone uses: a simple analogy first, then how it works, then how it's built. The
            Spire runs the business side; the Studio makes the videos. Nothing is connected yet, and nothing posts without your tap.
          </p>
        </div>
        <Keeper page="studio" />
      </header>

      <section className="st-line" aria-label="The episode line">
        <div className="st-line-head">
          <h2 className="rm-h2">The episode line</h2>
          <p className="st-tally" aria-label="Not rolling">
            <i aria-hidden="true" />
            Not rolling
          </p>
        </div>
        <ol className="st-strip">
          {LINE.map((s) => (
            <li key={s.k}>
              <span className="st-k">{s.k}</span>
              <b>{s.t}</b>
              <span>{s.s}</span>
              <em>{s.w}</em>
            </li>
          ))}
        </ol>
      </section>

      <div className="st-row">
        <section className="st-eps" aria-label="The first episodes">
          <h2 className="rm-h2">The first episodes</h2>
          <p className="st-note">A plan, in order. None is made yet.</p>
          <ol>
            {EPISODES.map((e, i) => (
              <li key={e.t}>
                <span className="st-ep-n">{String(i + 1).padStart(2, "0")}</span>
                <b>{e.t}</b>
                <span>{e.a}</span>
                <em>Planned</em>
              </li>
            ))}
          </ol>
        </section>

        <div className="st-side">
          <section className="st-budgets" aria-label="Budgets">
            <h2 className="rm-h2">Budgets</h2>
            <p className="st-note">Two monthly caps, each with a hard stop. Nothing is spent until a key is connected.</p>
            <ul>
              {BUDGETS.map((b) => (
                <li key={b.t}>
                  <p>
                    <b>{b.t}</b> <span>{b.who}</span>
                  </p>
                  <div className="st-meter" role="meter" aria-valuemin={0} aria-valuemax={b.cap} aria-valuenow={0} aria-label={`${b.who}: $0 of $${b.cap} this month, not connected`}>
                    <i style={{ width: "0%" }} />
                  </div>
                  <p className="st-meter-n">
                    <strong>$0 of ${b.cap}</strong> a month · hard stop · <em>not connected</em>
                  </p>
                  <p className="st-meter-why">{b.why}</p>
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
  );
}
