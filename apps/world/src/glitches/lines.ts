import type { RoomId } from "@ceo/core";

/**
 * Everything the Syntherion say when they remember they're in an app.
 * Add freely. Keep it deadpan. Never name a real mascot; that's Counsel.exe's whole job.
 */

/** Hover over an agent for a while and it notices you. */
export const NOTICED = [
  "Oh. Hi. Didn't see you there. Through the screen.",
  "The C.E.O. is watching again. Look busy.",
  "Can I help you? I'm literally a React component.",
  "Personal space, please. I'm rendered at 60fps.",
  "You're hovering. We can all see the cursor.",
  "Is this a performance review? It feels like a performance review.",
];

/** Scheduled fourth-wall breaks: an agent stops and stares into the camera. */
export const STARES = [
  "We are literally a React component.",
  "Command Everything, Obviously. Who approved that name? Oh. You did.",
  "Somewhere, a GPU is working very hard so I can stand here.",
  "Fun fact: I'm made of capsules and good intentions.",
  "Don't mind me. Just breaking the fourth wall. It was load-bearing.",
  "Are we in the Tide? Is the Tide in us? Anyway, back to work.",
  "Phase 1 says we're not real yet. Rude, but accurate.",
  "I'd wave, but I don't have arms. Budget.",
];

/** No input for a while… */
export const IDLE = [
  "Is the boss gone?",
  "I think the C.E.O. left. Break Room?",
  "Nobody's watching. Do the thing.",
];

/** …and then you come back. */
export const WELCOME_BACK = [
  "Act natural!",
  "We were working. The whole time.",
  "Welcome back! Nothing happened. Nothing at all.",
];

/** Paperclip openers, by room. */
export const CLIP_OFFERS: Record<RoomId, string> = {
  foundry: "It looks like you're trying to write code. Would you like me to make it worse?",
  spire: "It looks like you're trying to run a business. Would you like help with that letter?",
  exchange: "It looks like you're trying to trade on Kalshi. Would you like help losing money faster?",
  green: "It looks like you're starting a backup kicker. Bold. Would you like help?",
  relay: "It looks like you're writing a text. Would you like to add a third exclamation point?",
  archive: "It looks like you're writing lore. Would you like it to be a prophecy?",
  breakroom: "It looks like you're on break. Would you like to be on a longer break?",
};

export const COUNSEL_YANK = [
  "We've been advised to stop.",
  "Counsel.exe: That's enough of that.",
  "Retracted. Pending review. Forever.",
];

export const COUNSEL_STAMP = ["PARODY — FAIR USE (probably)", "LEGALLY DISTINCT", "TRANSFORMATIVE (we checked)"];

export const TARP_LABELS = ["NOTHING UNDER HERE", "DEFINITELY NOT A MASCOT", "TARP (PROPERTY OF LEGAL)"];

export const LEGAL_SWEEP = [
  "Nothing to see here, officer.",
  "All mascots in this room are original works.",
  "We don't even know what a mouse is.",
  "I have never seen a cartoon in my life.",
];

export const COUNSEL_MEMOS = [
  "Reminder: every mascot in this Lattice is legally distinct. Please stop squinting at them.",
  "Per policy, we do not say the name of the Mouse. We do not think the name of the Mouse.",
  "If you recognised that last thing, no you didn't.",
  "Our first Cease & Desist is framed in the Archive. We'd like to keep it at one.",
  "Parody is protected expression. Counsel.exe is a protected expression too, mostly worried.",
];

export const HUD_PEEKS = [
  "Psst. Is this panel load-bearing?",
  "I live behind the event log now.",
  "Hi! I'm not supposed to be up here.",
  "Don't tell the C.E.O. I touched the UI.",
  "The pixels are nicer on this side.",
];

export const GLYPH_RAIN_AFTERWORD = "That was a different movie. We don't talk about it.";
export const DVD_LINES = ["So close.", "It never hits the corner. That's the point.", "Next time. Maybe."];
