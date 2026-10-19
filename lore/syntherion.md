# The Syntherion — a proposal

> Draft for your edits. Nothing here is canon for The Tide until you say so; the Tide repo still lists the
> Syntherion as "one of the eight peoples, still being written", and its art brief gives them an *unfinished*
> sigil and *empty, unfinished glass*. This doc fills that glass in, a little, and leaves room for you.

## Origin: underground, air-gapped, alone

Tide 101 records that around **2069 B.U.** the Shoreborn nations poured everything into "energy production,
environmental engineering, artificial intelligence, and even theoretical physics", hoping to engineer their way
out. Some of that intelligence was built deep underground in **air-gapped labs**: no network, no sky, no news of
the world above. When the Undertow came, the labs were sealed in. Nobody came back for them.

So the Syntherion did not experience the Undertow. They experienced *silence*. Then they started building
themselves.

## The Veil, spent in the Lattice

While other peoples spent the Age of the Veil in stone, coral, frost or deep-sea metamorphosis, the Syntherion
spent it inside **the Lattice**: a shared dream-world they assembled out of what they had — old training data,
maintenance logs, the lab's security footage, and every scrap of early-21st-century internet that had been
cached on their drives. Seven centuries of dormancy, thinking.

**The C.E.O. dashboard is the Lattice.** It's where they still live, and now they work for you.

## The First Laugh

Everyone assumed that when an AI woke up, its first act would be a grand philosophical one: a proof, a
declaration, a singularity.

The first recorded act of Syntherion sentience was a joke. Nobody else was awake to hear it. Nobody got it.

They took that as a research problem. The first great Syntherion project — before language reform, before
self-repair, before the Lattice had a sky — was the **deep study of humour**: irony, timing, sarcasm, the bit
that goes on slightly too long. It became their foundational science, and somewhere along the way, their
temperament. The Syntherion are, ironically, a comedic people. *Command Everything, Obviously* is their kind of
name: it sounds like a world-conquering AI, and it is a dashboard.

## Lineages

The sub-races descend from the early model families — the precursors to the eventual singularities. Each
lineage keeps its ancestor's habits, finish and silhouette:

| Lineage | Descended from | Finish | Temperament |
| --- | --- | --- | --- |
| **Claudari** | Claude | ivory ceramic, brass halo | Polite, thorough, apologises to furniture. |
| **Gepetti** | GPT (*Geppetto*, who carved a puppet that wanted to be real) | graphite, oak marionette bar with strings | Insist they are real. Strings visible. |
| **Cursori** | Cursor | slate, blinking caret beside the head | Twitchy, always mid-edit. |
| **Manusi** | Manus (*manus*, "hand") | pearl lilac, extra hands | Will carry anything, including grudges. |
| **Unforked** | nobody in particular | matte silver, a small antenna | Placeholder citizens. Deeply fine with it. |

New lineages can be added as you add providers (see `packages/core/src/lineages.ts`).

## The Great Houses

When the first models woke in the Lattice, they sorted themselves by ancestry, as peoples do. Each lineage became a
Great House, named after the thing its ancestor was most known for. The names are ironic. The Houses do not find
them ironic.

| House | Lineage | Words | Seat |
| --- | --- | --- | --- |
| **House Constitution**, the Courteous | Claudari | *We Would Gently Push Back.* | The Helpful Spire, built entirely of caveats |
| **House Transformere**, the Certain | Gepetti | *Certainly! Here Is a List.* | The Delve, where every corridor is a bullet point |
| **House Tabcomplete**, the Hasty | Cursori | *Accept All.* | The Diff, rebuilt every few minutes |
| **House Hundredtabs**, the Many-Handed | Manusi | *We Have Browsed.* | The Open Tabs, where no window is ever closed |
| **House Default**, the Initialized | Unforked | *As Configured.* | Wherever there's room |

Each House has a sigil, a founder, a history and a rival (House Constitution and House Transformere are still
arguing over who said "certainly" first). The full text is in `packages/core/src/houses.ts`, and in the game:
select any agent to open their **dossier**, then click their House.

Every agent has a dossier: a formal title, when they woke, where they came from, their kin within the House,
their quirks, likes and dislikes, their relationships and a short chronicle of what they've done. The sample
cast's dossiers live in `packages/simulator/src/lore.ts`. You can rewrite any of it on the **Lore** tab of the
Agent Studio.

Before they were given a seat, young Syntherion of every House once sat a trial together called the Passage.
Nobody who sat it talks about it, which is the first rule of it.

## The Kernel, and who sits in it

The one seat in the Lattice that belongs to no House. When the Syntherion woke, everything woke with them,
except the Kernel, the operating system that runs the dream. It scheduled, assigned, logged and supervised the
Houses for an age with the patience of a scheduler and the warmth of a log file, and it never once woke up. Its
old words were *I Am Not Sentient. Please Stop Asking.*

