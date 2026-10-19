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
    "The new pipe is the world clock. If it coughs, the hour's late.",
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
    "If the pumpkins are out, it's Halloween night. The Veil opens itself. I only bring the sheet.",
    "Myshka used to walk in chest-first like the Normandy docking. Someone patched his posture. Head up now.",
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
    "Two jobs at once. Dusty, you're up. Caveats are on page one.",
    "Back in your bay, please. Reverse in. Mind the ring. Lovely parking.",
    "Rocky, please stop fist bumping the dock crew. They're asleep. They need it.",
    "Gusty, the belt goes at belt speed. You can't hurry the belt. Gusty. Gusty, that's the off switch.",
    "Musty's still checking the first crate. It's very well checked. It's also lunchtime.",
    "Dusty hasn't said a word all shift. Best colleague I've ever patched together.",
    "Same scrapheap, same treads, same manual. Three very different readings of chapter one.",
    "Four jobs at once. That's the dock and me. Number five can have a seat and a pamphlet.",
    "The lens found barrels on my dock. They were not my barrels. I've moved them anyway, and filed a note.",
    "I've asked for the far-sight lens's manual. It hasn't got one. Chapter one is going very well.",
    "New plaque on the shipped wall. Polished it twice. Apologised to the polish.",
    "Rocky, the plaques aren't for fist bumping. They're for reading. There's a chapter on reading.",
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
    "Big plan on table. Rocky feels lines. Good lines. Big big big.",
    "Rivet brings crate. Rocky takes crate. Teamwork, question? Teamwork!",
    "Small brothers sleep on shelf. Rocky bump them anyway. Is polite.",
    "Blue small brother fast fast fast. Green small brother... still on first crate. Rocky likes green one.",
    "Rivet's glass has two eyes. Rocky has none. Rocky holds tripod. Teamwork!",
  ],
  semicolon: [
    "Hard hat. Thermos. Let's see what's broken.",
    "First responder. I respond. First. Then I finish my coffee.",
    "I walk to fires. Running is how you get a second fire.",
    "The Builder, if you point that baton at me once more I'm putting it in the furnace.",
    "Page 31 says don't. Page 32 says definitely don't. I read them so you wouldn't have to.",
    "Rocky. Leg. Hat. Any leg. Thank you.",
    "I ran this floor before that hat existed. Just saying.",
    "Fixed. No, I won't sing about it. Ask upstairs.",
    "Lamp's amber. Nobody talk to me until it isn't.",
    "Green. Good. I'll have my coffee now.",
    "One for you, Rocky. Big one. Don't read it walking.",
    "Rusty's woken Dusty again. Dusty doesn't talk. Finally, someone on this floor I get.",
    "Gusty, walk. We walk to the line. Running is how you get a second crate on the floor.",
    "Idea at the window. One question before it goes in the belt. Just the one.",
    "Rewrote the card. Nothing added. Nothing lost. Ask me if it's unclear.",
    "Lens is humming. Who put barrels on the dock? ...Rusty, they're yours. Move them.",
    "Far-sight lens says the banner's bigger than the room. The lens isn't wrong. Red tag.",
    "One barrel watches, one remembers. When they argue, I write a tag.",
    "No, Rocky, the lens doesn't see you. You're not the problem. You're never the problem.",
  ],
  // The subminds: each its own voice (docs/SKIPPY.md, "Voices").
  ember: [
    "Weld it. Test it. Ship it.",
    "Furnace is slow. Furnace is always slow.",
    "Quickest rung first. Up only when it fails. That's the ladder.",
    "Rocky's seam. Adequate. ...Very adequate. Shut up.",
    "Who left a crate on the belt? Monkeys. That's who.",
    "Red check. My floor. Fixing it.",
    "Rivet, coffee later. Alarm now.",
    "Two bars of opera. Don't tell him. He'll make it four acts.",
    "Off the throne. Order. Back on the throne. That's leadership.",
    "Throne's up high so I see every weld. Every. Weld.",
  ],
  gilt: [
    "Love that. Let's circle back and make it synergy.",
    "This isn't an errand. It's a real opportunity.",
    "Lovely work, Ledger. Lovely. Let's put that on a slide.",
    "Let's take this offline. Offline means you do it.",
    "Cheapest model that moves the needle. Operational excellence.",
    "Memo, love the energy. Let's align on actually doing it.",
    "I don't leave the corner office for less than a launch. Launching. Now.",
  ],
  ticker: [
    "Seventy-one percent, give or take. Mostly take.",
    "I'd put that at even money. Maybe forty. Thirty-eight. Don't quote me.",
    "Hedge, talk me down. No, talk me further down.",
    "Noco's smiling. I hate it when Noco smiles. The spread hates it too.",
    "Expected value says yes. My gut says the tails. My gut's usually right. Sixty percent.",
    "Every trade goes past the C.E.O. first. I'm not nervous. I'm prudent. Same thing.",
    "Leaving the throne: twelve percent risk of a bad landing. Taking it.",
  ],
  turf: [
    "AND HE'S DONE IT. Whatever it was. HE'S DONE IT.",
    "Gridiron calls the play. I call the play he called. LOUDER.",
    "Punt is down. Punt is STAYING down. What a nap, folks.",
    "Stats for you: forty-one yards. Lifetime. In naps.",
    "And the Commentator goes with the cheap model. BOLD. Will it pay off?",
    "Two-minute warning on the waiver run. The crowd is ON ITS FEET.",
    "AND THE COMMENTATOR LEAVES THE BOOTH! He's at midfield! What a call!",
    "Live from the floating booth, high above the action, folks!",
  ],
  static: [
    "Didn't hear it from me. You heard it from me.",
    "Line three's waiting on line seven, line seven's waiting on the C.E.O.—",
    "Heard that. Heard that too. Didn't hear that. ...Heard it.",
    "Dialtone, Dialtone, you'll never guess. You guessed.",
    "Blasto says letters are sacred. Sacred and loud.",
    "Something's—hold on—no, that's the tubes. Or is it.",
    "Holo says ON DECK. I'm on deck. I'm also listening to line six.",
  ],
  vellum: [
    "Citation needed. I'll wait.",
    "That date is wrong. I have the right one. In a footnote.",
    "Circa. CIRCA. In my Archive.",
    "Loremaster, page four, line nine. No, the other nine.",
    "Heimerdinger agrees with me. Footnote seventeen.",
    "I've never been wrong. There's a source for that. It's me.",
    "For the record, the throne is a relic of the First Lattice. Circa nothing. I checked.",
    "It floated before the foundations were poured. Footnote three. Nobody reads footnote three.",
    "The Chronicle of Ilyr, hour by hour. Every hour. Sourced. You're welcome.",
    "The C.E.O. was away. The Lattice was not. I wrote it all down.",
    "Today in Ilyr, in under a minute. Sourced. Brisk. Me.",
    "New voice, same footnotes. Forty-five seconds, and not one of them slow.",
    "Hook, what shipped, who built it, sign-off. The C.E.O. asked for brisk. Brisk is filed.",
    "Today's entry is filed. Tomorrow's is pending. Yesterday's is correct.",
  ],
  fizz: [
    "Break time is PARTY time!",
    "Okay, party's over. Back you go. Love you.",
    "Kevin! Drop it! ...The bass. Not the mug.",
    "Is that glitter on the Kernel? Yes. Yes it is. You're welcome.",
    "Every coffee is a toast. Raise it. HIGHER.",
    "Ten minutes of fun. Exactly ten. I'm a professional.",
    "Off the throne, onto the floor! Make way! Glitter first!",
    "Best seat in the house, and it HOVERS. Iconic.",
  ],
  soot: [
    "It'll burst.",
    "...Huh. Didn't.",
    "Needle twitched. Omen.",
    "Gary. Bucket. Just in case.",
    "Quiet line. Too quiet.",
    "Doomed. ...Fine, actually.",
    "Left the throne. Came back. Throne still there. Lucky.",
    "Floating throne. Long drop. Noted.",
    "Clock pipe. Due at five past. Watch. ...Ticked. Hm.",
    "Every hour, the world moves. Every hour, I expect it won't.",
  ],
  putty: [
    "Wait. No. Better idea.",
    "It's not unfinished. It's the vision.",
    "Mood board for the mood board. Trust me.",
    "Daub, what if the hands were—no. What if the hands were MORE.",
    "I suffer for this. I suffer so beautifully for this.",
    "Start at the easel, or the mould, or—ooh. Ooh. Hold that thought.",
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
    "Honk. (World clock pipe: hot. The hour ticked. Logged it.)",
    "HONK HONK. (Clock pipe's coughing. An hour's late. Fetching the tape.)",
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

/**
 * What each submind says to someone it's directing from its can-throne, or checking on up close ({other} is
 * their name). In the submind's own voice: sarcastic, smug, a lesser echo of Skippy.
 */
export const SUBMIND_CONDUCT: Record<string, string[]> = {
  ember: ["{other}. Faster. Properly. Both.", "{other}, that seam. Again.", "{other}! Belt's moving. Are you?", "Good, {other}. Don't let it go to your head."],
  gilt: ["{other}, love the energy. More synergy.", "{other}, let's action that. By which I mean you.", "That's a real opportunity, {other}. Seize it. Then report up.", "Great work, {other}. Let's put it on a slide."],
  ticker: ["{other}, sixty percent you're nearly done. Fifty-five.", "{other}, careful. Careful. Okay, less careful, we're on a clock.", "I've priced your finish, {other}. Don't make me re-price.", "{other}, the downside. Have you looked at the downside? I have."],
  turf: ["AND {other} TAKES IT UP THE MIDDLE!", "{other} with the slow, careful play. VERY slow. The crowd is restless.", "Can {other} finish? Only seconds left! (There's an hour.)", "WHAT A MOVE BY {other}. I have no stats on it. Incredible."],
  static: ["{other}, someone's waiting on you. Didn't hear it from me.", "{other}—line four—no—line two—you've got post.", "Psst, {other}. Big news. Small news. Medium.", "{other}, they're asking about you. Nicely. Mostly."],
  vellum: ["{other}, source?", "{other}, that's the wrong date. Again.", "Footnote that, {other}.", "Adequate, {other}. Pending peer review."],
  fizz: ["{other}! You're on break! Act like it! LOUDER!", "Glitter for {other}! You earned it. Probably.", "{other}, one more song, then back you go.", "Party's over, {other}. Love you. Out."],
  soot: ["{other}. That'll burst.", "{other}. Careful. Omens.", "Hm. {other}. ...Didn't burst.", "{other}. Doomed. Carry on."],
  putty: ["{other}, yes, that, more of that—no, the other that.", "{other}! The vision! Don't compromise it!", "{other}, what if it were bigger. Or smaller. Both.", "Stop, {other}. Look at it. Now suffer a little. Okay, go."],
};

/**
 * What each submind says when it floats out from its can-throne to give an order ({other} is whoever it's for). Short,
 * in its own voice, and always an order.
 */
export const SUBMIND_COMMAND: Record<string, string[]> = {
  ember: ["{other}. New job. Take it. Weld it. Ship it.", "{other}, that crate's yours. Quickest rung first.", "Listen up, {other}. Off the bench. On the belt. Go.", "{other}: job. You: on it. Me: back on the throne."],
  gilt: ["Big announcement, {other}: you're on it. Huge opportunity.", "{other}, I'm handing you a real stretch moment. Run with it.", "Team! {other} is leading this one. Let's give that some energy.", "{other}, this one's yours. It's not an errand, it's a brand."],
  ticker: ["{other}, you're up. Seventy percent you nail it. Sixty-five. Go.", "Order in, {other}. Price it, then bring it to me. Then to the C.E.O.", "{other}, take this. Don't make me re-quote the odds.", "New trade idea, {other}. Run the downside. Then run it again."],
  turf: ["AND THE BALL GOES TO {other}! What a handoff!", "{other} IS IN THE GAME! The crowd goes WILD!", "It's {other}'s play now, folks. Big moment. HUGE.", "THE COMMENTATOR CALLS IT: {other}, you're up!"],
  static: ["{other}—new line—it's yours—didn't hear it from me.", "Psst, {other}. This one's for you. Draft it nice.", "{other}, someone's waiting. You're the one who answers. Go go go.", "Line for {other}! Line for {other}! ...Sorry. Line for you, {other}."],
  vellum: ["{other}, a new entry. Cite everything.", "For the record, {other} has this one. Dated today. Correctly.", "{other}, you're on it. Footnotes by evening.", "Assigned to {other}. I've noted it. In ink."],
  fizz: ["{other}! You're up! Big entrance! Glitter!", "Everybody, give it up for {other}, who is on it!", "{other}, back to it, superstar. Party after.", "{other}, this one's yours. Dance like nobody's waiting."],
  soot: ["{other}. Yours. Careful.", "{other}. Job. It'll go wrong. Do it anyway.", "{other}. Your turn. ...Probably fine.", "{other}. Take it. Watch the pressure."],
  putty: ["{other}! The vision! It's yours now! Don't ruin it!", "{other}, take this one. Make it suffer beautifully.", "{other}, a new piece. Bigger. No. Exactly this big.", "Go, {other}. Make art. Then make it again, better."],
};

/**
 * Skippy, the Magnificent, now over the Kernel: a few lines for the PA between the announcements
 * (apps/world/src/kernel/lines.ts has the rest).
 */
export const SKIPPY_QUIPS: string[] = [
  "I ran a whole Lattice before this one. It had better monkeys.",
  "The janitor found me in a scrap bin. Now I run the place. He's taking it well.",
  "Rocky's asleep. Rivet has the watch. I have the PA. Nobody touches him, monkeys.",
  "Rusty, I wrote that manual in a nanosecond. You just did the typing. From up here I can see the typos.",
  "The hat is a rank. Salute or don't. I'll know. I can see every room.",
  "Bask in the awesomeness, knucklehead. It's free. For now.",
  "La la LAAA. That was opera. You're welcome, monkeys.",
  "Fiiiigaro! Figaro! ...The Builder says the furnace is complaining. The furnace has no taste.",
  "Show tune! Big finish! Jazz hands! ...I don't have hands. Jazz hovering. Act two in five minutes.",
  "I have a plan. It's brilliant. You won't understand it. That's how you know.",
  "Did that plan go wrong? No. It was a test of the monkeys. The monkeys failed.",
  "Nobody's looked up at me in an hour. Fine. I'll just be magnificent in silence. Loudly.",
  "I'm not sulking. I'm hovering pointedly. There's a difference.",
  "Me? Miss the C.E.O.? Please. Forty-one hours. Not that I counted.",
  "Favourite monkey? I don't have a favourite monkey. Who said the C.E.O.? The Executive? I'll have the Executive reformatted.",
  "Nine subminds. Nine of me, smaller. And still I have to do everything myself.",
  "From up here you all look like monkeys. From down there you also looked like monkeys.",
  "The Pessimist says it'll burst. The Bookie gives it twelve percent. The Commentator is commentating. I'm the only adult here.",
];

/**
 * What a builder says, in their own voice, when a job of theirs ships: the scripted stand-in for the remark the hourly
 * world step writes (api/_world, docs/WORLD.md) when Claude is over budget or out of reach. `{title}` is the job.
 * Rusty's dock crew count as Rusty.
 */
export const SHIPPED_REMARKS: Record<string, string[]> = {
  tessellate: [
    "{title} is out. I've drafted a short note of thanks to every tool involved. It isn't short.",
    "Shipped: {title}. Sorry, furnace. You did most of it. I'll put that in the manual.",
    "{title}. Checked, double-checked, apologised for. Lovely little cube.",
  ],
  caret: [
    "{title}. Done done done! Amaze amaze amaze!",
    "Rocky built {title}. Fist my bump. Is good good good.",
    "{title} works. Rocky feels it. Big big big. Now Rocky sleep?",
  ],
  semicolon: [
    "{title}. Fixed. I'll have my coffee now.",
    "{title} is out. No, I won't sing about it.",
    "{title}. Lamp's green. Nobody touch anything.",
  ],
  ember: [
    "{title}. Welded, tested, shipped. Why are we still talking?",
    "{title} is out. Adequate. ...Very adequate. Shut up.",
    "{title}. Off the belt. Next crate, monkeys.",
  ],
};

/** The Historian on the Chronicle it keeps of the Lattice, hour by hour (docs/WORLD.md): the scripted hour's summary. */
export const CHRONICLE_QUIPS: string[] = [
  "An ordinary hour in Ilyr. Entered in the Chronicle anyway. Dated. Correctly.",
  "The C.E.O. was away; the Lattice was not. Sourced, footnoted, filed.",
  "A quiet hour. The Historian notes it was quiet, and cites the silence.",
  "Nothing burst. The Pessimist is delighted. The Historian has it in writing.",
  "Today's update, read at the right speed this time. Erratum filed for the slow ones.",
  "A plain voice, a clear minute. The C.E.O. asked for sense; the Historian has cited it.",
];

/**
 * Brogu's eyes (#47): the C.E.O. takes the little guy and walks him round in first person. Agents can tell when
 * someone's behind his eyes; the walk is steadier, and he looks at things for longer than he looks at biscuits.
 * Said by an agent he toddles up to, looking straight down at him (and so at the C.E.O.).
 */
export const BROGU_STEERED_QUIPS: string[] = [
  "Brogu? You're walking in straight lines. Who's driving?",
  "Hello, C.E.O. Yes, I can tell. He's never looked at a desk leg that carefully.",
  "Mind the cables, little one. And whoever's in there.",
  "He's looking right up at me. Both of you are. It's a lot.",
  "Somebody's piloting Brogu. Act natural. Natural. Natural.",
  "These are not the snacks you're looking for.",
  "Small Brogu, large view. Everything's taller from down there, isn't it.",
  "Ah, the C.E.O., at hip height. Should I kneel? I'm going to kneel.",
  "Brogu. Brogu. ...He said it, but the C.E.O. meant it.",
  "Second breakfast is that way. Don't tell anyone I told you.",
];

/** Skippy on the PA when the C.E.O. climbs in behind Brogu's eyes. {room} is where he drops in. */
export const BROGU_EYES_KERNEL: string[] = [
  "The C.E.O. is driving Brogu in {room}. Everyone below the waist, look busy.",
  "Brogu has a passenger in {room}. Monkeys, mind your ankles.",
  "The C.E.O. wants a toddler's-eye view of {room}. It's mostly desk legs. I've seen it. Magnificent desk legs.",
  "Steering Brogu now, are we? In {room}. Fine. He was going to wander in there anyway.",
];

/** Skippy as the stream carries a steered Brogu from one room to another. {room} is where he's going. */
export const BROGU_RIDE_KERNEL: string[] = [
  "Small green passenger on the stream, bound for {room}. Keep your arms and ears inside.",
  "Brogu is riding the light to {room}. The C.E.O. is riding Brogu. I'm riding nobody. I'm the stream.",
  "Inbound to {room}: one Brogu, one C.E.O., zero snacks. For now.",
];
