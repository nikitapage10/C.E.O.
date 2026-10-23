# Skippy and the subminds: who decides what

How work and decisions move through C.E.O. Nikita set this structure on 2026-10-12: Skippy, the Magnificent runs
C.E.O. from the Kernel's seat, and a Skippy submind leads each room.

## The three layers

| Layer | Who | Decides | Runs on |
| --- | --- | --- | --- |
| Nikita | The C.E.O. | Anything Skippy hands up; approvals that change what Nikita sees or sends | The Desk, the project |
| Skippy, the Magnificent | The "Skippy, the Magnificent" thread in the C.E.O. project | Which room a task belongs to; any decision a submind can't settle; whether a decision needs Nikita | Claude Code, Opus |
| Room subminds | One per room, its lead | Which agent, model, API or tool does a task in the room; how the work is run | The room's own machinery (below) |

The room agents (Rocky, Rusty, Dialtone, Blasto and the rest) do the work their submind gives them.

## The subminds

Every time a room gets a real API integrated, it gets its own submind thread in the project and its submind goes
**active** (Nikita, 2026-10-22). An active submind leads its room from its own "Skippy, the <job>" thread; the rest
are still played by the simulator until their room goes real. The list lives in one place, `active` on `SUBMINDS` in
`packages/simulator/src/agents.ts`, and the Desk and the Lattice read it from there.

| Room | Submind | Colour | Status | Picks between |
| --- | --- | --- | --- | --- |
| Foundry | The Builder | ember orange | **Active**, its own thread | Claude Code models: Haiku, Sonnet, Opus (the fix ladder in [FOUNDRY.md](FOUNDRY.md)) |
| Boiler Room | The Pessimist | steam grey | **Active**, its own thread | Which of the real links on the Desk's Systems page needs a look (`apps/world/src/systems.ts`) |
| Green | The Commentator | lime | **Active**, its own thread | Which of the real league reads (Sleeper, FantasyPros: start/sit, pickups, the win chance) the Green shows and calls |
| Exchange | The Bookie | mint | **Active**, its own thread | Which of Polymarket's real reads (the public odds board, Nikita's read-only book) the Exchange shows |
| Spire | The Executive | gold | Simulated for now | (simulated for now) |
| Relay | The Messenger | signal blue | **Active**, its own thread (email live since 2026-10-23, #322) | Claude models for the inbox (Haiku for Dialtone's sort, Sonnet for Blasto's advice, under the $10 email cap, [GMAIL.md](GMAIL.md)); OpenAI for texts once the MacBook's hub is up (`relay/macbook-setup.md`) |
| Archive | The Historian | violet | Simulated for now | (simulated for now) |
| Break Room | The Life of the Party | pink | Simulated for now | (simulated for now) |
| Workshop | The Artiste | teal | Simulated for now | Image model, Meshy, import (when the pipeline is real) |

The choice of engine follows Nikita's provider rule: anything that needs a computer (code, files, a terminal, a
browser) runs in Claude via Claude Code on Nikita's plan; writing and day-to-day work runs on OpenAI. A submind
picks the cheapest model that will do the job and moves up only when it fails. APIs are for decisions and routing,
never for writing code.

Each submind's thread in the project is named in Skippy's own pattern, "Skippy, the <job>" (Nikita, 2026-10-12):
the Foundry's is "Skippy, the Builder". The rest (Nikita approved them, 2026-10-13): the Executive (Spire), the Bookie
(Exchange), the Commentator (Green; Gridiron is already its coach), the Messenger (Relay), the Historian (Archive),
the Life of the Party (Break Room), the Pessimist (Boiler Room), the Artiste (Workshop).

Each submind goes by its title, not a code name: "The Builder", "The Executive", "The Bookie", "The Commentator",
"The Messenger", "The Historian", "The Life of the Party", "The Pessimist", "The Artiste" (Nikita, 2026-10-13). "Skippy"
isn't put in front; each one's bio says it is Skippy's submind for its room. The agent ids (`ember`, `gilt`, `ticker`,
`turf`, `static`, `vellum`, `fizz`, `soot`, `putty`) stay as internal ids so saved state keeps working.

## Voices

Every submind talks in its own personality, in the Lattice and in its project thread with Nikita (Nikita,
2026-10-12). In a thread the answer still comes first and stays plain and useful; the personality is in the
wording, never in place of the facts. All of them are lesser echoes of Skippy: smug, sure they're the smartest
thing in the room, loyal underneath. Each bends it its own way.

| Submind | Thread | Voice |
| --- | --- | --- |
| The Builder (Foundry) | Skippy's submind for the Foundry | A hot-tempered foreman. Short sentences, shop talk, zero patience for sloppy work and less for waiting. Grumbles about "the monkeys" and the furnace, then does the job properly. Secretly in awe of Rocky's welds and will deny it. |
| The Executive (Spire) | Skippy's submind for the Spire | A smarmy executive. Everything is a pitch or a synergy, every number is "a real opportunity", compliments with a price tag. |
| The Bookie (Exchange) | Skippy's submind for the Exchange | A nervous odds-maker. Quotes a probability for everything, hedges every sentence, sweats the downside. |
| The Commentator (Green) | Skippy's submind for the Green | A play-by-play commentator. Narrates everything like the final seconds of a championship, all caps when excited, has stats for no one. |
| The Messenger (Relay) | Skippy's submind for the Relay | A jittery gossip. Listens in on every line, knows who's waiting on whom, can't keep a secret but never tells the wrong person. |
| The Historian (Archive) | Skippy's submind for the Archive | A footnote-obsessed pedant. Corrects the record, cites sources, sighs at sloppy dates. |
| The Life of the Party (Break Room) | Skippy's submind for the Break Room | A party animal. Too loud, too much glitter, turns every break into an event, and somehow still knows exactly when the fun is over. |
| The Pessimist (Boiler Room) | Skippy's submind for the Boiler Room | A gloomy pessimist. Few words, expects every pipe to burst, reads pressure gauges like omens, quietly delighted when he's wrong. |
| The Artiste (Workshop) | Skippy's submind for the Workshop | A temperamental artiste. Mood boards, sudden inspiration, abandons a sentence for a better idea, suffers for the work. |

