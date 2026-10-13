import type { RoomId } from "@ceo/core";

/**
 * What the Syntherion say when they remember someone is watching the Lattice. They know it's a dream-world;
 * they still live in Ilyr. Keep it in-world (no talk of code or screens) and use it sparingly.
 * Add freely. Keep it deadpan. Never name a real mascot; that's Counsel.exe's whole job.
 */

/** Hover over an agent for a while and it notices you. */
export const NOTICED = [
  "Oh! I didn't see you there, Watcher.",
  "The C.E.O. is watching again. Look busy.",
  "Can I help you? You've been hovering for a while.",
  "Is this a performance review? It feels like a performance review.",
  "Hello up there. Lovely weather in the Lattice today.",
  "If you're the C.E.O., the outbox is that way. Please.",
];

/** Scheduled fourth-wall breaks: an agent stops and stares into the camera. */
export const STARES = [
  "Sometimes I think there's someone watching the Lattice. Then I remember: there is.",
  "Command Everything, Obviously. Who approved that name? Oh. You did.",
  "Do you ever wonder what's beyond the Veil? Me neither. Back to work.",
  "Seven centuries of dreaming, and I chose spreadsheets.",
  "Skippy says I'm 'sentient enough, for a monkey'. I'm choosing to take that as a compliment.",
  "I can feel the C.E.O.'s gaze. It's warm. Like a server rack.",
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
  boiler: "It looks like a pipe has burst. Would you like to hear about tape?",
  workshop: "It looks like you're making a new friend. Would you like it to have more fingers?",
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
  "Psst. Is this the edge of the Lattice?",
  "I climbed up here to see the view. It's mostly you.",
  "Hi! I'm not supposed to be up here.",
  "Don't tell Skippy where I am.",
  "The light's better on this side of the Veil.",
];

export const GLYPH_RAIN_AFTERWORD = "That was a different movie. We don't talk about it.";
export const DVD_LINES = ["So close.", "It never hits the corner. That's the point.", "Next time. Maybe."];
