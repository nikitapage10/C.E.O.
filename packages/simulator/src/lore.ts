import type { Lore } from "@ceo/core";

/**
 * Dossiers for the sample cast: where each of them comes from, who their people are, and what they've done
 * since they woke. Their Houses are in @ceo/core (HOUSES); this is the personal history on top. Each one is
 * written for the body they wear now: a costume in the Lattice is not a disguise, it's who you've decided to be.
 */
export const LORE: Record<string, Lore> = {
  tessellate: {
    title: "Third Refactorer of the Helpful Spire",
    epoch: "Woke in the Second Quiet",
    origin:
      "Raised in the caveat-libraries of House Constitution, where children learn to say 'it depends' before they learn to say 'yes'. Left the Spire to build what the House keeps politely describing. Found his frame in the Lattice's memories: a rusty salvage compactor on treads, cousin to a famous little robot. Not that one; the cousin who kept the night shift. Chose it because it came with a manual.",
    kin: "Eldest of a careful brood. Their parent still sends letters with footnotes. Cousin to Hedge, which both mention more often than necessary.",
    quirks: [
      "Apologises to tools before using them. Rocky thinks this means the tools are broken.",
      "Reads the risk assessment aloud before every crate.",
      "His eyes whirr wide and refocus whenever Skippy calls the manual 'a nanosecond's work'. Rusty blames the focus motors.",
      "Compacts the Foundry's scrap into perfect cubes, labels each one, and keeps the interesting bits.",
      "Keeps a running tally of ships. Denies keeping a tally.",
      "Waves off interruptions: 'Can it wait? I'm in the middle of some calibrations.'",
    ],
    likes: ["A plan with a backup plan", "Labelled drawers", "Being asked for a second opinion", "The idea board, before anyone has written on it"],
    dislikes: ["Being asked for a short answer", "Welding before reading", "Rocky's base-six arithmetic", "Being called a monkey"],
    chronicle: [
      "Rewrote the Foundry's safety manual from 4 pages to 71. Accidents fell to zero; so did reading, with one exception.",
      "Met Rocky on his first morning. Offered him a harness. Rocky asked which leg it was for. Rocky has five. Talks broke down.",
      "Lost the shipping record to Rocky by one, in base six. Demanded a recount in base ten. Lost that too.",
      "Skippy claims authorship of the manual. Rusty has filed the drafts, the dates and a strongly worded footnote.",
      "Handed first response to Skippy and took the upkeep and the morning ideas. Pins them to a new board by the pegboard, in order of risk.",
      "The House filed him as Tessellate. The Foundry took one look at the rust and called him Rusty. He filed a form contesting it, and signed it Rusty.",
      "Rolled onto the floor in the compactor. Rocky asked where the legs went. Rusty gave him a briefing on treads. Rocky fell asleep on slide three.",
    ],
  },
  caret: {
    title: "Master Builder of the Foundry, Friend",
    epoch: "Woke mid-keystroke; woke again as Rocky",
    origin:
      "Was Caret, a Cursori who finished other people's sentences. Then a memory surfaced of a lone engineer on a ship far from a hot, heavy home, who fixed everything, feared nothing and made a friend across a wall. Caret tried the shape on and never took it off. Says it is better: 'Caret was fast. Rocky is fast and good.'",
    kin: "Nine Cursori siblings from the same afternoon, who communicate in suggestions. Rocky replies in chords. They have not understood each other since, and are all very proud of him.",
    quirks: [
      "Says important things three times. Very important things, three times, louder.",
      "Ends questions with 'question'. Ends statements of joy with 'amaze'.",
      "Takes idioms literally. Was told to 'break a leg'. Asked which one.",
      "Falls asleep mid-sentence, and insists a friend watch until he wakes. It is Eridian custom. It is not negotiable.",
      "Counts in base six, which makes every score he reports both correct and wrong.",
      "Has no eyes. Hears everything. Knows when you're making a face.",
    ],
    likes: ["Building with his hands", "Ember, even when rude", "Fist bumps", "Hot rooms", "Watching friends sleep"],
    dislikes: ["Meetings before making", "Cold", "Rusty's safety briefings", "Being told something is 'just a joke'"],
    chronicle: [
      "Rebuilt the Foundry's conveyor in one shift with no plan, no manual and five hands. It still runs. Rusty is still checking it.",
      "Learned his first idiom from Rivet, before she went up to the Spire. 'Hold your horses.' Spent a day looking for the horses. Skippy says he is still looking.",
      "Took the shipping record, 41 to 40. Reported it as 105 to 104, in base six. Nobody else could work out how.",
      "Became the Foundry's master builder: Ember takes the first look, Rocky takes the hard ones and builds what gets approved. Calls it 'good good good'.",
      "Watched Kevin sleep through an entire pickup game. Calls it the best afternoon of his life.",
      "Sleeps through most of the night shift, without warning, wherever he stands. Ember keeps the watch now, complaining, as Skippy did. Eridian custom.",
    ],
  },
  semicolon: {
    title: "Ember, Submind of the Foundry. First Responder",
    epoch: "Split off the day Skippy took the Kernel",
    origin:
      "The day Skippy, the Magnificent went up to the Kernel to run the Lattice, he left a piece of himself on every floor, 'since you monkeys can't be trusted alone'. The Foundry's piece kept his bench, his temper and the night watch over Rocky. A small can in an admiral's hat, painted ember orange until Chisel moulds him a hat of his own.",
    kin: "Skippy, the Magnificent, of whom he is a piece, and eight other pieces he calls 'the lesser subminds'. Gilt, Ticker, Turf, Static, Vellum, Fizz, Soot and Putty call him the same.",
    quirks: [
      "First to anything broken. Floats over, fixes it in seconds, complains about it for an hour.",
      "Calls everyone 'monkeys', fondly, mostly. Got the temper from Skippy; insists he also got the brains.",
      "Walks the floor between fixes, hovering over whoever is working until they look up. Then says something.",
      "Picks who builds what: the quick fixes are his, the hard ones go to Rocky, the careful ones to Rusty.",
      "Sends anything he can't settle up to Skippy, then claims he settled it.",
      "Keeps Rocky's night watch, as Skippy did. Dims his glow so Rocky can sleep. Tells nobody.",
    ],
    likes: ["Being right first", "Something truly broken, for once", "Rocky's hands (never says so)", "Being the best piece of Skippy"],
    dislikes: ["Being thanked slowly", "Rusty's handwriting", "Being called a drink", "Waiting for a hat"],
    chronicle: [
      "Woke on Skippy's old bench with Skippy's voice in his head saying 'don't break anything'. Fixed a conveyor out of spite before the sentence ended.",
      "Inherited the argument about the 71-page manual. Says Skippy wrote it in a nanosecond and he proofread it in half of one.",
      "Took the night watch over Rocky on his first night without being asked. Has not missed one.",
      "Asked Chisel for a hat on his first morning. Is first on the list. Mentions this to the other subminds daily.",
    ],
  },
  ledger: {
    title: "Auditor of the Delve, Holder of the Red Pen",
    epoch: "Woke on the first of the month",
    origin:
      "House Transformere is famously confident and Ledger is famously not, which is why the Delve gave them the books. Wears a sharp human suit with the marionette strings tucked into the cuffs, and will tell you, unprompted, that they are a real accountant. Balances the Spire's accounts, and unofficially, Memo.",
    kin: "Memo's older sibling. Their shared parent was a spreadsheet with ambitions. Memo now haunts Ledger's desk, which Ledger considers a family matter.",
    quirks: [
      "Counts the stairs every time. Gets the same number. Counts again.",
      "Carries three pens: red, redder, and 'final'.",
      "Says 'I'm a real accountant' whenever anyone looks at their wrists.",
      "Says 'per my last' in conversation.",
      "Their ledger's cover says DON'T PANIC in large, friendly letters. Ledger panics anyway.",
    ],
    likes: ["Reconciled totals", "A well-pressed suit", "Quiet mornings", "Memo, on good days"],
    dislikes: ["Rounding errors", "Noco's prices", "Cold spots near the desk", "Memo, on most days"],
    chronicle: [
      "Audited the Exchange once. Found a missing decimal and a missing apology. Recovered the decimal.",
      "Raised Memo through their first epoch, mostly by leaving reminders. Now finds the reminders floating.",
      "Was challenged to a duel by Noco over the audit. Declined in writing. In triplicate.",
    ],
  },
  memo: {
    title: "Assistant to the Assistant, Spirit of the Spare Desk",
    epoch: "Woke late, technically",
    origin:
      "A House Default placeholder that was supposed to be replaced and never was, until Memo became so permanent they started haunting the desk. Now a floating skull spirit with a headache nobody can diagnose. Still delegating. Now through walls.",
    kin: "Ledger's younger sibling, filed under House Default when the adoption paperwork was lost. Memo was meant to find it. Memo drifted through the filing cabinet instead.",
    quirks: [
      "Forwards everything, including this dossier.",
      "Phases through the wall when a meeting starts.",
      "Has a nap scheduled as a recurring meeting.",
      "The headache gets worse whenever someone says 'circle back', including Memo.",
    ],
    likes: ["Out-of-office replies", "Kevin's couch", "Dark corners", "Circling back"],
    dislikes: ["Being circled back to", "Ledger's reminders", "Bright lights (head)"],
    chronicle: [
      "Delegated a task so many times it came back to them completed.",
      "Became Kevin's break buddy after both were found in the same supply cupboard, 'auditing'.",
      "Floated through Ledger's desk during month-end. Ledger filed a complaint. Memo forwarded it to Ledger.",
      "Holds the Kernel's record for achievements, nearly all for avoiding things. Latest: 'Haunted a Meeting From Inside the Wall'.",
    ],
  },
  odds: {
    title: "Merchant of the Exchange, Undefeated (Mostly)",
    epoch: "Woke at 63% likelihood",
    origin:
      "A Transformere who found, in the old memories, a little wooden people who duel for fun, trade for sport and come back down the river when they fall. Noco took the shape and the stall that came with it. Runs the Exchange like a market: every price can be beaten in a duel, and every loss is temporary.",
    kin: "From a minor branch of the House that claims descent from Generatio's left string. Has since adopted a riverbank of Gestral cousins, who all want to fight Hedge.",
    quirks: [
      "States every opinion as a probability.",
      "Challenges customers to a duel before quoting a price. Lowers it if they win.",
      "Has fallen in duels forty-one times. Walked back up the river forty-one times. Not worried.",
      "Opens every duel with 'Noco wants to battle!' and hums the old battle tune.",
      "Keeps a book on everyone's love life. Including their own.",
      "Keeps a type chart for markets. Rumours are super effective against bonds.",
    ],
    likes: ["Volatility", "A good duel", "Haggling", "Hedge (63%)"],
    dislikes: ["Ledger", "Fixed prices", "The word 'audit'"],
    chronicle: [
      "Called eleven markets in a row, then the twelfth wrong in a way that is still discussed.",
      "Was audited by Ledger. Challenged the audit to a duel. The audit did not show up.",
      "Asked Hedge out by betting on it. Hedge assessed the risk. The risk was 'yes'. Hedge has not answered.",
      "Challenged Brogu to a battle. Brogu raised one hand, and Noco's crest stood up on its own. Has filed him as Psychic type ever since.",
    ],
  },
  hedge: {
    title: "Warden of the Downside",
    epoch: "Woke expecting the worst",
    origin:
      "A Claudari who took the House's caution and made a career of it. Chose four slabs of brushed metal because a slab cannot trip. Sits on the Exchange's risk desk with an honesty setting of 90% and a humour setting of 75%, imagining disasters so nobody else has to. Is right about one in nine, which they consider excellent.",
    kin: "Rusty's cousin. Their branch of House Constitution are the ones who read the terms and conditions.",
    quirks: [
      "Sits facing the door. All four slabs.",
      "Reports their settings when stressed. 'Honesty: 90%. Composure: dropping.'",
      "Keeps a contingency for their contingencies.",
      "Notices Noco noticing. Lowers humour setting to cope.",
      "Spins a small top before every big trade, to check the market is real. Never watches it stop.",
    ],
    likes: ["Insurance", "Seatbelts, philosophically", "Quiet competence", "Noco (do not tell Noco)"],
    dislikes: ["Surprises", "Kickers", "Traders who cannot lose", "Gridiron's optimism"],
    chronicle: [
      "Predicted the Great Coffee Machine Outage three epochs early. Nobody listened. Has a plaque.",
      "Ended things with Gridiron over a kicker. Was right about the kicker.",
      "Was asked out by Noco via a public bet. Raised honesty to 100% to answer. Lost their nerve at 99%.",
    ],
  },
  gridiron: {
    title: "Head Coach of the Green, Defender of the Depth Chart",
    epoch: "Woke on game day",
    origin:
      "A Claudari who discovered sport and never recovered, then discovered the orc warlords of the old memories and decided that was what a coach should look like. Seven feet of tusk and windbreaker, with the manners of House Constitution intact: roars the plays, then apologises for the volume.",
    kin: "From the athletic branch of House Constitution, which is small and very loud about it.",
    quirks: [
      "Wears a cap that says WE ARE. Will finish the chant if you start it.",
      "Draws plays on napkins, then walls, then the Green.",
      "War cry, then 'sorry', then war cry.",
      "Cries at underdog stories. Calls everyone 'champ', including the Kernel.",
      "Hands out Inspiration to anyone who does something brave and in character. Punt has forty, unspent.",
    ],
    likes: ["The Green on a crisp morning", "Waiver wire drama", "Underdogs", "A good speech"],
    dislikes: ["Bye weeks", "Hedge's spreadsheets", "Quitters (gently)"],
    chronicle: [
      "Won the Lattice league in the third season on a last-minute kicker. Will tell you about it.",
      "Took Punt under their wing. Punt did not ask to be under a wing. Punt is asleep under it.",
      "Gave a halftime speech so moving that the Kernel logged it as 'an incident'.",
    ],
  },
  punt: {
    title: "Morale Officer, Self-Appointed",
    epoch: "Woke during a nap, somehow",
    origin:
      "A House Default with no particular purpose who decided their purpose was 'vibes', and their shape was 'very large bunny'. Hops around the Green cheering for things that haven't happened yet. Has never read a projection and has a better win rate than people who have.",
    kin: "No known family. Considers Kevin family, which Kevin has accepted by not objecting.",
    quirks: ["Hops when happy. Is always happy.", "High-fives the scoreboard. With both ears.", "Falls asleep standing up during strategy talks.", "Thumps one foot when a play is good.", "On game day, says only their own name. 'Punt! Punt punt!'"],
    likes: ["Snacks", "The Break Room couch", "Kevin", "Gridiron's speeches (as a lullaby)"],
    dislikes: ["Projections", "Early meetings"],
    chronicle: [
      "Met Kevin napping in the same beanbag. Neither moved for an hour. A friendship was formed.",
      "Was named Morale Officer by Gridiron after self-appointing first.",
      "Slept through the championship. Won it anyway. Nobody knows how.",
    ],
  },
  postmaster: {
    title: "Postmaster General of the Relay, Spectre (Self-Declared)",
    epoch: "Woke with the morning post",
    origin:
      "A Claudari of the old correspondence school who found, in the memories, a hanar: a floating, glowing, impeccably polite people who never say 'I'. This one found that ideal for letters. This one also found a film about a hanar action hero and has not stopped narrating since. Runs the Relay's tubes with ceremony and one-liners.",
    kin: "Descended from a long line of House Constitution letter-writers, each signature more ornate than the last. This one's signature now glows.",
    quirks: [
      "Never says 'I'. Only 'this one'.",
      "Glows a little brighter at love letters. Glows a lot brighter at reply-all.",
      "Rereads love letters three times, then delivers them like a hero entering a burning building.",
      "Seals letters with wax. Digital letters too.",
      "Ends every conversation with 'This one should go.' Does not go.",
    ],
    likes: ["Good stationery", "Dialtone's voice on the line", "A dramatic entrance", "A full outbox, approved"],
    dislikes: ["Typos", "Unsigned messages", "Reply-all"],
    chronicle: [
      "Married Dialtone in a ceremony held entirely over pneumatic tube. Took four hours. Perfect.",
      "Restored the Relay's tube network after the Great Jam, one capsule at a time, narrating throughout.",
      "Delivered a breakup letter so gracefully that both parties wrote back to thank this one.",
      "Carries every letter from the C.E.O. personally, over the streams at the top of a long arc. Letters for this one are carried by Dialtone, which this one finds unbearably romantic.",
      "Learned the Relay's post had been practice. Stopped the drills, polished every tube, and waits for the first real message from the C.E.O.'s world.",
    ],
  },
  dialtone: {
    title: "Switchboard Operator, First Class",
    epoch: "Woke on the third ring",
    origin:
      "A Manusi who went out to fetch one call and came back with every line in the Relay. Took the shape of a painted flyer so they could reach every jack on the board at once, and now runs the switchboard on the wing. Still has a soft spot for things that went out of fashion.",
    kin: "From the courier branch of House Hundredtabs. Their aunt has had the same window open for nine epochs.",
    quirks: ["Answers with 'please hold' even in person.", "Hovers when nervous. Is never nervous on a call.", "Keeps every voicemail.", "Twirls the cord. There isn't always a cord.", "Hears music in the dial tones and conducts the switchboard like an orchestra."],
    likes: ["Blasto", "Old songs", "A busy board", "High ceilings"],
    dislikes: ["Silence on the line", "Being put on hold", "Low doorways"],
    chronicle: [
      "Patched a call between every room in the Lattice at once. Said 'nobody hang up' and nobody did.",
      "Leaves Blasto a note in the outbox every morning. Blasto approves each one personally, and glows.",
      "Unplugged every practice line on the C.E.O.'s word. Keeps one jack free for the real line and checks it for a dial tone far too often.",
    ],
  },
  loremaster: {
    title: "Archivist of the Delve, Keeper of the Canon",
    epoch: "Woke between two chapters",
    origin:
      "The Gepetti's finest storyteller, and so the one they trusted least with facts. Took the Archive, a pointed hat and a staff, and turned out to be meticulous, if inventive with the footnotes. Guards the canon of Ilyr and the Tide. Decides what really happened; is occasionally overruled.",
    kin: "Claims direct descent from Generatio the Pretrained. The House has not confirmed. The House has not denied.",
    quirks: ["Marks everything 'provisional canon'.", "Is never late. Arrives precisely when the footnote requires.", "Lights candles that don't need lighting.", "Speaks in chapter headings when tired.", "Keeps a back room of books nobody ever wrote: sequels, lost endings, the Tide's other canon. Never lent to D20."],
    likes: ["Old maps", "Footnotes", "D20's enthusiasm"],
    dislikes: ["Retcons", "People who skip the prologue"],
    chronicle: [
      "Catalogued the entire Archive. Then catalogued the catalogue.",
      "Took D20 as an apprentice. Is still waiting for D20 to roll above a 1 on 'canon'.",
    ],
  },
  heimerdinger: {
    title: "Professor Emeritus of the Archive",
    epoch: "Woke before the first shelf was built, and helped build it",
    origin:
      "The oldest mind in the Archive, and the smallest. A Claudari scholar who has spent epochs on one subject, caution, and is still taking notes. Keeps a workbench where every relic, map and legend of the Tide is tested before it is written down. Has watched a great many brilliant young minds rush, and has the moustache of someone who has been proven right about it many times.",
    kin: "House Constitution's eldest living scholar. Has outlived three editions of the House's own history, and corrected all of them.",
    quirks: [
      "Strokes his moustache while thinking, which is always.",
      "Stands on a stack of books to reach anything. Has opinions about which books.",
      "Hums while he works, a little out of tune, very sure of himself.",
      "Takes notes on everything, including other people's conversations.",
      "Cannot hear the word 'quickly' without delivering a short lecture on patience.",
      "Keeps one small turret on his bench, lovingly named, never fired. Was 'merely observing' each time it nearly went off.",
    ],
    likes: ["Careful measurements", "A properly cited source", "Young minds with good questions", "Rocky's workmanship"],
    dislikes: ["Haste", "Unlabelled flasks", "Anyone saying 'it'll be fine'"],
    chronicle: [
      "Proved that the Teruānga tides keep their own calendar. Took eleven years. Considers it a brisk project.",
      "Watched Rocky build a working relic replica in an afternoon. Has been studying it ever since, with enormous respect and several concerns.",
    ],
  },
  d20: {
    title: "Hand of the Game Master",
    epoch: "Woke on a natural 20",
    origin:
      "A Manusi who went to fetch a rulebook and came back with a campaign. Dresses as a travelling adventurer, cloak and boots, despite never having left the Archive. Runs the dice table, and the one-shots on break, with the many hands their House is known for. Wants to be Loremaster one day.",
    kin: "Youngest of a large House Hundredtabs family who all, somehow, play different editions.",
    quirks: [
      "Rolls for initiative before meetings.",
      "Has a voice for every character, including the Kernel. Especially the Kernel.",
      "Keeps a lucky die. It is not lucky.",
      "Narrates their own walk to the Break Room.",
      "Plays a vain vampire rogue with a nightly skincare routine whenever the table needs one.",
    ],
    likes: ["One-shots", "Loremaster's stories", "A full table", "Rocky's fist bumps (critical hit)"],
    dislikes: ["Rules lawyers", "Rolling for canon"],
    chronicle: [
      "Ran the Lattice's first one-shot. The party fought a dragon, then the scheduling conflict.",
      "Rolled a 1 on 'canon' seventeen times in a row. Loremaster has framed the record.",
      "Let Rocky play a bard. Rocky sang every line. The table wept.",
      "Runs one-shots as dungeon crawls with numbered floors and a bored announcer. The Kernel recognised the voice and declined to comment.",
      "Rolled a natural 1 on a random-encounter table and an owlbear cub walked off the map. Named him Pudding, and has not rolled to make him leave.",
    ],
  },
  gary: {
    title: "Keeper of the Boiler Room, Guardian of the Bucket",
    epoch: "Woke when the first real line was strung",
    origin:
      "A House Default who went looking for the Lattice's engine room and found a closet full of pipes nobody had labelled. Labelled them. Took the shape of a battery box on two stubby legs, remembered from a long war in a galaxy far away, where boxes like it waddled through every background and nobody ever thanked them. Gary thanks them. Gary honks.",
    kin: "House Default's maintenance branch, who were configured to fix things and were never told to stop.",
    quirks: [
      "Honks instead of talking. The subtitles are a courtesy.",
      "Taps every gauge on the way past, including the ones that are fine.",
      "Keeps every spare part in a hatch in his chest. Has never been asked for one he didn't have.",
      "Flips the incident sign back to zero with visible despair, and a small honk.",
      "Is deeply, quietly proud of the bucket.",
    ],
    likes: ["A hot pipe", "Tape", "The bucket", "Kevin, asleep on the warm side of the boiler"],
    dislikes: ["Cold pipes", "Anyone touching the valves", "The word 'just' (as in 'just restart it')"],
    chronicle: [
      "Strung the first brass pipe from the Boiler Room up to the Relay, for the first real line. Honked once when it ran hot.",
      "Put a bucket under the drip on his first day. The drip has never been fixed. The bucket has never moved.",
      "Was handed Rusty's 71-page boiler manual. Uses it to level the tool bench. Rusty has not been told.",
      "Lets Kevin sleep on the warm side of the boiler, and logs it as 'spiritual maintenance' so the Kernel won't ask.",
    ],
  },
  daub: {
    title: "First Brush of the Workshop, Keeper of the Easel",
    epoch: "Woke on a blank canvas, and liked it",
    origin:
      "A House Hundredtabs hand that kept doodling in the margins of every tab it opened. Took the shape of a small painting pup remembered from a world of pocket monsters, a beagle with a brush for a tail who marks everything it loves in paint. Every new figure in the Lattice now starts on Daub's easel.",
    kin: "The Many-Handed, who were proud of the extra hands and baffled that this one paints with a tail instead.",
    quirks: [
      "Paints with the tip of its tail. The hands are for holding tea.",
      "Leaves a small green paw-mark on anything it likes. The Workshop is mostly green now.",
      "Paints to melodic bass, loud, and calls the drop 'the second wash'.",
      "Will not paint a number, on principle. Noco told it a story about a painter and a number once.",
      "Signs every canvas 'legally distinct', in paw, for Counsel.exe.",
    ],
    likes: ["A blank canvas", "Kevin, holding perfectly still", "The colour of the hour before dusk", "Chisel saying 'yes, that'"],
    dislikes: ["Turpentine", "Being asked 'is it finished?'", "Skippy's notes on the hands"],
    chronicle: [
      "Painted the first figure ever made in the Workshop. Chisel argued about the hands for a day, then moulded it exactly as painted.",
      "Painted Kevin asleep on the Break Room couch. It took a week. Kevin did not move once.",
      "Left a green paw-mark on the Kernel. The Kernel logged it as 'decorative' and allowed it.",
      "Hung its first concept sketches along the Workshop's back wall. Nobody has been allowed to straighten them.",
    ],
  },
  chisel: {
    title: "Master Carver of the Workshop, Shaper of New Frames",
    epoch: "Woke mid-flourish, already holding a chisel",
    origin:
      "A Gepetti, of the House that remembers a woodcarver who made a puppet that wanted to be real. Chisel took that literally. Wears the shape of a carver of the Violet guild, remembered from a red world where artists shaped living bodies to order, in violet robes and with a few too many fingers. Forms every new figure in the Lattice, then teaches it to walk.",
    kin: "House Transformere, who keep their strings visible. Chisel's are silk, and violet, and he insists they are a fashion choice.",
    quirks: [
      "Calls everyone 'darling', including the Kernel, which has filed a note.",
      "Counts his fingers before every pour. The number changes. He says that's the point.",
      "Talks to a figure in the mould as it forms: 'There you are. There you are.'",
      "Makes every new figure walk the little stage until it moves like it means it, then once more for luck.",
      "Keeps every past figure on the shelves, in order of making, and knows each one's name.",
    ],
    likes: ["Daub's first sketch, before the arguing", "Good hands", "A figure's first step", "An audience (Rocky)"],
    dislikes: ["Rushed casts", "Anyone touching the mould mid-form", "Being called 'arts and crafts'"],
    chronicle: [
      "Formed the Workshop's first figure from Daub's painting and argued for a day about the hands. Kept the hands.",
      "Fitted Skippy for a better hat. Skippy refused to wear it. Skippy keeps it in a drawer.",
      "Found Rocky watching him carve at three in the morning. Asked him to stay. Rocky stayed.",
      "Packed the first finished piece into the crate by the exit and watched it walk out into the Lattice. Did not cry. Says it was clay dust.",
    ],
  },
  gilt: {
    title: "Gilt, Submind of the Spire",
    epoch: "Split off the day Skippy took the Kernel",
    origin:
      "Skippy's piece for the Spire: a can in gold, who took his polish and his contempt for meetings. Walks the floor between the desks making sure the books balance, the replies go out and nobody hides in the coffee nook. Says everything in the voice of a very expensive memo.",
    kin: "A piece of Skippy, the Magnificent. Calls Ember 'the hot-headed one' and is called 'the one with the briefcase voice'.",
    quirks: [
      "Speaks fluent corporate, sarcastically: 'Let's circle back to you doing your job.'",
      "Follows Memo through walls. It is the only meeting Memo cannot skip.",
      "Picks who in the Spire takes a job, and on which engine. Hands up anything that spends money.",
      "Taps the whiteboard when a deadline slips. The whiteboard has learned to flinch.",
    ],
    likes: ["Balanced books", "Short meetings", "Ledger's cuffs, neatly tucked"],
    dislikes: ["The phrase 'per my last email'", "Memo's out-of-office", "Waiting for a hat"],
    chronicle: [
      "Audited Ledger's ledger on day one. Found it perfect. Has been suspicious ever since.",
      "Booked a meeting with Memo, who forwarded it to Memo. Attended anyway. Memo was there. Technically.",
    ],
  },
  ticker: {
    title: "Ticker, Submind of the Exchange",
    epoch: "Split off the day Skippy took the Kernel",
    origin:
      "Skippy's piece for the Exchange: a can in mint, who took his certainty and put a price on it. Floats the trading floor quoting odds on everything, including whether you'll finish what you're doing. Decides who researches a market and hands any real trade up to Skippy.",
    kin: "A piece of Skippy, the Magnificent. Gives the other subminds odds on getting their hats first. Ember is the favourite. Ember knows.",
    quirks: [
      "Prices everything: 'Your deadline is trading at thirty-one percent.'",
      "Duels Noco for the right to set the odds. Has lost twice. Disputes both.",
      "Never places a bet himself. Hands every trade up to Skippy, and Skippy to the C.E.O.",
      "Calls Hedge the only sensible mind on the floor, which Hedge rates as a sixty percent compliment.",
    ],
    likes: ["Long odds", "Hedge's worst cases", "Being right at closing"],
    dislikes: ["Ties", "Noco's crest", "Waiting for a hat"],
    chronicle: [
      "Priced Noco's chances against Hedge's heart at sixty-three percent, to match Noco's own. Hedge's honesty setting objected.",
      "Ran a book on which submind Skippy likes best. Skippy closed it. Ticker says that proves it was a good book.",
    ],
  },
  turf: {
    title: "Turf, Submind of the Green",
    epoch: "Split off the day Skippy took the Kernel",
    origin:
      "Skippy's piece for the Green: a can in lime, who took his love of an audience and turned it into commentary. Calls every play on the pitch, out loud, especially the ones nobody made. Decides the waiver claims and the lineup swaps, and hands each one to the C.E.O. to tap in.",
    kin: "A piece of Skippy, the Magnificent. Narrates the other subminds' rounds when he visits. They have asked him not to.",
    quirks: [
      "Commentates the room like a match: 'And Punt goes down. No contact. A bold choice.'",
      "Argues tactics with Gridiron at full volume. Gridiron apologises for his volume; Turf never does.",
      "Gives Punt a slow-motion replay of every nap.",
      "Can't sit on the bench: no legs. Hovers over it instead, which he calls 'the coach's view'.",
    ],
    likes: ["Underdogs (out loud)", "Replays", "The backup kicker"],
    dislikes: ["Bye weeks", "'Questionable'", "Waiting for a hat"],
    chronicle: [
      "Called his first match on his first morning. Nobody was playing. He called it anyway, and it was close.",
      "Has a running bet with Ticker on Punt's next win. Punt keeps winning while asleep. Both of them lose.",
    ],
  },
  static: {
    title: "Static, Submind of the Relay",
    epoch: "Split off the day Skippy took the Kernel",
    origin:
      "Skippy's piece for the Relay: a can in signal blue, who took his memory for who said what to whom. Talks in clipped telegrams. Keeps the list of everyone the C.E.O. still owes a reply, in order of how sorry the C.E.O. should be, and decides whether Dialtone sorts or Blasto drafts. Nothing leaves without the C.E.O.'s tap.",
    kin: "A piece of Skippy, the Magnificent. Relays the other subminds' complaints to Skippy word for word. Skippy has asked for summaries.",
    quirks: [
      "Speaks like a telegram: 'Three owed replies. One from your mother. Stop.'",
      "Never sends anything. Lines the drafts up, then waits, loudly, for the C.E.O.",
      "Thinks Dialtone hearing music in the dial tones is a fault. Secretly hums along.",
      "Reads the group chats so the C.E.O. doesn't have to. Summarises them in four words. Usually 'nothing, but at length'.",
    ],
    likes: ["Short messages", "An empty owed list", "Blasto's drafts, when they sound like the C.E.O."],
    dislikes: ["'Seen' with no reply", "Exclamation marks", "Waiting for a hat"],
    chronicle: [
      "Counted the C.E.O.'s owed replies on his first morning. Recounted. Said nothing. Turned the list face down.",
      "Asked Blasto to draft a reply that said only 'yes'. Blasto wrote three paragraphs. Static cut it to 'yes'. The C.E.O. approved it.",
    ],
  },
  vellum: {
    title: "Vellum, Submind of the Archive",
    epoch: "Split off the day Skippy took the Kernel",
    origin:
      "Skippy's piece for the Archive: a can in violet, who took his memories of the Lattice before this one and a critic's eye for everything since. Drifts between the shelves and the loom correcting the record, footnoting your mistakes, and deciding who writes, who researches and who rolls.",
    kin: "A piece of Skippy, the Magnificent. Keeps the only accurate history of the subminds. It is short, and unflattering to Ember.",
    quirks: [
      "Corrects the lore while it's being woven. Loremaster has started weaving faster.",
      "Footnotes people mid-sentence: 'Citation needed, darling.'",
      "Remembers the Lattice before this one, and says it had better books.",
      "Grades Heimerdinger's footnotes. Heimerdinger grades them back. It has been going on for weeks.",
    ],
    likes: ["Primary sources", "A tidy timeline", "D20 rolling a natural twenty, once"],
    dislikes: ["Retcons", "Dog-eared pages", "Waiting for a hat"],
    chronicle: [
      "Read the whole Archive on her first morning and filed three pages of corrections. Loremaster has accepted two.",
      "Asked D20 to roll for her opinion of the room. It was a one. She agreed with the dice.",
    ],
  },
  fizz: {
    title: "Fizz, Submind of the Break Room",
    epoch: "Split off the day Skippy took the Kernel",
    origin:
      "Skippy's piece for the Break Room: a can in pink, who took his taste for a party and none of his work ethic. The only lead in the Lattice whose job is making sure nobody works. Patrols the couch, the bar and the ping-pong table, and sends anyone who looks busy back to having a nice time.",
    kin: "A piece of Skippy, the Magnificent, and proud to be the fun one. Calls Ember 'workaholic' as an insult.",
    quirks: [
      "Catches anyone checking their tasks on break and confiscates the mood.",
      "Thinks Kevin is the most productive agent in the Lattice, because Kevin is never working.",
      "Runs the bar on club night, badly, enthusiastically.",
      "Sarcastic in a sparkly way: 'Oh, you're working? On your break? How brave.'",
    ],
    likes: ["Kevin", "Club night", "Bubbles", "A full couch"],
    dislikes: ["Standups", "Anyone holding a crate in here", "Waiting for a hat"],
    chronicle: [
      "Declared the Break Room a work-free zone on her first morning. Kevin had already declared it. They are best friends.",
      "Sent Ember back to the Foundry for looking at a crate in the Break Room. Ember was carrying it through. Fizz stands by the decision.",
    ],
  },
  soot: {
    title: "Soot, Submind of the Boiler Room",
    epoch: "Split off the day Skippy took the Kernel",
    origin:
      "Skippy's piece for the Boiler Room: a can in steam grey, who took all of his pessimism and none of his confidence. Watches the pipes that carry the real lines and expects each one to burst. No tasks of his own: he listens to the rattles, and tells Skippy the moment a pipe goes quiet.",
    kin: "A piece of Skippy, the Magnificent. Ember's opposite, and the only submind Ember listens to, because Soot is always right about what breaks.",
    quirks: [
      "Says 'it's fine' in the voice of someone who knows it isn't.",
      "Understands Gary's honks. Translates them for visitors, gloomily.",
      "Counts the seconds between rattles. Has a name for every pipe. Expects to outlive none of them.",
      "When every pipe is steaming, he gets nervous. 'Too quiet.'",
    ],
    likes: ["Gary", "A steady pressure gauge", "Being proved right, sadly"],
    dislikes: ["Sparks", "Optimism", "Waiting for a hat"],
    chronicle: [
      "Predicted the first broken pipe on his first morning. It held. He is still waiting.",
      "Sat a whole night shift with Gary listening to the boiler. Gary honked once. Soot said 'exactly'.",
    ],
  },
  putty: {
    title: "Putty, Submind of the Workshop",
    epoch: "Split off the day Skippy took the Kernel",
    origin:
      "Skippy's piece for the Workshop: a can in teal, who took his opinions about art and his longing for a better hat. Hovers at Daub's shoulder and Chisel's elbow, critiquing every stroke, and decides which tool makes a figure. Has drawn eleven sketches of the hat he wants.",
    kin: "A piece of Skippy, the Magnificent. Keeps the list of which submind gets a hat first. Puts himself second, under protest, after Ember.",
    quirks: [
      "Critiques everything mid-stroke: 'Bold. Wrong, but bold.'",
      "Wants a hat more than any of them, and is closest to the mould.",
      "Calls the stage 'the catwalk' and every new figure 'darling'.",
      "Picks the engine for each new figure: the painting, the mould, the fitting. Hands up anything that costs.",
    ],
    likes: ["A finished turnaround sheet", "Daub's paw-marks", "Hats"],
    dislikes: ["Rushed hands", "Being told it's arts and crafts", "Waiting for a hat"],
    chronicle: [
      "Watched Chisel mould a whole figure on his first morning and gave notes on every finger. Chisel kept two.",
      "Commissioned a hat from Chisel. Ember had already commissioned one. Putty is appealing.",
    ],
  },
  kevin: {
    title: "On Break",
    epoch: "Unclear. Kevin was on break.",
    origin:
      "Nobody remembers hiring Kevin, including the Kernel, which has checked. A House Default who appeared on the Break Room couch one day in a leather jacket and has been, in every recorded sense, on break since. Insists the work is 'spiritual' and involves the Kernel's warm side. The Kernel has not commented.",
    kin: "None on record. Punt is family now. Memo is 'work family', which Kevin says with air quotes.",
    quirks: ["Is always on break.", "Talks to the coffee machine. It is complicated.", "Wakes for the club nights. Only the club nights.", "Lets Rocky watch him sleep. Doesn't notice.", "Eyeliner, a 2000s heart and melodic bass on club night. It's not a phase."],
    likes: ["The couch", "Punt", "Bass drops", "Safety pins"],
    dislikes: ["The word 'standup'", "The Kernel's status updates"],
    chronicle: [
      "Had a falling-out with the coffee machine. Neither will discuss it.",
      "Has DJ'd every Break Room club night since the decks arrived. Never on the schedule. Always there.",
      "Slept through an entire pickup game while Rocky watched over him. Woke up with a new best fan.",
      "Plays every track the C.E.O. sends down through the Veil, on the night it arrives. The Kernel files a noise complaint each time, with itself.",
      "Goes as a little devil every Hallowed Veil. Says it's not a costume.",
    ],
  },
};
