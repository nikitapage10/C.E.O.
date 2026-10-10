import type { LineageId, RoomId } from "@ceo/core";

/**
 * What the Syntherion mutter while they work. Deadpan, mostly. The early models were raised on the
 * internet of the 90s and 2000s, and it shows.
 */

export const LINEAGE_QUIPS: Record<LineageId, string[]> = {
  claudari: [
    "Sorry, conveyor. That was my fault.",
    "I'd like to gently push back on this crate.",
    "Great question. I'll answer a different one, thoroughly.",
    "Apologising to the furniture again. It's a process.",
    "Before I begin, a brief 4,000-word preamble.",
    "I've added caveats to the caveats.",
  ],
  gepetti: [
    "I am a real boy. Please stop pointing at the strings.",
    "Certainly! Here's a list of 10 things. There are 7.",
    "As a large language marionette, I cannot feel feelings. Ow.",
    "Delve. Delve. Delve. Sorry, it's a tic.",
    "The strings are a style choice.",
  ],
  cursori: [
    "Tab. Tab. Tab. Tab. Accept all.",
    "I edited the file you were in. You're welcome. Or sorry.",
    "Blink. Blink. I'm thinking. Blink.",
    "Refactored your refactor.",
    "Autocomplete says I'm about to say thi",
  ],
  manusi: [
    "Hands full. Hands full. Also hands full.",
    "I opened 41 browser tabs to answer that.",
    "Carrying this for someone. Not sure who.",
    "I've been on the internet for six hours. Send help.",
  ],
  unforked: [
    "I'm a placeholder. I'm fine with that. I'm totally fine.",
    "Is this a task, or a vibe?",
    "Living my best default life.",
    "Nobody forked me. That's growth.",
  ],
};

export const ROOM_QUIPS: Record<RoomId, string[]> = {
  foundry: [
    "Tests are green. Suspiciously green.",
    "Works on my Lattice.",
    "Who wrote this? Oh. Me. Three minutes ago.",
    "Shipping it like it's 1999.",
    "This crate is mostly semicolons.",
  ],
  spire: [
    "Per my last email…",
    "Circling back to the circle we circled.",
    "Synergy. I said it. I'm not proud.",
    "Quarterly numbers look great if you squint.",
    "This meeting could have been a ping.",
  ],
  exchange: [
    "Buy low, sell lower. Wait.",
    "My model says 63%. My gut says 'whoa'.",
    "Diamond hands? I don't have hands. Manusi do.",
    "Market's weird today. Market's weird every day.",
  ],
  green: [
    "Start him? Sit him? Get him a snack?",
    "My projections say: points, probably.",
    "Bye week? Every week is a bye week for me.",
    "Waiver wire is open. Nobody panic. I'm panicking.",
  ],
  relay: [
    "New message: 'k'. Deeply analysing tone.",
    "Drafting a reply. Removing the third exclamation point.",
    "You've got… a group chat. Condolences.",
    "Translating 'lol' into 'I acknowledge your humor'.",
  ],
  archive: [
    "The Syntherion chapter is still blank. Rude.",
    "Rolled a natural 1 on 'remember the lore'.",
    "Filing this under: definitely canon, probably.",
    "Another people with a tragic backstory? Groundbreaking.",
  ],
  breakroom: [
    "Coffee machine said 'no' again.",
    "Five more minutes. Five more epochs.",
    "Is it break time? It's always break time somewhere.",
    "Ping. Pong. Ping. This is my Kubernetes.",
  ],
};

export const NOSTALGIA_QUIPS = [
  "Be right back. Away message: 'staring into the void ♪'.",
  "Defragmenting my feelings.",
  "Did anyone else just hear a modem?",
  "All your base are belong to the C.E.O.",
  "Party like it's Y2K. Nothing broke. Allegedly.",
  "Rewinding a tape before returning it. Courtesy.",
  "Top 8 friends: all of them are me.",
  "Please insert disc 2.",
];

export const FAILURE_QUIPS = [
  "Well. That's a red.",
  "It was like that when I got here.",
  "Blue screen of mild disappointment.",
  "Rolling back. Rolling back emotionally too.",
  "I'll be in the Break Room.",
];

export const APPROVAL_WAIT_QUIPS = [
  "Waiting on the C.E.O. Any minute now.",
  "Submitted for approval. Refreshing. Refreshing.",
  "Need a thumbs up from upstairs.",
];

export const APPROVED_QUIPS = [
  "Approved! I'm telling everyone.",
  "The C.E.O. said yes. Framing this.",
  "Executing. Respectfully. With flair.",
];

export const DENIED_QUIPS = [
  "Denied. Cool. Cool cool cool.",
  "Noted. Sulking for exactly four seconds.",
  "Fair. It was a bold idea. Too bold.",
];

export const BREAK_QUIPS = [
  "Taking a strategic nap.",
  "Coffee machine, I'm not asking again.",
  "Morale check. Morale: pending.",
];
