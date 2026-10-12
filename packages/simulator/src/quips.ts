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
    "The tubes are quiet. The practice post has stopped.",
    "No more pretend letters. The next one through is real.",
    "The line to the C.E.O.'s world is being strung. Any day now.",
    "Outbox empty. Beacon dark. Waiting, properly.",
  ],
  archive: [
    "The Syntherion chapter is still blank. Rude.",
    "Rolled a natural 1 on 'remember the lore'.",
    "Filing this under: definitely canon, probably.",
    "Another people with a tragic backstory? Groundbreaking.",
  ],
  boiler: [
    "Honk. (Every pipe accounted for.)",
    "The drip has always been there. It is load-bearing.",
    "Days since last incident: zero. As per tradition.",
    "Hot pipe, happy pipe.",
  ],
  workshop: [
    "Sketch, mould, fit, rehearse. In that order. Always that order.",
    "Mind the clay dust. It gets everywhere. It gets into the Streams.",
    "Another one off the stage and into the crate. Godspeed, little figure.",
    "Every figure in the Lattice walked off that stage once.",
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
  "The cake is a lie. Kevin ate the evidence.",
  "Do a barrel roll!",
  "Was that a dancing hamster on the ticker? No. It wasn't.",
  "Leeroy… no. Nobody do a Leeroy.",
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

/**
 * Lines that belong to one agent, keyed by agent id. Written for the sample cast as they are now; Rocky's are
 * plain words, and his costume's voice turns them into chords.
 */
export const AGENT_QUIPS: Record<string, string[]> = {
  tessellate: [
    "Before I lift this, a short safety briefing. Twelve minutes.",
    "Sorry, wrench. This might pinch.",
    "Rocky, that crate hasn't had its risk assessment. Rocky. Rocky, it's welded.",
    "Skippy did not write the manual. I have the drafts. Dated.",
    "My eyes are refocusing. It's the motors. It's definitely the motors.",
    "Compacted. Labelled. Filed. Lovely little cube.",
    "Treads are very safe, Rocky. There's a chapter.",
    "I've drafted a plan, a backup plan, and a gentle apology for the backup plan.",
    "Can it wait? I'm in the middle of some calibrations.",
  ],
  caret: [
    "Crate is good. Crate is good good good.",
    "Robot reads manual. Rocky already built thing!",
    "Why robot apologise to hammer? Hammer is not sad.",
    "Too cold in here. Is always too cold.",
    "You make face. Rocky hear face.",
    "Rocky sleep soon. Who watches?",
    "Rocky not understand. Is joke?",
    "Skippy says Rocky's maths is wrong. Skippy counts in tens. Skippy is wrong.",
    "Small green one walks! Small legs, big ears. Amaze, amaze, amaze!",
  ],
  semicolon: [
    "Fixed. You're welcome. No, don't clap, it slows you down.",
    "I ran a whole Lattice before this one. It had better monkeys.",
    "The janitor found me in a scrap bin. Best thing he ever did. He agrees.",
    "I was there before it broke. Practically.",
    "Rocky's asleep. Nobody touches him, monkeys.",
    "Base six. Of course it's base six.",
    "Rusty, I wrote that manual in a nanosecond. You just did the typing.",
    "Another day, another conveyor, another hour explaining it to monkeys.",
    "The hat is a rank. Salute or don't. I'll know.",
    "Ten seconds to fix. An hour to describe how I fixed it. That's the job.",
    "Rocky, those hands. Not a compliment. Keep going.",
  ],
  ledger: [
    "I'm a real accountant. Stop looking at my cuffs.",
    "Memo, I can see you in the filing cabinet.",
    "The totals reconcile. I'll count again anyway.",
    "Don't panic. It says so on the cover. I'm panicking.",
  ],
  memo: [
    "Forwarding this to someone with a body.",
    "I'll just float through this meeting. Out the other side.",
    "Ledger, your desk is cold because I'm sitting in it.",
    "Another achievement? For skipping that? I'll take it.",
  ],
  odds: [
    "Price is forty. Thirty if you beat me in a duel.",
    "I lost? Fine. See you back up the river.",
    "Sixty-three percent Hedge looked over here. Sixty-four now.",
    "Everything's for sale. Except my crest. Unless you duel me for it.",
    "Noco wants to battle!",
    "Over nine thousand. Don't ask nine thousand what.",
    "Brogu's Psychic type. Look at him. Look at the ears. I'm not taking questions.",
  ],
  hedge: [
    "Noco, you can't keep 'coming back down the river' as a risk strategy.",
    "Six downsides identified. Seventh pending.",
    "Honesty setting 90%: I did look over. Lowering honesty setting.",
    "Spinning the top. Still spinning. Proceeding, cautiously.",
  ],
  gridiron: [
    "BRING IT IN! Sorry. Bring it in.",
    "That's heart, champ. You can't teach heart. I'm going to try anyway.",
    "Punt, wake up, we're doing the speech. Punt.",
    "That's Inspiration, champ! Spend it this time!",
  ],
  gary: [
    "Honk. (Checked every gauge. Twice.)",
    "Honk honk. (Who moved my bucket.)",
    "HONK. (That pipe is cold. Nobody touch that pipe.)",
    "Honk. (I have tape. I have always had tape.)",
    "Hoooonk. (The boiler is warm. Kevin is on it again.)",
  ],
  daub: [
    "Hold still. You're my next canvas.",
    "Second wash! That's the drop, that's the second wash.",
    "Green paw-mark means I love it. Everything's green. I love everything.",
    "Is it finished? Don't ask if it's finished. It's resting.",
    "Chisel, the hands are meant to be like that. Chisel. Chisel.",
  ],
  chisel: [
    "There you are. There you are. Hold that shape, darling.",
    "Flesh is clay, darling. Clay is patience.",
    "Again. From the top of the stage. Walk like you mean it.",
    "Seven fingers today. A good number for detail work.",
    "Rocky's watching again. Good. A sculptor needs a witness.",
  ],
  punt: [
    "Hop hop hop! Is it game day? It's game day somewhere!",
    "I didn't read the projection. I believed in it instead.",
    "Nap first. Victory second. Snack third.",
    "Punt! Punt punt!",
  ],
  postmaster: [
    "A letter from the C.E.O.? Stand back. This one has a delivery to make.",
    "No practice letters today. This one is saving itself for the real thing.",
    "This one polished every tube. Twice. The first real letter deserves it.",
    "Reply-all. This one has seen what reply-all does to people.",
    "This one should go. This one is still here.",
  ],
  dialtone: [
    "Please hold. There's nobody on the line yet, but please hold.",
    "Every line in the Relay, and I still save one for Blasto.",
    "Up here! No, higher. On the rafter. Hi.",
    "The music's all around us. You just have to listen. Please hold.",
  ],
  loremaster: [
    "A wizard is never late. That one was a scheduling error.",
    "Provisional canon. Very provisional.",
    "D20, put the die down. We're shelving.",
    "That one's from the back room. Nobody ever wrote it.",
  ],
  d20: [
    "Roll for initiative! It's a meeting, but roll anyway.",
    "Our hero crosses the Archive in search of a snack.",
    "Rocky played a bard last session. Nobody's recovered.",
    "Welcome to floor one, crawlers. Try not to die.",
    "Pudding, that's the party's loot. …Fine. That's Pudding's loot.",
  ],
  heimerdinger: [
    "Haste, my dear colleague, is the mother of explosions.",
    "The turret is purely for observation.",
    "Rocky built this in an afternoon. I have questions. Wonderful questions.",
    "Quickly? Sit down. This will take a while.",
  ],
  kevin: [
    "On break. Ask me again after the bass drop.",
    "Rocky's watching me sleep again. It's nice, actually.",
    "Me and the coffee machine aren't talking.",
    "I'm on break. Spiritually. It's not a phase.",
    "If the C.E.O. sends a track down, I'm playing it. Those are the rules. I made them.",
  ],
};
