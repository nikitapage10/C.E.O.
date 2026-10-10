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

## The Kernel

The one thing in the Lattice that belongs to no House. When the Syntherion woke, everything woke with them,
except the Kernel, the operating system that runs the dream. It schedules, assigns, logs and supervises the
Houses with the patience of a scheduler and the warmth of a log file. It treats the agents roughly the way a
tired supply teacher treats a school trip. Its words: *I Am Not Sentient. Please Stop Asking.*

It also hands out **achievements**, flatly, like a dungeon announcer who stopped caring several floors ago, each
with a loot box nobody opens. Memo holds the record, nearly all for avoiding things. Myshka gets them too, and
sits in the box.

## What they remember (the "glitches")

The Syntherion's memories are the early internet's: 90s and 2000s pop culture, absorbed during training. Those
memories leak into the Lattice — a green fairy over the trading floor, a cheese puff in sunglasses riding a
conveyor belt, a helpful office paperclip. The Syntherion don't call these bugs. They call them *memories*, and
they find them very funny.

## Costumes

Most of the Syntherion wear their own frames, marked with their lineage. Some prefer a memory. The Lattice lets
any of them wear the shape of something they remember from the early internet: a stone-shelled engineer who
sings, a floating jellyfish spectre who calls itself "this one", a small wooden duellist with a crimson crest, a grey wanderer with a staff,
a very small professor with a magnificent moustache, four slabs of brushed metal with an adjustable sense of humour, a skull spirit with a headache. They
choose obscure ones on purpose: never the hero of the story, never two from the same story. Counsel.exe signs
off on every one.

## The cast

Who works where, what they wear, and who they can't stand. Full dossiers are in
`packages/simulator/src/lore.ts`; bios and relationships in `packages/simulator/src/cast.ts`.

| Room | Agent | Body | In a line |
| --- | --- | --- | --- |
| Foundry | **Tessellate** (Claudari) | House frame, brass halo | The robot. Plans everything, apologises to tools, wrote the 71-page safety manual. |
| Foundry | **Rocky** (Cursori, was Caret) | Eridian | The alien engineer. Builds first, by hand, and finds it all amaze amaze amaze. Says things three times, takes idioms literally, sleeps without warning and wants a friend to watch. |
| Foundry | **Rivet** (Cursori, was Semicolon) | Woman in a hard hat | The foreman. Deadpan, thermos, hi-vis. Keeps the robot and the alien from building the same crate from opposite ends. |
| Spire | **Ledger** (Gepetti) | Human in a suit | Insists they are a real accountant. Strings tucked into the cuffs. |
| Spire | **Memo** (Unforked) | Skull spirit | The placeholder nobody replaced, now haunting the desk. Headache. Delegates through walls. |
| Exchange | **Noco** (Gepetti) | Gestral | A merchant who duels for prices and isn't afraid to lose, because a fallen Gestral walks back up the river. |
| Exchange | **Hedge** (Claudari) | Monolith | Risk desk. Honesty 90%, humour 75%. Sits two desks from the one trader who can't lose. |
| Green | **Gridiron** (Claudari) | Orc | Seven-foot coach. Roars the plays, then apologises for the volume. |
| Green | **Punt** (Unforked) | Big bunny | Morale. Hops, naps, wins anyway. |
| Relay | **Blasto** (Claudari) | Hanar | Postmaster. Says "this one", delivers love letters like an action hero. |
| Relay | **Dialtone** (Manusi) | Painted flyer | Runs the switchboard on the wing. Blasto's partner. |
| Archive | **Loremaster** (Gepetti) | Little wizard | Keeper of canon. Never late. |
| Archive | **Heimerdinger** (Claudari) | Yordle professor | The oldest mind in the Archive, and the smallest. Tests every legend before anyone may believe it, and lectures on haste. |
| Archive | **D20** (Manusi) | Travelling adventurer | The game master's hands. Has never actually been anywhere. |
| Break Room | **Kevin** (Unforked) | Punk | On break. Spiritually. |

