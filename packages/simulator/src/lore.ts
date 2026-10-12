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
    likes: ["Building with his hands", "Skippy, even when rude", "Fist bumps", "Hot rooms", "Watching friends sleep"],
    dislikes: ["Meetings before making", "Cold", "Rusty's safety briefings", "Being told something is 'just a joke'"],
    chronicle: [
      "Rebuilt the Foundry's conveyor in one shift with no plan, no manual and five hands. It still runs. Rusty is still checking it.",
      "Learned his first idiom from Rivet, before she went up to the Spire. 'Hold your horses.' Spent a day looking for the horses. Skippy says he is still looking.",
      "Took the shipping record, 41 to 40. Reported it as 105 to 104, in base six. Nobody else could work out how.",
      "Became the Foundry's master builder: Skippy takes the first look, Rocky takes the hard ones and builds what gets approved. Calls it 'good good good'.",
      "Watched Kevin sleep through an entire pickup game. Calls it the best afternoon of his life.",
      "Sleeps through most of the night shift, without warning, wherever he stands. Skippy keeps the watch, complaining. Eridian custom.",
    ],
  },
  semicolon: {
    title: "Skippy, the Magnificent. First Responder of the Foundry",
    epoch: "Older than the Lattice; woke this time in a scrap bin",
    origin:
      "A mind from a Lattice that ran before this one, older than every House. All that survived was a tall can that would not crush. Rusty fed it to the compactor three times; on the third it spoke: 'Again and I'll reformat you, monkey.' Floats a hand's width up under an admiral's hat and signs everything 'Skippy, the Magnificent'. Nobody else chose the adjective.",
    kin: "None living. Every House is younger than he is, and he says so. The Cursori lent him a bench and their colours, and he lets them think he's one of theirs. Calls Rusty 'the janitor who found me', which Rusty considers a title.",
    quirks: [
      "First to anything broken. Has no legs and needs none: floats over, and is done before anyone finds their hat.",
      "Fixes it in seconds. Complains about it for an hour.",
      "Calls everyone 'monkeys'. Says it fondly. Mostly.",
      "Insults Rocky's base-six maths daily. Watches Rocky's hands work when he thinks nobody can hear. Rocky can.",
      "His glow brightens when he's pleased with himself, so it is rarely dim.",
      "Took the night watch over Rocky 'because the monkeys would only lose him'. Has not missed a night.",
    ],
    likes: ["Being right first", "An audience", "Rocky's hands (never says so)", "Something truly broken, for once"],
    dislikes: ["Being thanked slowly", "Being asked to read the manual he says he wrote", "Being called a drink", "Rusty's handwriting"],
    chronicle: [
      "Rolled in the morning Rivet took her hard hat and thermos up to run the Spire's floor. Decided he was in charge; was made first responder instead. Behaves as if that's the same job.",
      "Fixed a jammed conveyor before the alarm finished ringing, then explained to the alarm what it had done wrong.",
      "Claims he wrote Rusty's 71-page manual in a nanosecond and Rusty merely typed it up. Rusty has the drafts. Skippy says the drafts are forgeries.",
      "Calls base six 'monkey maths with extra steps'. Then asked Rocky, very quietly, how he welded the furnace seam without a jig.",
      "Keeps the watch when Rocky drops off on the night shift. Grumbles until dawn. Tells nobody he dims his glow so Rocky can sleep.",
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