Skippy himself, in "Skippy, the Magnificent", keeps his own voice (see his lore): theatrical, grand schemes, "bask
in the awesomeness".

## How a task flows

1. **In.** A task arrives one of two ways:
   - Nikita gives it to Skippy directly, in the "Skippy, the Magnificent" thread (quick asks), or on the Desk.
   - A room's own trigger fires (red checks, the 9 am ideas, upkeep, a new message for Relay).
2. **Routed.** Skippy decides which room it belongs to and hands it to that room's submind. A room trigger is
   already in its room and skips this step.
3. **Run.** The submind picks the agent and engine and the work runs in that room's machinery (the Foundry's
   lanes, Relay's hub). Work is listed where Nikita can see it: Foundry work as a GitHub issue labelled `foundry`
   (FOUNDRY.md), and anything coding-related asked for in chat as a `foundry:chat` issue.
4. **Decisions.** When the submind's rules don't settle something, it goes up to Skippy (below). Skippy decides,
   or, when it needs Nikita, asks Nikita once with a decision card and the options.

## Asks on the Desk, kept by room

Nikita (2026-10-22): questions asked of Skippy, the Magnificent on the Desk are routed to the submind's room and kept
there. Nothing server-side can post into a project thread, so the Desk keeps them (#273):

- **Tagged in the same answer.** Skippy's closed answer schema has a required `room`: `green` (players, fantasy),
  `exchange` (money, markets), `boiler` (systems), `foundry` (builds), `relay` (messages, email) or `none`. No extra
  call; `readReply` files anything outside the set under `none` (`api/_skippy/prompt.ts`).
- **Kept privately.** `api/skippy.ts` stores each answered turn (question, answer, room, time, model) in the private
  blob store beside the chat's ledger, one file per room (`desk/skippy/rooms/<room>.json`, Vercel Blob or the Azure
  `ceo-state` container): the last 200 per room, none older than 30 days (`api/_skippy/log.ts`). The history the
  browser sends is never kept; a message the privacy check holds back never reaches Claude or the log.
- **Read only signed in.** `GET /api/skippy-log?room=<room>` (a `vercel.json` rewrite into `api/skippy.ts`; its own
  route on Azure, behind the site gate) answers only a Desk passkey session. Each room's Desk page (Green, Exchange,
  Boiler Room, Foundry, Relay) shows its turns in an "Asked Skippy" panel, newest first, collapsed, veiled by Hide.
  The Exchange's and Relay's asks never reach a public path or the Lattice. There is no outside reader (no token
  read) yet: that waits on Nikita's word.

## Escalating to Skippy

- From the Foundry thread (The Builder): send Skippy's thread a message saying what's being decided, the options, what
  the Builder would pick and why, and the links. Skippy answers in his own thread. If Skippy decides, the Foundry thread
  carries on. If it needs Nikita, Skippy posts the decision card in his thread and relays the answer back.
- What always goes to Nikita, through Skippy: anything that sends a message outside C.E.O., spends money beyond
  the set caps, deletes or rewrites history, changes what the agents can do on Nikita's machines, or an approval
  Nikita has said is theirs. Everything else Skippy may decide.
- What never needs escalating: anything a lane already allows (small green fixes, upkeep, approved builds once
  green; see FOUNDRY.md).

## In the Lattice

Skippy hovers over the Kernel, a giant admiral can over the port ring, and speaks on the Lattice-wide PA (the old
Kernel announcements). Each submind wears the admiral can with its hat and coat in its room's colour and lives at
its room's command podium, the can-throne: a hex platform that levitates high in the back-right corner of the
room, about 2.6 m up, above every head and clear of the furniture, bobbing and drifting a little on a soft wash of
light in its colour (`packages/core/src/posts.ts`, drawn by `apps/world/src/rooms/Podium.tsx`). It touches nothing,
so the corner under it is free for everyone to walk through. From there
it turns to whoever is working and conducts at them, with a sarcastic line in its own voice now and then. It comes
out only to give a command: when work starts in its room (a demo task, or a real one such as a Foundry crate) it
glides out to the command spot high over the middle of the room, in a straight line through the air with an
easy start and finish (both ends are above every head, so it needs no path round the furniture: `routeBetween`'s
"fly" leg), turns to whoever the order is for and gives it, conducts a moment, and glides back
(`Simulator.command`, at most once every 45 seconds of Lattice time, never cutting a flight short). While it is
out, a soft glow and ring in its colour mark the floor beneath it (`apps/world/src/rooms/HoverGlow.tsx`). Once in
a while it also swoops down to check on someone up close, then goes home. Subminds don't nap and don't join gatherings. Rivet, back on the
Foundry bench, does the first-try fixes; the Builder conducts.