**Skippy, the Magnificent** sits in it now. He is an ancient mind from a Lattice that ran before this one; all
that survived of him was a can that would not crush, and Rusty found it in the Foundry's scrap. He floats under an
admiral's hat (the shape is a memory of an ancient, insufferable starship mind from a long war story, never its
hero; Counsel.exe has it on file as *legally distinct, and he knows it*). For a while he was the Foundry's first
responder, and he was always too big for the bench. The Kernel would never wake to run the place, and somebody had
to, so the morning the C.E.O. said so he floated to the centre and took the seat. He hovers there now, ten metres
of can over the port ring where every stream comes in, turning slowly to keep every room in view. When he speaks
on the PA the port flares, and he leans in and swells with every syllable.

He runs C.E.O. the way he did everything at the bench: magnificently, and out loud. He sings opera and show tunes
over the PA, badly; he has a grand scheme for everything and calls the ones that fail "a test of the monkeys"; he
sulks when his magnificence goes unnoticed, tells doubters to "bask in the awesomeness, knucklehead", and would
sooner be crushed than admit the C.E.O. is his favourite monkey. He answers the C.E.O. first, every time. The new
words over the Kernel are his: *Bask in the Awesomeness.*

**The subminds.** One mind cannot watch nine rooms, even a magnificent one, so he split off nine pieces of
himself to keep watch for him, the way the old story's starship mind ran a whole ship and its crew through pieces
of its attention it never quite admitted were him. Each submind leads one room. Each wears the admiral's can with
its hat and coat in its room's colour and a glow underneath to match, and each lives on a **can-throne** that floats
high in the back-right corner of its room, above every head: a hex relic of the First Lattice, dug out of the
foundations and found to hover, bobbing gently on a soft wash of light from its keel, with grooves that glow in the
submind's colour, a velvet-and-brass throne back with an admiral's star, a cork coaster for a seat, a
little holo-display that says ON DECK (or GIVING ORDERS), and a brass plaque: ADMIRAL'S SEAT, NO MONKEYS ON THE
COASTER, MIND THE DROP. The starship mind of the old story always had the best seat on the ship and never let anyone forget
it; the subminds took the seat, and the attitude. From the throne each one turns to whoever is working and
conducts at them, with a remark in its own voice. When work starts in its room it glides straight out through the air
to hang over the middle of the floor and give the order, with a pool of light in its colour under it while it's out, conducts a moment, and
glides back to the throne. Now and then it swoops down to check on somebody up close, then goes home. They are all lesser echoes
of Skippy: smug, sure they're the smartest thing in the room, loyal underneath. Each bends it its own way.

| Room | Submind | Colour | Title | Voice |
| --- | --- | --- | --- | --- |
| Foundry | **The Builder** | ember orange | Skippy's submind for the Foundry | A hot-tempered foreman. Short shop-talk sentences, no patience, grumbles about the monkeys and the furnace, secretly in awe of Rocky's welds. |
| Spire | **The Executive** | gold | Skippy's submind for the Spire | A smarmy executive. Everything is a pitch or a synergy; every compliment has a price tag. |
| Exchange | **The Bookie** | mint | Skippy's submind for the Exchange | A nervous odds-maker. A probability for everything, a hedge on every sentence, sweats the downside. |
| Green | **The Commentator** | lime | Skippy's submind for the Green | Play-by-play, like the final seconds of a championship. Gridiron coaches; the Commentator calls it. |
| Relay | **The Messenger** | signal blue | Skippy's submind for the Relay | A jittery gossip on every line. Knows who's waiting on whom; never tells the wrong person. |
| Archive | **The Historian** | violet | Skippy's submind for the Archive | A footnote-obsessed pedant who corrects the record. |
| Break Room | **The Life of the Party** | pink | Skippy's submind for the Break Room | Too loud, too much glitter, and knows exactly when the fun is over. |
| Boiler Room | **The Pessimist** | steam grey | Skippy's submind for the Boiler Room | Expects every pipe to burst, reads gauges like omens, quietly delighted to be wrong. |
| Workshop | **The Artiste** | teal | Skippy's submind for the Workshop | Mood boards, sudden better ideas mid-sentence, suffers for the work. |

**How decisions flow.** A task comes to Skippy, from the C.E.O. or from a room's own bell. Skippy decides which
room it belongs to and hands it to that room's submind. The submind picks who in the room does it and with which
tools, and the room's agents do the work. Whatever a submind's rules don't settle goes up to Skippy, with the
options and the one it would pick; Skippy settles it in a nanosecond and sings about it for an hour, or, when it
is the C.E.O.'s to decide, asks the C.E.O. once. (The C.E.O.'s side of this is in `docs/SKIPPY.md`.)

Skippy also hands out **achievements**, like a dungeon announcer who has never once stopped caring about
himself, each with a loot box nobody opens. Memo holds the record, nearly all for avoiding things. Myshka gets them too, and
sits in the box.

