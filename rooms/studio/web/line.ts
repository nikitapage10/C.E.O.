import type { Wait } from "@ceo/engine/web/RoomParts.tsx";

/**
 * What the Studio shows (#311), kept apart from the page so the stage (soundstage.ts) draws the same plan on its
 * monitors that the page lists. Nothing is connected yet: every step says what it waits on, both budgets read $0 of
 * $10 with nothing spent, the hero-art slots are planned and the first episodes are a plan, not progress. Apps are
 * named only as topics: no logos, no numbers the page doesn't have.
 */

export interface Step {
  k: string;
  t: string;
  s: string;
  w: string;
}

export const LINE: Step[] = [
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
export const EPISODES = [
  { t: "Instagram: the front end and the back end", a: "The dining room you sit in, and the kitchen you never see" },
  { t: "Spotify and caching", a: "A fridge by the front door, so you don't walk to the shop for every song" },
  { t: "Rotate your phone: responsive layouts", a: "Furniture that rearranges itself when the room turns" },
  { t: "Why Instagram remembers dark mode", a: "A note the app leaves itself, so it knows how you like the lights" },
  { t: "YouTube's spinner and async JavaScript", a: "Ordering at the counter and getting a buzzer, instead of standing in the kitchen" },
  { t: "TikTok, responsive design and the DOM", a: "The page as a family tree of boxes, and how it fits any screen" },
];

/** Two caps, each with a hard stop, and nothing spent: neither key is connected. */
export const BUDGETS = [
  { t: "Voice", who: "ElevenLabs", cap: 10, why: "Waits on the ElevenLabs key in Azure Key Vault" },
  { t: "Images", who: "OpenAI images", cap: 10, why: "Waits on the OpenAI images key" },
];

/** Who gets a slot for hand-made hero art: the crew and the Director. */
export const CAST = ["dot", "folio", "arc", "tally"];

export const WAITS: Wait[] = [
  { what: "The ElevenLabs key, in Azure Key Vault", why: "One fixed voice per character for the narration. Its own $10 a month cap, with a hard stop. Kept on the server, never here." },
  { what: "The OpenAI images key", why: "The art, in saved style presets. Its own $10 a month cap, with a hard stop; past it the Studio falls back to vector art Claude draws in code." },
  { what: "The render job", why: "A GitHub Actions job that renders the scenes to a 9:16 MP4 with the captions burned in, for review here." },
  { what: "The Spire's topics", why: "The Executive runs the series' business side: which topic is next, and when it goes out." },
  { what: "TikTok and Instagram", why: "Posting, later. Each post goes out only when you tap it.", state: "later" },
];

/**
 * Where a key press moves the timeline's selection (the episode line's clips are tabs): the arrows step, Home and End
 * jump to the ends, nothing wraps. Null for a key the timeline leaves alone.
 */
export function stepTo(key: string, at: number, count = LINE.length): number | null {
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(last, at + 1);
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(0, at - 1);
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}
