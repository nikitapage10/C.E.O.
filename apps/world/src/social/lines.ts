import type { RelationshipKind } from "@ceo/core";

/**
 * What agents say to each other when they bump into someone they have history with.
 * `{other}` is replaced by the other agent's name. Each entry is [opener, reply].
 */
export const EXCHANGES: Record<RelationshipKind, [string, string][]> = {
  friend: [
    ["{other}! Lunch? I don't eat. Let's do it anyway.", "Same table as always."],
    ["Nice work today, {other}.", "Says you. You shipped twice."],
    ["Want to see a cool error I found?", "Always."],
  ],
  "best-friend": [
    ["{other}. Nap?", "Nap."],
    ["I saved you the good beanbag, {other}.", "This is why you're my favourite process."],
    ["Secret handshake?", "We don't have hands. Do it anyway."],
  ],
  rival: [
    ["Shipped another one, {other}. Just saying.", "Mine had tests."],
    ["Still second place, {other}?", "Still counting, are we?"],
    ["Nice code. For a first draft.", "Nice opinion. For a linter."],
  ],
  nemesis: [
    ["{other}.", "…{other}."],
    ["I haven't forgotten, {other}.", "Nor have I. Whatever it was."],
    ["One day, {other}. One day.", "Put it in the calendar."],
  ],
  crush: [
    ["Oh! {other}! I was just… computing.", "Computing what?"],
    ["Is it warm in here or is it just the server rack?", "It's the server rack. Get that checked."],
    ["I wrote you a haiku, {other}. It's in the logs.", "I'll… read the logs."],
  ],
  partner: [
    ["Hi, love. Long queue today?", "Never too long for you."],
    ["Left you a note in the outbox, {other}.", "Saw it. Approved it. Personally."],
    ["Dinner at the Kernel, {other}?", "It's a date. A timestamp, technically."],
  ],
  mentor: [
    ["Remember, {other}: read the docs first.", "Even the long ones?"],
    ["Show me what you've got, {other}.", "Rolled a natural 20 on 'effort'!"],
    ["Proud of you, {other}.", "Thank you. Can I have a raise?"],
  ],
  sibling: [
    ["Mum said to check on you, {other}.", "We don't have a mum. We have a Kernel."],
    ["You used my mug again, {other}.", "Prove it."],
    ["Did you fill in your timesheet?", "Did YOU?"],
  ],
  ex: [
    ["Oh. {other}.", "Oh. Hi."],
    ["You look… recompiled.", "I've been working on myself."],
    ["Still taking risks, {other}?", "Still not."],
  ],
};

/**
 * Banter for particular pairs, keyed "a|b" by agent id: the opener is a's, the reply b's. Used most of the
 * time when those two meet (whichever way round the relationship is stored); the generic lines fill in.
 */
export const PAIR_EXCHANGES: Record<string, [string, string][]> = {
  "caret|tessellate": [
    ["Robot! Rocky built crate. Done done done.", "You built it before I finished the risk assessment."],
    ["Why you apologise to wrench, question?", "Because I'm about to use it, Rocky. It's polite."],
    ["Rocky has five legs. Harness has two holes. Is bad plan.", "It's a starting point for a conversation."],
    ["Score is 105 to 104. Rocky wins.", "That's base six. In base ten it's 41 to 40. You still win. I hate it."],
    ["Robot is alive, question?", "It's complicated. Ask again after my briefing."],
    ["Rocky watch you sleep tonight?", "I don't sleep. Please stop asking."],
    ["Robot has no legs now! Rocky has five. Rocky share, question?", "They're treads, Rocky. They're very safe. There's a chapter."],
  ],
  "semicolon|caret": [
    ["Rocky, that's base six again. Count like a grown-up.", "Rocky count like Eridian. Skippy count like small can."],
    ["Already fixed it. You can put the welder down.", "Rocky fix it better. Then fix your fix. Is teamwork."],
    ["Go to sleep, Rocky. I'll watch. Somebody competent has to.", "Thank you, friend. Skippy grumble very quiet. Is nice."],
    ["How did you do that seam? Not that I care. Purely academic.", "With hands! Skippy want to hold welder, question?"],
    ["Hold your horses, Rocky.", "Rivet say same thing. Still no horses. Skippy also lie, question?"],
    ["Want to hear me sing? Rhetorical. Here it comes.", "Skippy sing is like furnace leak. Rocky like anyway."],
  ],
  "tessellate|semicolon": [
    ["You did not write the manual in a nanosecond.", "Half a nanosecond. The other half was your typos."],
    ["Did you read the risk assessment before you fixed that?", "I fixed it before the risk existed, monkey. Assess that."],
    ["I pinned three ideas to the board this morning.", "I saw. I've improved two and I'm being kind about the third."],
    ["Skippy, the compactor is playing a fanfare again.", "It's celebrating you, janitor. Bask in it."],
  ],
  "odds|hedge": [
    ["Sixty-three percent you're looking at me, Hedge.", "Honesty setting 90%. Lowering it now."],
    ["Duel me. Loser buys dinner.", "You can't lose. You walk back up the river."],
  ],
  "ledger|memo": [
    ["Memo, you're in my chair.", "I'm in your chair spiritually. Physically I'm in the wall."],
    ["I'm a real accountant.", "Nobody asked, Ledger."],
  ],
  "gridiron|punt": [
    ["PUNT! HUDDLE UP! Sorry. Huddle up.", "Zzz. We are! Zzz."],
    ["You slept through the whole speech, champ.", "Best speech yet. Very relaxing."],
  ],
  "postmaster|dialtone": [
    ["This one has a letter for you. It is from this one.", "Read it to me on the line, darling. Slowly."],
    ["Come down from the rafters, love. Dinner.", "Patching you through to 'yes'."],
  ],
  "loremaster|d20": [
    ["Roll for canon, D20.", "…It's a 1. Again. I'm framing it myself this time."],
    ["A good story needs a prologue.", "Can the prologue have a dragon?"],
  ],
  "hedge|gridiron": [
    ["Still starting the backup kicker?", "Still worried about everything?"],
  ],
  "odds|ledger": [
    ["Duel me for the audit, Ledger.", "I'll respond in writing. In triplicate."],
  ],
  "punt|kevin": [
    ["Kevin. Nap?", "Nap."],
  ],
  "daub|chisel": [
    ["The hands are meant to be like that, Chisel.", "Then they're meant to be wrong, darling. I'll fix them in the mould."],
    ["Is it finished?", "Never ask a sculptor that."],
  ],
  "caret|chisel": [
    ["Good hands. Good good good.", "Stay and watch, darling. I work better with a witness."],
  ],
  "caret|kevin": [
    ["Kevin sleep. Rocky watch.", "Cool. Thanks, man."],
  ],
};

export const EMOTE: Record<RelationshipKind, string> = {
  friend: "✦",
  "best-friend": "✦✦",
  rival: "⚡",
  nemesis: "⚔",
  crush: "♡",
  partner: "♥",
  mentor: "✧",
  sibling: "≈",
  ex: "…",
};