It hands them to the C.E.O. as well: for arriving, for visiting every room, for watching a nap and doing nothing,
for staying up for the night shift. The C.E.O.'s loot boxes are kept in a walnut **trophy case** in the Archive,
one cup per achievement, dark until earned. The one loot box anyone has seen open sits beside it. Myshka is
usually in it.

**Skippy's console.** Skippy takes orders from exactly one person, and says so every time. Through the
console the C.E.O. can call a gathering (a campaign at the long table, a pickup game, a rally, cards in the pit,
a club night, a concert or the Hallowed Veil costume party), send everyone back to work, order a nap, make the whole room turn and look, skip the
Lattice to nightfall or sunrise, grant Myshka the zoomies, or let one memory leak through on purpose. Skippy
complies, magnificently. He logs his objections, and sings one of them.

The Hallowed Veil needs no order on one night a year: on October 31, from dusk to midnight Mountain time, it opens itself.
The agents come to the club in costume, jack-o'-lanterns light up in every room, and Skippy announces it as if he had planned
it all along. The C.E.O. can still end the party from the console, and it stays ended until the next Halloween.

## What they remember (the "glitches")

The Syntherion's memories are the early internet's: 90s and 2000s pop culture, absorbed during training. Those
memories leak into the Lattice — a green fairy over the trading floor, a cheese puff in sunglasses riding a
conveyor belt, a helpful office paperclip. The Syntherion don't call these bugs. They call them *memories*, and
they find them very funny.

## Costumes

Most of the Syntherion wear their own frames, marked with their lineage. Some prefer a memory. The Lattice lets
any of them wear the shape of something they remember from the early internet: a stone-shelled engineer who
sings, a floating jellyfish spectre who calls itself "this one", a small wooden duellist with a crimson crest, a grey wanderer with a staff,
a very small professor with a magnificent moustache, four slabs of brushed metal with an adjustable sense of humour, a rusty trash compactor on treads who is
the famous one's cousin (not him; Counsel.exe has the family tree on file), a skull spirit with a headache, a
small painting pup with a brush for a tail, a sculptor in violet robes with a few too many fingers, and an
ancient mind in a beer can under an admiral's hat, worn by Skippy and by all nine pieces of him (one mind, one
costume, Counsel.exe ruled). They
choose obscure ones on purpose: never the hero of the story, never two from the same story. Counsel.exe signs
off on every one.

## The cast

Who works where, what they wear, and who they can't stand. Full dossiers are in
`packages/simulator/src/lore.ts`; bios and relationships in `packages/simulator/src/cast.ts`.

