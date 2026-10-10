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
    ["Is it warm in here or is it my GPU?", "It's your GPU. Get that checked."],
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
