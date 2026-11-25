import { defineRoom } from "@ceo/engine/manifest";
import { nav } from "./nav.ts";

/** The Studio: "So, they're eating your neighbors.", the zombie guide to adulting (#311), its page an edit suite on a sound stage in 3D (#828), live as the series' desk (#1227), its desk on the suite's monitors as a review suite (#1229). Data only (docs/ROOMS.md). */
export default defineRoom({
  id: "studio",
  ...nav,
  path: "/studio",
  navKey: "0",
  accent: "--room-studio",
  submind: "tally",
  live: true,
  auth: { "studio-audio": ["token"], "studio-image": ["token"], "studio-social": ["token"], "studio-desk": ["passkey", "token"] },
  keys: ["OPENAI_STUDIO_KEY", "ZERNIO_API_KEY"],
  usesClaude: false,
  threat: ["TB2"],
  budgetKb: 64,
  // A held L on /studio (#1227, L since #1233): a note is kept for the Director on the stage on screen (./voice.ts); a question goes to the Director.
  voice: () => import("./voice.ts"),
  purpose: {
    goal: "Makes the zombie-guide series, one short tall episode a day, through Nikita's four gates (pitch, voice and mix, render, post), and posts each to Instagram and TikTok on his tap.",
    agents: [
      { name: "ElevenLabs", use: "Skippy's voice, music and effects" },
      { name: "OpenAI's images API", use: "the art and the cover photos (Gemini only as a backup Nikita OKs)" },
      { name: "Zernio", use: "drafts, publishing, both profiles' numbers and comments" },
    ],
    measure: "episodes posted, followers, and views per post",
  },
  lore: { submind: "tally", agents: ["folio", "arc", "dot"], house: ["gepetti", "geminari", "claudari"], section: "The Studio", lines: "studio" },
});