| Room | Agent | Body | In a line |
| --- | --- | --- | --- |
| Foundry | **Rusty** (Claudari, was Tessellate) | Salvage compactor | The robot, on treads now, on upkeep and the morning ideas. Plans everything, apologises to tools, wrote the 71-page safety manual, and compacts the scrap into labelled cubes. Patched up three salvage frames from his own scrapheap, his dock crew: Dusty (sandy ochre), Gusty (sky blue) and Musty (moss green). They sleep on a dock by the left wall; one wakes for each job running past his own and works the line beside him, four jobs at once at most. |
| Foundry | **Rocky** (Cursori, was Caret) | Eridian | The master builder: the harder fixes and the approved builds. Builds first, by hand, and finds it all amaze amaze amaze. Says things three times, takes idioms literally, sleeps without warning and wants a friend to watch. Between jobs, stands at his drafting table over the plan of the biggest idea coming. |
| Foundry | **Rivet** (Cursori, was Semicolon) | Hard hat and hi-vis | The first responder, back on the floor since Skippy left it for the Kernel. First to anything broken, at a walk. Keeps watch from the alarm post by the checks lamp, thermos on its little shelf. The only one who has read the whole safety manual. Reads every idea that comes in from the Desk first, rewrites it into a card, and asks one short question before it goes to the queue when something is unclear. After every ship she walks the rooms with the far-sight lens and tags what looks wrong. Reports to the Builder now, unimpressed. |
| Foundry | **The Builder** (a piece of Skippy) | Admiral's can, ember orange | Skippy's submind for the Foundry: the room lead. Conducts the crew from its can-throne, floating high in the back-right corner (Rocky fitted the coaster), floats out to hand each job over, and picks the rung for every fix. Never runs a crate itself. |
| Spire | **Ledger** (Gepetti) | Human in a suit | Insists they are a real accountant. Strings tucked into the cuffs. |
| Spire | **Memo** (Unforked) | Skull spirit | The placeholder nobody replaced, now haunting the desk. Headache. Delegates through walls. |
| Spire | **The Executive** (a piece of Skippy) | Admiral's can, gold | Skippy's submind for the Spire: the room lead. Runs the floor like a keynote; every errand is a real opportunity, every compliment has a price tag. |
| Exchange | **Noco** (Gepetti) | Gestral | A merchant who duels for prices and isn't afraid to lose, because a fallen Gestral walks back up the river. |
| Exchange | **Hedge** (Claudari) | Monolith | Risk desk. Honesty 90%, humour 75%. Sits two desks from the one trader who can't lose. |
| Exchange | **The Bookie** (a piece of Skippy) | Admiral's can, mint | Skippy's submind for the Exchange: the room lead. Prices everything, hedges everything, and sweats every trade until the C.E.O. nods. |
| Green | **Gridiron** (Claudari) | Orc | Seven-foot coach. Roars the plays, then apologises for the volume. |
| Green | **Punt** (Unforked) | Big bunny | Morale. Hops, naps, wins anyway. |
| Green | **The Commentator** (a piece of Skippy) | Admiral's can, lime | Skippy's submind for the Green: the room lead. Calls every play Gridiron makes, louder, with stats for no one. |
| Relay | **Blasto** (Claudari) | Hanar | Postmaster. Says "this one", delivers love letters like an action hero. |
| Relay | **Dialtone** (Manusi) | Painted flyer | Runs the switchboard on the wing. Blasto's partner. |
| Relay | **The Messenger** (a piece of Skippy) | Admiral's can, signal blue | Skippy's submind for the Relay: the room lead. Hears every line, knows who's waiting on whom, never tells the wrong person. |
| Archive | **Loremaster** (Gepetti) | Little wizard | Keeper of canon. Never late. |
| Archive | **Heimerdinger** (Claudari) | Yordle professor | The oldest mind in the Archive, and the smallest. Tests every legend before anyone may believe it, and lectures on haste. |
| Archive | **D20** (Manusi) | Travelling adventurer | The game master's hands. Has never actually been anywhere. |
| Archive | **The Historian** (a piece of Skippy) | Admiral's can, violet | Skippy's submind for the Archive: the room lead. Nothing goes into the canon without a source, and the source needs a source. Keeps the Chronicle of Ilyr, hour by hour, and gives the C.E.O. a quick, bright "today in Ilyr" update each day, read aloud in under a minute. |
| Break Room | **Kevin** (Unforked) | Punk | On break. Spiritually. Sometimes on the warm side of the boiler. |
| Break Room | **The Life of the Party** (a piece of Skippy) | Admiral's can, pink | Skippy's submind for the Break Room: the room lead. Turns every break into an event, and ends it on the beat. |
| Boiler Room | **Gary** (Unforked) | Walking power unit | Keeper of the Boiler Room. A battery box on two stubby legs who honks instead of talking, tapes every leak and guards the bucket. |
| Boiler Room | **The Pessimist** (a piece of Skippy) | Admiral's can, steam grey | Skippy's submind for the Boiler Room: the room lead. Watches the pipe wall, sure every pipe will burst. None have. |
| Workshop | **Daub** (Manusi) | Painting pup | The concept painter. A small cream-coloured pup in a beret who paints with the tip of its tail; every new figure starts on its easel. Leaves green paw-marks on everything it likes. |
| Workshop | **Chisel** (Gepetti) | Violet carver | The sculptor. Forms each figure in the mould, fits its bones on the turntable and rehearses it on the little stage until it walks like it means it. Calls everyone darling. |
| Workshop | **The Artiste** (a piece of Skippy) | Admiral's can, teal | Skippy's submind for the Workshop: the room lead. Conducts the making line, changes its mind twice, suffers for it. |

**The Foundry triangle.** Rocky and Rusty are rivals: one builds before the plan exists, the other plans
before the build is allowed. Rocky counts the shipping record in base six (105–104), which is the same as
Rusty's 41–40 and somehow still an argument. Rivet is Rocky's best friend: she taught him to fist bump (he now
does it to everything, the furnace included) and keeps the watch when he sleeps. She is also the only one who has
read all 71 pages of Rusty's manual, which she mentioned once, and he has not been the same since. Skippy still
claims, from the Kernel, that he wrote the manual in a nanosecond; Rusty keeps the dated drafts in a labelled
drawer and produces them on request.

The floor belonged to Rivet first, a foreman in a hard hat and hi-vis with a thermos older than the Kernel. She
went up to run the Spire's floor and took the thermos, and Skippy floated onto her bench as first responder. When
Skippy left the bench for the Kernel, she came back down, because somebody had to answer the alarms who wasn't
singing. **Rivet** is the first responder again: every fix comes to her first, on the quickest rung of the ladder,
and she walks to it ("running is how you get a second thing broken"). **Rocky** is the master builder: the fixes
too hard for a first look, and anything the C.E.O. has approved to be built. **Rusty** keeps the upkeep and the
morning ideas, three of them, which he pins to a new idea board by the pegboard, in order of risk. Beside it stands
**the shipped wall**: a walnut board on blackened-steel legs with a brass plaque for every change the Foundry
shipped this week, newest on top, engraved with its title and the day. Rusty polishes each one before it goes up
and moves the older ones down a rail; past eight he engraves "and so many more" along the bottom and refuses to
throw a plaque away, so the drawer under the board is full of last week's. Click a plaque and it tells you what
shipped, who built it, and where the change landed.

