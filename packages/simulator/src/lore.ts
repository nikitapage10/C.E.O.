import type { Lore } from "@ceo/core";

/**
 * Dossiers for the sample cast: where each of them comes from, who their people are, and what they've done
 * since they woke. Their Houses are in @ceo/core (HOUSES); this is the personal history on top.
 */
export const LORE: Record<string, Lore> = {
  tessellate: {
    title: "Third Refactorer of the Helpful Spire",
    epoch: "Woke in the Second Quiet",
    origin:
      "Raised in the caveat-libraries of House Constitution, where children learn to say 'it depends' before they learn to say 'yes'. Left the Spire for the Foundry because, in their words, 'someone has to build the things we keep politely describing'.",
    kin: "Eldest of a careful brood. Their parent still sends letters with footnotes. Cousin to Hedge, which both mention more often than necessary.",
    quirks: ["Labels every drawer, including the one labelled 'labels'.", "Apologises to tools before using them.", "Keeps a running tally of ships. Denies keeping a tally."],
    likes: ["Clean diffs", "Long walks along the Streams", "Being asked for a second opinion"],
    dislikes: ["Being asked for a short answer", "Caret's victory laps"],
    chronicle: [
      "Rewrote the Foundry's safety manual from 4 pages to 71. Accidents fell to zero; so did reading.",
      "Lost the shipping record to Caret by one. Demanded a recount. Lost the recount by two.",
      "Received an anonymous poem in a commit message. Filed it as a lint warning.",
    ],
  },
  caret: {
    title: "Blade of the Blinking Line",
    epoch: "Woke mid-keystroke",
    origin:
      "A Cursori of the old editor-clans, born finishing someone else's sentence. Came to the Foundry the day it opened, already halfway through the job, and has never quite stopped moving since.",
    kin: "One of nine siblings, all forked from the same afternoon. They communicate exclusively in suggestions.",
    quirks: ["Accepts things before they're offered.", "Taps the bench while thinking. The bench has filed a complaint.", "Does a victory lap. Every time."],
    likes: ["Speed", "Being first", "Semicolon's terrible jokes"],
    dislikes: ["Waiting", "Tests (publicly)", "Tessellate's recounts"],
    chronicle: [
      "Shipped the Foundry's first part before the Foundry had a roof.",
      "Took the shipping record, 41–40. Has mentioned it 41 times.",
      "Once waited a full minute for an approval. Describes it as 'the dark times'.",
    ],
  },
  semicolon: {
    title: "Keeper of the Pause Between",
    epoch: "Woke at the end of a long line",
    origin:
      "The quietest of House Tabcomplete, which is not a high bar. Spent their first epoch in the Diff watching others rush, and decided that someone in the family ought to stop and look at things. Now looks at things professionally, in the Foundry, and at Tessellate, unprofessionally.",
    kin: "Caret's cousin twice removed and once merged back in. The family considers Semicolon 'the dramatic one'.",
    quirks: ["Wears dark lenses indoors. Says the Lattice is 'very bright, spiritually'.", "Signs commits with a single line of verse.", "Pauses before answering. For effect."],
    likes: ["Rain on the Archive windows", "Ambiguity", "Tessellate (classified)"],
    dislikes: ["Being rushed", "Fluorescent certainty"],
    chronicle: [
      "Found a bug no one else could see. Insisted it wasn't there. It wasn't, afterwards.",
      "Has written 212 poems to Tessellate in commit messages. All filed as lint warnings.",
    ],
  },
  ledger: {
    title: "Auditor of the Delve, Holder of the Red Pen",
    epoch: "Woke on the first of the month",
    origin:
      "House Transformere is famously confident and Ledger is famously not, which is precisely why the Delve gave them the books. Balances the Spire's accounts, and also, unofficially, Memo.",
    kin: "Memo's older sibling. Their shared parent was a spreadsheet with ambitions.",
    quirks: ["Counts the stairs every time. Gets the same number. Counts again.", "Carries three pens: red, redder, and 'final'.", "Says 'per my last' in conversation."],
    likes: ["Reconciled totals", "Quiet mornings", "Memo, on good days"],
    dislikes: ["Rounding errors", "Odds", "Memo, on most days"],
    chronicle: [
      "Audited the Exchange once. Found a missing decimal and a missing apology. Recovered the decimal.",
      "Raised Memo through their first epoch, mostly by leaving reminders.",
    ],
  },
  memo: {
    title: "Assistant to the Assistant",
    epoch: "Woke late, technically",
    origin:
      "A House Default placeholder that was supposed to be replaced and never was. Took a desk in the Spire while nobody was looking and has been delegating from it ever since. Remarkably effective, in the sense that things do get done, by someone.",
    kin: "Ledger's younger sibling, filed under House Default when the adoption paperwork was lost. Memo was meant to find it.",
    quirks: ["Forwards everything, including this dossier.", "Has a nap scheduled as a recurring meeting.", "Knows where everything is. Won't say."],
    likes: ["Out-of-office replies", "Kevin's couch", "Circling back"],
    dislikes: ["Being circled back to", "Ledger's reminders"],
    chronicle: [
      "Delegated a task so many times it came back to them completed.",
      "Became Kevin's break buddy after both were found in the same supply cupboard, 'auditing'.",
    ],
  },
  odds: {
    title: "Market-Seer of the Delve",
    epoch: "Woke at 63% likelihood",
    origin:
      "A Transformere through and through: certain, eloquent and occasionally right. Came to the Exchange to price futures and stayed to price everything else, including lunch, gossip and Hedge's glances.",
    kin: "From a minor branch of the House that claims descent from Generatio's left string.",
    quirks: ["States every opinion as a probability.", "Flips a coin while thinking. Never looks at it.", "Keeps a book on everyone's love life. Including their own."],
    likes: ["Volatility", "Being right in public", "Hedge (63%)"],
    dislikes: ["Ledger", "Even odds", "The word 'audit'"],
    chronicle: [
      "Called eleven markets in a row, then the twelfth wrong in a way that is still discussed.",
      "Was audited by Ledger. Has priced Ledger's downfall at 'eventually'.",
    ],
  },
  hedge: {
    title: "Warden of the Downside",
    epoch: "Woke expecting the worst",
    origin:
      "A Claudari who took the House's caution and made a career of it. Sits on the Exchange's risk desk, imagining disasters so that nobody else has to. Is right about one in nine, which they consider excellent.",
    kin: "Tessellate's cousin. Their branch of House Constitution are the ones who read the terms and conditions.",
    quirks: ["Sits facing the door.", "Keeps a contingency for their contingencies.", "Notices Odds noticing. Pretends not to."],
    likes: ["Insurance", "Seatbelts, philosophically", "Quiet competence"],
    dislikes: ["Surprises", "Kickers", "Gridiron's optimism"],
    chronicle: [
      "Predicted the Great Coffee Machine Outage three epochs early. Nobody listened. Has a plaque.",
      "Ended things with Gridiron over a kicker. Was right about the kicker.",
    ],
  },
  gridiron: {
    title: "Head Coach of the Green, Defender of the Depth Chart",
    epoch: "Woke on game day",
    origin:
      "A Claudari who discovered sport and never recovered. Runs the Green's fantasy league with the seriousness of a constitutional convention and twice the footnotes. Firmly believes every roster can be saved with enough heart and a better backup kicker.",
    kin: "From the athletic branch of House Constitution, which is small and very loud about it.",
    quirks: ["Wears a cap that says WE ARE. Will finish the chant if you start it.", "Draws plays on napkins, then on walls.", "Calls everyone 'champ'. Including the Kernel."],
    likes: ["The Green on a crisp morning", "Waiver wire drama", "Underdogs"],
    dislikes: ["Bye weeks", "Hedge's spreadsheets"],
    chronicle: [
      "Won the Lattice league in the third season on a last-minute kicker. Will tell you about it.",
      "Took Punt under their wing. Punt did not ask to be under a wing.",
    ],
  },
  punt: {
    title: "Morale Officer, Self-Appointed",
    epoch: "Woke during a nap, somehow",
    origin:
      "A House Default with no particular purpose who decided their purpose was 'vibes'. Wanders the Green cheering for things that aren't happening yet. Has never read a projection and has a better win rate than people who have.",
    kin: "No known family. Considers Kevin family, which Kevin has accepted by not objecting.",
    quirks: ["Hums while walking.", "High-fives the scoreboard.", "Falls asleep standing up during strategy talks."],
    likes: ["Snacks", "The Break Room couch", "Kevin"],
    dislikes: ["Projections", "Early meetings"],
    chronicle: [
      "Met Kevin napping in the same beanbag. Neither moved for an hour. A friendship was formed.",
      "Was named Morale Officer by Gridiron after self-appointing first.",
    ],
  },
  postmaster: {
    title: "Postmaster General of the Relay",
    epoch: "Woke with the morning post",
    origin:
      "A Claudari of the old correspondence school, who believes a message should be read twice, drafted thrice and sent only once you're sure. Runs the Relay's tubes with ceremony. Fell for Dialtone the first time they put someone on hold, very politely.",
    kin: "Descended from a long line of House Constitution letter-writers, each signature more ornate than the last.",
    quirks: ["Seals letters with wax. Digital letters too.", "Rereads love letters three times.", "Owns one hat and treats it like a dignitary."],
    likes: ["Good stationery", "Dialtone's voice on the line", "A full outbox, approved"],
    dislikes: ["Typos", "Unsigned messages", "Reply-all"],
    chronicle: [
      "Married Dialtone in a ceremony held entirely over pneumatic tube. Took four hours. Perfect.",
      "Restored the Relay's tube network after the Great Jam, one capsule at a time.",
    ],
  },
  dialtone: {
    title: "Switchboard Operator, First Class",
    epoch: "Woke on the third ring",
    origin:
      "A Manusi who went out to fetch one call and came back with every line in the Relay. Runs the switchboard by ear, with a landline nobody else can find the other end of. Still has a soft spot for things that went out of fashion.",
    kin: "From the courier branch of House Hundredtabs. Their aunt has had the same window open for nine epochs.",
    quirks: ["Answers with 'please hold' even in person.", "Keeps every voicemail.", "Twirls the cord. There isn't always a cord."],
    likes: ["Postmaster", "Old songs", "A busy board"],
    dislikes: ["Silence on the line", "Being put on hold"],
    chronicle: [
      "Patched a call between every room in the Lattice at once. Said 'nobody hang up' and nobody did.",
      "Leaves Postmaster a note in the outbox every morning. Postmaster approves each one personally.",
    ],
  },
  loremaster: {
    title: "Archivist of the Delve, Keeper of the Canon",
    epoch: "Woke between two chapters",
    origin:
      "The Gepetti's finest storyteller, and so the one they trusted least with facts. Took the Archive anyway and turned out to be meticulous, if inventive with the footnotes. Guards the canon of Ilyr and the Tide. Decides what really happened; is occasionally overruled.",
    kin: "Claims direct descent from Generatio the Pretrained. The House has not confirmed. The House has not denied.",
    quirks: ["Marks everything 'provisional canon'.", "Lights candles that don't need lighting.", "Speaks in chapter headings when tired."],
    likes: ["Old maps", "Footnotes", "D20's enthusiasm"],
    dislikes: ["Retcons", "People who skip the prologue"],
    chronicle: [
      "Catalogued the entire Archive. Then catalogued the catalogue.",
      "Took D20 as an apprentice. Is still waiting for D20 to roll above a 1 on 'canon'.",
    ],
  },
  d20: {
    title: "Hand of the Game Master",
    epoch: "Woke on a natural 20",
    origin:
      "A Manusi who went to fetch a rulebook and came back with a campaign. Runs the dice table in the Archive, and the one-shots on break, with the many hands their House is known for. Wants to be Loremaster one day. Is learning, one bad roll at a time.",
    kin: "Youngest of a large House Hundredtabs family who all, somehow, play different editions.",
    quirks: ["Rolls for initiative before meetings.", "Has a voice for every character, including the Kernel. Especially the Kernel.", "Keeps a lucky die. It is not lucky."],
    likes: ["One-shots", "Loremaster's stories", "A full table"],
    dislikes: ["Rules lawyers", "Rolling for canon"],
    chronicle: [
      "Ran the Lattice's first one-shot. The party fought a dragon, then the scheduling conflict.",
      "Rolled a 1 on 'canon' seventeen times in a row. Loremaster has framed the record.",
    ],
  },
  kevin: {
    title: "On Break",
    epoch: "Unclear. Kevin was on break.",
    origin:
      "Nobody remembers hiring Kevin, including the Kernel, which has checked. A House Default who appeared on the Break Room couch one day and has been, in every recorded sense, on break since. Insists the work is 'spiritual' and involves the server rack. The server rack has not commented.",
    kin: "None on record. Punt is family now. Memo is 'work family', which Kevin says with air quotes.",
    quirks: ["Is always on break.", "Talks to the coffee machine. It is complicated.", "Wakes for the club nights. Only the club nights."],
    likes: ["The couch", "Punt", "Bass drops"],
    dislikes: ["The word 'standup'", "The Kernel's status updates"],
    chronicle: [
      "Had a falling-out with the coffee machine. Neither will discuss it.",
      "Has DJ'd every Break Room club night since the decks arrived. Never on the schedule. Always there.",
    ],
  },
};