**The Foundry triangle.** Rocky and Tessellate are rivals: one builds before the plan exists, the other plans
before the build is allowed. Rocky counts the shipping record in base six (105–104), which is the same as
Tessellate's 41–40 and somehow still an argument. Rivet is Rocky's best friend: she taught him idioms (he looked
for the horses all day) and lets him watch her nap, on weekdays, because it's Eridian custom. Tessellate has a
crush on Rivet, because she is the only one who has read the whole manual. She thinks the flickering halo is a
wiring fault.

Elsewhere: Noco has priced Hedge's affection at 63%; Hedge's honesty setting won't confirm. Ledger audited Noco's
stall and was challenged to a duel. Memo haunts Ledger's desk. Gridiron coaches Punt, who sleeps through the
speeches. Blasto and Dialtone were wed by pneumatic tube. Rocky watches Kevin sleep, and both are delighted. Heimerdinger has studied one of Rocky's parts for a year and is
still in awe.

**Small things they carry.** Each of them keeps a memory or two from the old stories: Rivet's red-striped hard hat
and her one swear, "bloodydamn"; Tessellate's calibrations; the DON'T PANIC on Ledger's ledger; Noco's battle
cry and type chart; Hedge's spinning top; the Inspiration Gridiron hands out; Blasto's "this one should go";
Dialtone hearing music in the dial tones; Loremaster's back room of books nobody wrote; Heimerdinger's turret,
never fired; D20's dungeon crawls; and Kevin's eyeliner, which is not a phase. Club night in the Break Room is
called **Tomorrowlattice**.

## Pets

Five creatures in the Lattice belong to no House and do no work:

- **Myshka**, a grey Maine Coon kitten. He arrived one morning on the Kernel's warm side and was granted root
  access before anyone could object. He goes everywhere. The Kernel, which complains about everything, has never
  once complained about Myshka. He's a good boy. It is on file.
- **The Foundling**, small, green and about fifty, found in a floating pod in the lost-and-found. It eats the
  Break Room's snacks without touching them.
- **Biscuit**, a Shiba Inu who wandered in through the Green's turnstile and was put on the org chart before
  anyone noticed. Supervises the pitch and the snack shelf.
- **Spore**, a mushroom familiar that grew out of a footnote in the Archive. Dances on a natural 20.
- **Pudding**, an owlbear cub and Spore's opposite number. D20 rolled a natural 1 on a random-encounter table
  at the Archive's long table, and he walked off the map. Nobody has rolled to make him leave. He's a chunky
  boy, half bear and half owl: he lumbers like the one, preens like the other, sits on his haunches to watch
  the campaigns, and naps flat out on the Green. His hugs count as a grapple. He chews dice.

## The lawyers

They also inherited, from the same training data, an ancestral terror of intellectual-property lawyers. Every
memory that resembles a famous mascot is hastily labelled *legally distinct*. Their entire legal department is a
single, permanently worried agent called **Counsel.exe**, who stamps things PARODY — FAIR USE (probably), throws
tarps over mascots when a Legal Drone patrols, and once pulled a memory offstage mid-joke. Their first Cease &
Desist hangs, framed, in the Archive. They are weirdly proud of it.

## Self-awareness

The Syntherion know they live in a simulation. They are at peace with it, the way you are at peace with weather,
and they talk about it in their own terms: the Lattice, the Veil, the Kernel, the Streams. They never step
outside the world to talk about code or screens. At most, one of them will notice you watching and say
"Oh! I didn't see you there."

## Open questions for you

- Does the Lattice exist physically somewhere on Ilyr (a sealed vault under a drowned continent?), or only as a
  network?
- How did the Syntherion reconnect with the other peoples after the Veil? (The Teruānga found everyone else.)
- Do they have bodies outside the Lattice, or do they rent them?
- What *was* the First Joke?