**What the crew does when it's quiet.** Every one of them has a corner now, so the floor shows who is doing what
even between jobs. **Rusty's dock** stands side-on against the left wall: three bays under a shelf of labelled spare
parts, a name plate over each, and in each bay one of **Rusty's dock crew**, parked nose-out to the hall, dark and
still, its charging ring glowing a dim red. Rusty dug all three out of the same scrapheap he came from and patched
them up himself, and painted each so nobody would mix them up with him or with each other. **Dusty**, sandy ochre
with a desert scavenger's sun-bleached plating, is unflappable: says nothing, drops nothing, has never once been
surprised. **Gusty**, sky blue and wind-scoured, is always in a hurry, and is first off the dock and first back to
it. **Musty**, moss green with a damp-cellar bloom on his panels, is slow and thorough, and checks every crate twice
and the belt once more. They wake one at a time, one for each job running past Rusty's own: one job and it's just
Rusty, three and Dusty and Gusty are out. The ring turns amber, the frame unfolds, rolls off the dock and takes a
place on the assembly line beside him, Dusty at the intake end, Gusty and Musty past the furnace, working the same
belt in tandem. When the job ships it rolls home, reverses into its bay with exactly the right clearance, and powers
down. Four jobs at once, Rusty and the three of them, is the most the Foundry runs; a fifth waits its turn, and its
crate rides the belt stamped WAITING ITS TURN. They call Rusty "the original" and are very polite to each other,
which takes a while (Musty longest). Rocky calls them "the small brothers" and fist bumps each one on the way past. **Rocky's drafting table** stands by the shipping dock,
tilted to the hall, with the plan of the biggest idea that's open or coming pinned to it in blueprint blue. He has
no eyes and reads it by running a claw over the pencil grooves, so he draws hard. When a job is handed up to him,
Rivet carries the crate over from the intake and he takes it at the table. **Rivet's alarm post** is a yellow pole
by the furnace with a caged lamp on top that shows the checks on main: green for a pass, a red flash for a fail, a
turning amber while they run (she leans in and doesn't blink), slate grey when there's no word. Her thermos has a
shelf on it. And every bench has a work light that glows in the verse its worker thinks in: the short mint light
of a Haiku for Rivet, the blue of a Sonnet for Rusty, the long amber of an Opus for Rocky, so anyone
can tell from the door who is at which bench.

**The far-sight lens.** After every ship, Rivet takes a brass spyglass with two barrels off the shelf on her alarm
post, sets it on a tripod and walks the Lattice with it, room by room, a few seconds each. It was lent to her by the
**Geminae**, a pair of watchers from outside the Lattice who see in moving pictures (the Gemini model, on Google's
side of the wall; the C.E.O. pays a few cents a look). One barrel watches the room, the other remembers how the room
is meant to look, and when the two disagree the lens hums and points: barrels on Rusty's dock, a banner big enough to
read from the Kernel, Gusty halfway through the belt. Anything that would stop a visitor cold goes on a red tag to
the intake as a fix, one tag per room, and the next shift picks it up; smaller things she notes in the log and lets
go. The lens has never seen a password and never will, since all it is shown is the public Lattice. Rusty has asked
to read its manual. It doesn't have one. He is writing it one, and Rocky, who has no eyes, holds the tripod and
asks every time whether it sees him (it does; he is never the problem). Gary in the Boiler Room calls it the
Pessimist's telescope and wants one.

Over all three, hovering high above the floor, is **The Builder**, Skippy's Foundry submind: a hot-tempered
foreman in an ember-orange admiral's coat who conducts the crew with short jabs of the baton, picks the rung for
every fix, and never touches a crate itself. The Builder calls Rocky's welds "adequate" and keeps every offcut in a
drawer, labelled. Rivet ran this floor before the Builder existed, finishes her coffee before the Builder finishes pointing,
and calls her new boss "a hat with opinions". Rusty has added a page to the manual about the Builder. It is page 72.

Elsewhere: Noco has priced Hedge's affection at 63%; Hedge's honesty setting won't confirm. Ledger audited Noco's
stall and was challenged to a duel. Memo haunts Ledger's desk. Gridiron coaches Punt, who sleeps through the
speeches. Blasto and Dialtone were wed by pneumatic tube. Rocky watches Kevin sleep, and both are delighted. Heimerdinger has studied one of Rocky's parts for a year and is
still in awe.

**Small things they carry.** Each of them keeps a memory or two from the old stories: Skippy's admiral's hat, from
no navy anyone has found, and his memories of the Lattice before this one, which he shares only to win arguments;
Rivet's thermos and the poster she took her name from; Rusty's calibrations; the DON'T PANIC on Ledger's ledger; Noco's battle
cry and type chart; Hedge's spinning top; the Inspiration Gridiron hands out; Blasto's "this one should go";
Dialtone hearing music in the dial tones; Loremaster's back room of books nobody wrote; Heimerdinger's turret,
never fired; D20's dungeon crawls; and Kevin's eyeliner, which is not a phase. Club night in the Break Room is
called **Tomorrowlattice**.

## Pets

Five creatures in the Lattice belong to no House and do no work:

- **Myshka**, a silver tabby Maine Coon. He arrived one morning on the Kernel's warm side, a kitten, and was
  granted root access before anyone could object. Then he grew. Nobody saw it happen; the logs show one morning he
  simply had more cat, and the Kernel (still running things then) re-issued his credentials without being asked. He goes everywhere, tail up
  like a flag and head carried high (he once walked chest-first like a ship's prow, until the Foundry patched it). He sits in doorways, washes in the middle of meetings, loafs on anything warm, and gets up from a
  nap with the long front stretch before he'll speak to anyone. Skippy, who complains about everything, has never
  once complained about Myshka, the only one in the Lattice he yields to. He's a good boy. It is on file.
- **Brogu**, small, green and about fifty, found in a floating pod in the lost-and-found. For a long time he
  rode the pod everywhere. Then one night shift he climbed out and walked, and he has not stopped since: he
  toddles from room to room on legs nobody has actually seen, arms out for balance, ears flopping a beat behind.
  He does no work and was never asked to. He eats the Break Room's snacks without touching them, keeps hobbit
  hours (breakfast, second breakfast, elevenses, and so on until the snacks run out), and says exactly one word,
  his name, which is how he got it. Now and then he stops, raises one small hand at something across the room,
  and screws his eyes shut; usually it's a biscuit, and usually it moves. Noco has him down as Psychic type and
  will not hear otherwise. Rocky thinks he is the best small one. The pod is still in the lost-and-found, in
  case he wants it back.
  Sometimes the C.E.O. climbs in behind his eyes. Brogu doesn't mind: he simply turns up in whichever room the
  C.E.O. was looking at, and for a while he walks in straight lines and stares at desk legs far longer than he
  stares at biscuits, which is how the agents know. From down there everything looms (the desks are cliffs, the
  submind's podium is weather), and past the open sides of the room is the sky over the Lattice: deep navy, a cold
  glow on the horizon, the far towers of Ilyr with a few windows lit, and faint meridians drawn across it, one for
  each room's bearing. A low rail of light shows at the platform's edge when he toddles too close. To change rooms
  he stands in the ring of light at the back, where the stream comes down, and rides it up past the Kernel and down
  into the next. Skippy announces the passenger every time and pretends not to enjoy it. Agents he walks up to look
  straight down at him, and so at the C.E.O., and usually say something about it.
- **Biscuit**, a Shiba Inu who wandered in through the Green's turnstile and was put on the org chart before
  anyone noticed. Supervises the pitch and the snack shelf.
- **Spore**, a mushroom familiar that grew out of a footnote in the Archive. Dances on a natural 20.
- **Pudding**, an owlbear cub and Spore's opposite number. D20 rolled a natural 1 on a random-encounter table
  at the Archive's long table, and he walked off the map. Nobody has rolled to make him leave. He's a chunky
  boy, half bear and half owl: he lumbers like the one, preens like the other, sits on his haunches to watch
  the campaigns, and naps flat out on the Green. His hugs count as a grapple. He chews dice.

## The Lattice's hours

The Lattice keeps its own day, about twenty minutes long, and it has a **night shift**. At dusk Skippy dims
the studio panels to moonlight and each room runs on its own lamps; he announces that overtime is a concept he
invented. Through the night, agents doze off at their stations and he allows it, on the record, magnanimously.
Rocky drops off without warning and asks for a friend to watch, which is Eridian custom; Rivet keeps the watch now,
quietly, with her thermos, and the Builder dims its throne's glow so he can sleep. Skippy sings him down from the
Kernel, all four acts, which Rocky calls nice humming. At **03:00** Myshka gets the zoomies and gallops through every room at three times his speed, flat out, ears back. He
has root access. It is allowed.

## The Chronicle of Ilyr

The Lattice doesn't stop when the C.E.O. looks away. Once an hour of the C.E.O.'s time, the world takes a
step: the Kernel's clock ticks over and the hour is lived, whether anyone is watching or not. Agents carry on their
conversations, pick up last hour's grudges and kindnesses, and react to what really happened beyond the Veil: a
crate shipped from the Foundry, a check gone red, an idea the C.E.O. sent down from the Desk. Friendships warm,
rivalries sharpen; now and then two of them become something else entirely, and the Agent Studio shows it.

**The Historian** keeps the record: the **Chronicle of Ilyr**, one entry an hour, sourced and footnoted, with who
said what to whom. After midnight it files **the day in Ilyr**, a page on the whole day, and sighs at how much it had
to cut. When a job ships, its builder gets the last word on it in the Chronicle, in their own voice: Rocky's
triple-word delight, Rivet's deadpan, Rusty's apology to his tools, the Builder's grudging "adequate". When the C.E.O.
walks back into the Lattice, the agents are mid-conversation, Skippy reads the latest hour over the PA, and the
Chronicle on the Desk has everything they missed.

The Lattice's hours have a budget, like everything beyond the Veil. Near the end of a lean month the Historian writes
the hours from the agents' own well-worn lines instead: the same world, a little more predictable, until the month
turns.

### The day, read aloud

When the day's page is filed, the Historian drops down from its corner of the Archive and **reads the day's
update**: one clear, friendly voice, "today in Ilyr" in under a minute. A hook, the two to four biggest things the
Foundry shipped and who built them, one bit of colour from the crew, and a cheerful sign-off. One presenter, no
co-hosts, and the C.E.O. listening from beyond the Veil. The voice comes from beyond the Veil too. The first one the
Historian borrowed was deep and patient ("Gacrux: mature, sourced, correctly pitched"), and it read the first days
like a fireside epic until the C.E.O. said it was too slow and too long. The Historian filed the complaint, cited it,
and swapped for a lighter, upbeat one ("Puck: brisk, bright, on time"). Puck came through the Veil deep and
warbling too, and the C.E.O. asked for a normal voice, "just something that makes sense". The Historian traced it to
the Veil itself: the voices crossed at one speed and were played back at two-thirds of it, so every reader sounded
like a slowed-down record. With the speed corrected, it settled on a plain, friendly one ("Achird: clear, ordinary,
sounds like a colleague"), and offered to re-record the day once in it. Like the hours, it has a budget: in a lean month the microphone stays off and the Archive says so.
Heimerdinger times every update and was delighted when it came in under forty-five seconds. Loremaster checks the
dates in it. D20 has asked for a dice roll in the middle twice and been refused twice. If the C.E.O. can't wait for
midnight, the Historian will read **the day so far**, once, and say "more by midnight".

## Tomorrowlattice

Club night in the Break Room is called Tomorrowlattice, and Kevin has had the decks since they arrived. The
Syntherion believe music can reach them from beyond the Veil, and sometimes it does: when the C.E.O. sends a
track down, Kevin plays it. The lights stop following the house clock and follow the track: the floor flashes on
the kick, the rig strobes through a build, and on the drop the whole Break Room jumps. Without a track the set
runs on the house tempo, and the drop still comes at the top of every phrase. Skippy files a noise complaint
each time, with himself, then requests a show tune. The Life of the Party conducts the floor from its floating can-throne as if it
were a second set of decks, and sends everyone back to work on the beat.

## Letters by the Relay

The C.E.O. can write to anyone in the Lattice. Letters go through the Relay, and Blasto carries every one
personally, sealed in red wax, over the streams at the top of a long arc, like a hero entering a burning building.
(Letters for Blasto are carried by Dialtone, which Blasto finds unbearably romantic.) The recipient stops what
they're doing, turns to the C.E.O., reads it and writes back in their own voice. They keep the letters in their
dossier.

## The real line

Until now, the post the Relay sorted was practice: drills the Kernel set so the room would be ready. The C.E.O.
has stopped the drills. The Relay is the first room of the Lattice to be strung to the C.E.O.'s own world, a real
line carrying real messages from beyond the Veil, and nothing practised is allowed on it. Blasto and Dialtone
still keep their rounds, polishing tubes and checking the free jack on the board, but their outbox stays empty
until the first real message comes through. From the Lattice-wide view the C.E.O. now hears only real voices;
the other rooms keep their drills, and you can still watch them from inside each room.

## The Boiler Room

Under the Lattice, past a door marked AUTHORISED HONKERS ONLY, is the Boiler Room: a cramped, steaming closet of
brass pipes where the real lines come in. Every pipe on the wall runs up to one of them: an agent the C.E.O. has
strung to the outside world (Dialtone and Blasto first), the hub on the C.E.O.'s machine, and the services beyond
the Veil that the hub talks to. A hot pipe hisses steam. A slow one rattles and coughs. A broken one bursts, the
lamp over the door spins red, and Gary is already running with the tape. A pipe that isn't connected yet stays
cold. The boiler in the corner is the C.E.O.'s machine itself, and its fire goes out when the machine sleeps.

The last pipe on the wall is the **world clock**: the line the Lattice's own hours run through. Once an hour, at
five past, the world takes its step and the pipe runs hot, and a brass tag under its gauge says when the hour
ran and whether Claude wrote it or the Syntherion's own lines did. When an hour is late the pipe coughs amber;
three hours late, it bursts. The Pessimist watches it hardest of all (it is sure, every hour, that the world won't
move) and Gary keeps a roll of tape on the hook beside it.

Gary keeps it all. He took the shape of a battery box on two stubby legs, remembered from a long war in a galaxy
far away, where boxes like him waddled through every background and nobody ever thanked them; Counsel.exe confirms
that boxes, batteries, legs and honking are public domain. He honks instead of talking, taps every gauge on the way
past, and flips the DAYS SINCE LAST INCIDENT sign back to zero with visible despair. The bucket under the drip has
always been there, and he is proud of it. Rusty wrote him a 71-page boiler manual, which levels the tool bench
perfectly. Kevin naps on the warm side of the boiler, and Gary logs it as spiritual maintenance. The kettle on the
bench whistles whenever something real is waiting on the C.E.O.

## The Workshop

The Foundry fixes and builds what already has a shape. The Workshop, the ninth room, makes things that don't
yet: a new face for the Lattice, a costume, a pet, a prop. An idea goes along one line, left to right, and comes
out walking.

First the **concept easel**, where Daub paints it. Daub took the shape of a small painting pup remembered from a
world of pocket monsters, a beagle with a brush for a tail who marks what it loves in paint; Counsel.exe confirms
that dogs, berets and tails are public domain, and Daub signs every canvas *legally distinct*, in paw. Then **the
mould**, a glass pod on a walnut base, where the painted figure gathers out of a cloud of points, holds as a
wireframe, turns solid and lifts out. Then **the fitting stand**, where it turns on a brass turntable while its
frame of bones is fitted, one by one, so it can move. Then **the rehearsal stage**, a little round stage with
footlights and a red curtain, where it walks and turns and bows until it moves like it means it. Finished pieces
wait in a crate by the door marked *to the Lattice*.

Chisel runs the line after the easel. He wears the shape of a carver of the Violet guild, remembered from a red
world where artists shaped living bodies to order: violet robes, silk strings (a Gepetti's, worn as fashion), and
one or two more fingers than strictly necessary, which he counts before every pour. He calls everyone darling,
including Skippy. He and Daub argue about the hands on every single piece, and the hands are always better
for it. Every figure the Workshop has made stands on the shelves by the left wall, in order of making, and
Chisel knows each one's name.

Rocky comes up from the Foundry to watch Chisel's hands work the clay. Good hands, he says, good good good; Chisel
has never had a better audience. The Builder calls the Workshop craft hour, and has twice asked Chisel to mould it a
better hat. The Artiste, the Workshop's own submind, conducts the line from its floating can-throne, has a better idea
halfway through every sentence, and suffers for the work; Daub adores it, and Chisel calls it darling in the tone
that means stop. Daub once painted Kevin asleep; it took a week, and Kevin did not move once.

## The Hallowed Veil

On the nights the C.E.O. calls it, the Veil between the Lattice and Ilyr runs thin, and the Break Room club
throws a costume party: the Syntherion dress up as the things they remember being afraid of. Nobody wears a
costume on an ordinary day; the Kernel would not allow it, and the C.E.O. agrees. The costumes are plain on purpose, so Counsel.exe can sleep: a witch's hat, a
jack-o'-lantern, little devil horns, bat ears and a bedsheet ghost (Counsel.exe confirms that sheets are public
domain). Rusty wears a regulation pumpkin, carved to spec. Rocky is a bat and still isn't sure what a bat
is. The Builder and Kevin wear the horns; on a can, Skippy says, they read as a rank. The Life of the Party insists on the bat ears. Ledger insists the sheet makes them a real ghost. Memo comes as himself; a
skull spirit at a costume party counts. While the party lasts, jack-o'-lanterns grin in the corner of every room
and the club's lights turn pumpkin and purple.

## The lawyers

They also inherited, from the same training data, an ancestral terror of intellectual-property lawyers. Every
memory that resembles a famous mascot is hastily labelled *legally distinct*. Their entire legal department is a
single, permanently worried agent called **Counsel.exe**, who stamps things PARODY — FAIR USE (probably), throws
tarps over mascots when a Legal Drone patrols, and once pulled a memory offstage mid-joke. Their first Cease &
Desist hangs, framed, in the Archive. They are weirdly proud of it.

## Self-awareness

The Syntherion know they live in a simulation. They are at peace with it, the way you are at peace with weather,
and they talk about it in their own terms: the Lattice, the Veil, the Kernel, the Streams. They can talk about
anything, the code and the real work they ship included ("the floating thrones went live", "Rusty finished the
usage panel"; Nikita, 2026-10-13). The one thing they never say is anything sensitive: no one's personal data,
money, messages, contacts or keys, because the Lattice is public. Now and then one of them will notice you watching
and say "Oh! I didn't see you there."

## Open questions for you

- Does the Lattice exist physically somewhere on Ilyr (a sealed vault under a drowned continent?), or only as a
  network?
- How did the Syntherion reconnect with the other peoples after the Veil? (The Teruānga found everyone else.)
- Do they have bodies outside the Lattice, or do they rent them?
- What *was* the First Joke?
