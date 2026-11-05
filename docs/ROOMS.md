# Rooms and the engine

How the Desk's rooms are built (#617). One engine, `@ceo/engine` (`packages/engine`), holds the rules every room
follows: sign-in and the passkey lock, keys, Skippy and voice, the feed and the Council, privacy, security and
compliance, the sigil particle layer, lore, and how features get built. Each room lives in its own `rooms/<id>/`
folder and is free to work however it needs inside it. The room contract below writes the engine's rules down, and
tests and lint enforce it. The site keeps one address and one deploy.

The rooms are moving in over 14 steps (the plan is on #617). Step 1 added the engine's skeleton, a manifest for each of
the ten rooms, the contract test and the lint boundaries. Step 2 moved the shared
kits into the engine (below). Step 3 turned the backwards imports round: the shared kits no longer import rooms, and
the rooms plug into them instead (below, "Rooms plug in"); and the Desk's bar names and page loaders now come from
the rooms: each room's `rooms/<id>/nav.ts` holds its `name` and `page`, its `room.ts` takes them in, and the Desk's
shell loads only those small files (`desk/roomPages.ts`; the full manifests would add about 40 kB to the first load).
The bar's order stays route.ts `NAV_ORDER`. A room's sub-menu comes from its `nav.ts` too (`sections`, below), drawn by
the engine's `<RoomSections>`. Until a room's own step lands, its code stays where it is in
`apps/world/src/desk` and `api/`.

## What the engine holds

| Subpath | What | Moved from (step 2) |
| --- | --- | --- |
| `@ceo/engine/manifest` | `defineRoom()` and the manifest schema | |
| `@ceo/engine/lore` | The lore a room reaches (re-exports only) | |
| `@ceo/engine/testing` | Test helpers | |
| `@ceo/engine/voice` | The room voice's contract (#638): who a page's mic and hands-free reach (`roomMicOf`, `voiceTargetOf`) and a room's intent handler (`RoomIntent`, `RoomUtterance`, `RoomIntentReply`). Its UI (the dock, the bar's Hands-free) is in `desk/roomvoice/` until Skippy's chat moves in | |
| `@ceo/engine/tools` | The rooms' tools (#646): `RoomTool` (a name, a title, a description, a strict input schema and an effect: `read`, `write`, `send`, `spend` or `delete`), `needsConfirm`, `checkInput` and `ToolOutcome`. One registry for Desk Skippy's agent and the room voice | |
| `@ceo/engine/sigils/*` | The particle layer: `wvCanvas.ts` (the Desk's one shared loop and canvas helpers), `motion.tsx`, the flow kit's core (`field.ts`, `draw.ts`, `path.ts`, `rise.ts`, `motes.ts`, `tempo.ts`, `flow.css`) and the glyph engine (`sigils.ts`, `sigils.css`, #615) | `desk/wvCanvas.ts`, `desk/motion.tsx`, `desk/flow/`, `desk/relay/sigils.ts` |
| `@ceo/engine/web/*` | The sign-in shell: `signin.ts`, `SignIn.tsx`, `SitePassword.tsx`, the Hide veil (`hide.ts`, `Private.tsx`) and the device pings (`pings.ts`, `PingSwitch.tsx`) | the same names in `desk/` |
| `@ceo/engine/web/RoomParts.tsx`, `web/roomParts.css` | The pieces room pages share (step 5): `Waits` (what a room waits on), `KeeperLine` (the keeper's portrait, line and name, handed in by the room; `desk/rooms/parts.tsx` `Keeper` reads them from the room's banner, so the engine reaches no lore), and the shared rules for them and the room head (`rm-head`, `rm-h2`, `rm-guard`) | `desk/rooms/parts.tsx`, `desk/rooms/rooms.css` |
| `@ceo/engine/web/sections.ts`, `web/RoomSections.tsx` | A room's sub-menu: which section a path opens, the tab's title, and the links (see `sections` under "The manifest") | `rooms/boiler/web/SystemsNav.tsx` |
| `@ceo/engine/web/RoomLoader.tsx`, `web/roomReady.ts`, `sigils/roomSigils.ts` | The room loader (#752): see "The room loader" below | |

### The room loader

Every Desk page is covered from the moment it is opened until it is ready, so nothing pops in piece by piece: motes
gather into the room's own sigil (`roomSigils.ts`, drawn on the C.E.O. mark's 48 grid) in its accent colour, the
room's name sits between two gold hairlines, and then it fades. The Desk wraps each page in `<RoomLoader>` with
`<RoomMounted />` after it inside its Suspense, so the chunk is counted for free. A room holds the cover with one line:

```ts
useRoomReady(status !== "idle"); // ready once its first data is in
const ready = useRoomReady(false); // or by hand, e.g. a scene's first frame: ready()
```

A page that opens no gate is ready once its code has mounted, and one ready in the same commit is never covered at
all; a room opened before shows its sigil only on a longer wait; nothing is covered for more than 4 s (`CAP_MS`); with
reduced motion the sigil is a still and the cover just fades. The cover sits under the bar and Ask Skippy and takes no
clicks.

A room with a 3D scene holds the cover until that scene's first real frame (Today's gate is in `rotunda/Rotunda.tsx`,
not its flat stand-in), up to 7 s. Switching is kept warm (#759):

- **Prefetched:** in idle time after first paint, every page's chunk, then the scenes and the shared three.js chunk.
- **Kept:** Today and the Haven stay mounted after a visit, hidden, inert and paused (`desk/keptRooms.ts`, at most
  three rooms), so a return is instant and shows no cover. Pages without a scene still unmount.
- **Warmed:** on a desktop the Desk builds Today's chamber once off screen during idle (`rotunda/warm.ts`), so its
  model, textures and compiled programs are cached before the first visit.
- **First frame:** the chamber compiles its programs before its first frame (`compileAsync`).

Import a file by its subpath and name, e.g. `@ceo/engine/sigils/wvCanvas.ts`: the files carry their own CSS and fonts,
so there is no barrel that would pull them all in. Everything imports them from the engine; the old Desk paths that
re-exported them while the rooms moved are gone (step 14). `desk/flow/index.ts` (with `useFlow`) and
`desk/flow/useTempo.ts` stay in the Desk until the route moves into the engine, since the tempo reads the page's
route. The engine imports no Desk routes: the Desk hands its router to the pings with `setPingOpener` (in
`desk/pings.ts`, which the Desk imports the pings through for that reason).

### Rooms plug in

A shared kit never imports a room or reads its data (step 3). A room offers its part, and the Desk plugs it in once,
as it starts, in `desk/roomHooks.ts` (Desk.tsx imports it first). Anything a kit needs only sometimes loads lazily, so
plugging in adds nothing to the first load.

| Kit | What a room offers | Plugged in with |
| --- | --- | --- |
| Flow (`desk/flow`) | Its pulse, for the tempo of its page's lines (`useRoomPulse`, from the stores the Desk keeps) | `setPulseReader` (`desk/flow/pulse.ts`) |
| Skippy's page block (`desk/skippy/page.ts`) | Its lines for his quick take: the Green's start/sit calls (`rooms/green/skippy.ts`, leading every block) and the Exchange's odds (`rooms/exchange/skippy.ts`) | `addPageSource` (`desk/skippy/rooms.ts`) |
| Skippy's texting (#536) | The Relay's compose card and call tools (`rooms/relay/data/`) | `setTexting` (`desk/skippy/rooms.ts`) |

As a room moves into `rooms/<id>/`, its part moves with it (its `skippy.ts`) and is offered through its manifest.

## The contract

| Rule | What it means | Enforced by |
| --- | --- | --- |
| Sign-in and passkey | Rooms never read cookies or sessions. Every endpoint declares how a caller gets in (`public`, `site`, `passkey` or `token`) and is wrapped by the engine. | The contract test: every Azure endpoint belongs to exactly one room or the engine. Later: lint bans raw fetch in room web and data (use `roomFetch`). |
| Keys only through the engine | `readKey(name)` for names in the manifest's `keys`. Shared keys (Claude, ElevenLabs, the Desk key, the room keys) are the engine's. | Lint bans `process.env` in `rooms/*/api`. The contract test: every secret setting belongs to exactly one room or the engine. |
| Privacy and security | Typed text goes through `privacyCheck`. Public feeds use allowlisted readers. | Later: a no-free-strings test on public fixtures, and injection fixtures for every room with `usesClaude`. |
| Compliance | The manifest names its threat-model ids. The Compliance page reads the manifests (later). | The contract test: each id is in [THREAT-MODEL.md](THREAT-MODEL.md), a room with keys or endpoints has one, and every integration is named there. |
| Skippy and voice | The room exports `skippy.ts`. The engine never imports a room. | Lint: the engine imports no rooms, and no room imports another. |
| Feed and Council | Events go only through the engine's feed. The submind comes from the manifest. | The contract test: the submind is in `SUBMINDS`, leads this room, and is active exactly when the room is live (`LIVE_ROOMS`). |
| Particle layer | Canvas visuals use `@ceo/engine/sigils` and respect reduced motion. | Later: a lint warning on raw canvas in rooms, and visual QA. |
| Purpose | `purpose.goal`, `purpose.agents` (its real integrations) and `purpose.measure` (a real count from its feed). | The schema requires all three; the contract test checks a live room lists at least one integration, and a room with one is live. |
| Lore hook | Submind, agents, houses, a lore section and an optional pool of flavour lines, all reached through `@ceo/engine/lore`. Rooms never copy lore text. | The contract test: each agent has a dossier, a bio, a catchphrase, a relationship and 3+ quips; the section heading exists and is the room's own; the houses are real. Lint: room web reaches lore only through `@ceo/engine/lore`. |
| Lore stays subtle | See below. | Later: a `<LoreLine>` unit test; the screenshot review in each PR. |
| Manifest | `room.ts` passes the schema. | The contract test: unique ids, paths, nav keys, keys and endpoints; paths match `PATHS`, keys follow the Desk's key order, names match the bar, and the accent token exists. |
| Tests | Unit tests and one e2e smoke test per room. | Later: a vitest project per room, the boot-check opening every room, and a per-room JS budget (`budgetKb`) beside the Desk's 1 MB. |
| CSS | Every rule in a room sheet starts with `[data-room="<id>"]`. | Later: a scoping test. |
| Design | Form follows the room's function; the engine supplies particles plus shared chrome (see "Design" below). | Review: the screenshot review in each PR. Guidance, not a test. |

The contract test is `packages/engine/src/contract.test.ts`. Gaps that are real today are listed in its `KNOWN_GAPS`
and show as todos; a room's migration PR closes its own. When a gap starts passing, the test fails until it is taken
off the list, so the list only shrinks.

## Design

**Form follows the room's function; the engine supplies particles plus shared chrome** (Nikita, 2026-11-03, 23:12Z).
This replaces the older rule that every page comes back to Today's language.

- Design every new room or feature as its own app. Start from what it does, pick the form that serves it best (a
  dashboard, a map, an image, a 3D model, a tool, or something else), then design the look to match.
- Don't default to the house theme, and don't make rooms look alike.
- Only the engine layer is shared: the sigil and nanite particle threads; the shared chrome (the menu, sign-in and the
  lock, Skippy and Talk, the room voice, the feed and the Council); and a lean toward dark, which is a default, not a rule.
- The room voice (#638, `@ceo/engine/voice`): Ask Skippy is the large button at the bottom right of every page (his
  chat and Talk); every room page but Today gets a one-tap mic beside it to its submind, from its manifest's `submind`
  (`roomMicOf`; the contract test holds them together); and Hands-free (switched in the Boiler Room's Settings, shown in the bar while on) keeps listening page to page, each
  thing said going to the page's lead (`voiceTargetOf`: Skippy on Today). A room adds nothing for any of it; how it
  works is in [SKIPPY.md](SKIPPY.md), "The room voice".
- **A room's intent handler (optional).** A room that wants to act on what's said itself (Relay's replies, rules,
  dispositions and questions, say) adds `voice` to its manifest: a lazy loader of a module that exports `intent`, a
  `RoomIntent` from `@ceo/engine/voice`:

  ```ts
  // rooms/relay/room.ts
  voice: () => import("./voice.ts"), // exports `intent`
  // rooms/relay/voice.ts
  export const intent: RoomIntent = async ({ text, room, via, history }) =>
    /^mute\b/i.test(text) ? { say: "Muted.", actions: [{ label: "Undo", run: undo }] } : null;
  ```

  It sees each utterance first, in the browser, and returns `{ say, actions? }` (`say` is read aloud in Skippy's voice
  bent the submind's way, `actions` show as up to three buttons under it), or `null` to let the submind answer (the
  default: Desk Skippy's chat as the submind, `POST /api/skippy-room`). It does its work through its own room's
  endpoints, under their auth and caps, and loads only when the room is first spoken to. Relay is the first (#642):
  its handler hands the words to the Thread on screen (`rooms/relay/data/bridge.ts`), which reads them as a
  command or through the intent layer (one Haiku call, `api/_email/intent.ts`) and answers in the Messenger's voice.
  To run one of the rooms' tools a handler calls `tool(name, input)` from the utterance (the same registry and server
  checks as Desk Skippy's agent, `POST /api/skippy-act`); a tool that sends, spends or deletes comes back as
  `{ confirm }`, so offer a Yes action that calls `confirmTool(id, true)`.

Review enforces this, not a test.

## A room's shape

```
rooms/green/
  room.ts        the manifest (data only)
  api/           its endpoints (from api/_green)
  data/          headless stores; the Lattice may import these
  web/           GreenPage.tsx, lazy loaded; green.css, scoped
  skippy.ts      page context and look-ups for Skippy
  tests/         unit tests and an e2e smoke test
```

The Workshop and the Studio were the first in this shape (step 4): `web/Workshop.tsx` and `workshop.css`,
`web/Studio.tsx` and `studio.css`, each sheet holding only its own room's rules (moved out of `desk/rooms/rooms.css`
unchanged). The Spire followed (step 5): `web/Spire.tsx` and `spire.css`, its invoices section (`web/InvoicesSection.tsx`,
`invoices.css`) and its invoices store in `data/invoices.ts` (the Desk's Systems, pulses and Controls, and the
Lattice's Spire, read it through the old `desk/spire/invoices.ts`, which re-exports it until step 14). The Green
followed (step 6): `web/Green.tsx`, `web/stadium.ts` and `web/green.css` (its rules from `rooms.css` at the top, unchanged),
the league store and the analysis in `data/`, and its lines for Skippy in `skippy.ts` (the old `desk/green/league.ts`
and `desk/green/skippy.ts` re-export them). The Haven followed (step 7): its whole page, `web/HavenPage.tsx` with its
parts, sheets and tests (moved from `desk/haven` unchanged); the Boiler Room's house setup reads its grocery list through
the old `desk/haven/groceries.ts`, which re-exports it. The Exchange followed (step 8): `web/Exchange.tsx` with its
floor, boards and `exchange.css`, the odds and positions stores and their helpers in `data/` (the Lattice's boards and
the Desk's Systems read them through the old `desk/exchange/*.ts`, which re-export them), and its odds lines for Skippy
in `skippy.ts`. The Relay followed (step 9): the Thread and its queue, the email and texts sections and the compose card in
`web/`, with their sheets; the email and texts stores, the Thread's logic, the compose store and Skippy's call tools in
`data/`, with their tests (moved unchanged; the Desk's Today, Systems and pulses, the Boiler Room's controls and the
Lattice's Relay read them through the old `desk/email/*` and `desk/texts/*`, which re-export them). The Foundry followed (step 10): `web/FoundryPage.tsx` with the forge stage, its parts, `foundry.css` and its test, and the
forge and progress helpers with their tests in `data/` (moved unchanged; nothing else imported them, so no re-exports; the
Foundry's store, graph and crew runs stay in `apps/world/src` because the Desk, Today and Systems share them). The Archive
followed (step 11): `web/` holds the page, the Chronicle with its hours, tide and weave folios, Today in Ilyr's `DayStory`, the
ship weeks folio and `archive.css`; `data/` holds the thread maths with its test (moved unchanged; `desk/DayStory.tsx`
re-exports for Today, and `chronicle.css` stays in the Desk because the Desk's other pages share it). Today followed
(step 12): `web/` holds the page and its acts, docket (`TodayNow`), rail, weave and more folios, the icons and `today.css`;
`data/` holds the schedule maths with its test (moved unchanged; `desk/Today.tsx`, `TodayNow.tsx`, `TodayRail.tsx`,
`todayIcons.tsx` and `todaySchedule.ts` re-export for the Desk shell, the Rotunda, the Boiler Room's settings, the to-do
bits and the council). The Boiler Room followed (step 13): `web/` holds the Map, Controls, Security and Compliance pages
(`Systems*`, `ControlsPage`, `SecurityPage`, `CompliancePage`) with their panels, parts and stylesheets; `data/` holds the pipes, rack, pressure,
wind, schematic, connections, controls and pages logic, the security model, keys, checks and feed, and `evals.json`, with
their tests (moved unchanged apart from import paths and the two path constants that read `docs/` and write `evals.json`;
security, compliance and connections behave exactly as before; `desk/SystemsNav.tsx` re-exports for two Desk tests). The
Annex followed: `web/` holds the page, Election night (`ElectionNight.tsx`) and their sheets; `data/` holds the pop-up store
(`annex.ts`) and the election feed and model, with its test (moved unchanged apart from import paths; the Desk's council
pulses read the pop-up store from `rooms/annex/data/annex.ts` directly, so no re-export). Every room now lives in its folder.

Step 14 removed the one-line re-exports the moves left in `apps/world/src/desk` (the engine's old paths from step 2 and
the rooms' from steps 5 to 13): every importer, in the Desk, the Lattice, the rooms and the tests, now imports the file
where it lives, in `rooms/<id>/` or `@ceo/engine`. `desk/pings.ts` stays, since it hands the engine the Desk's router.
The stubs had hidden the reads one room makes of another (the Boiler Room's Map and Controls reading the other rooms'
stores, Today reading the Relay's email and the Archive's `DayStory`, the Exchange's asides reading the Green's league);
they are listed in `KNOWN_CROSSINGS` (below, "Lint") until each room plugs in through the Desk instead.

### The manifest

`defineRoom()` from `@ceo/engine/manifest` parses it on load:

| Field | What it is |
| --- | --- |
| `id`, `name`, `path`, `navKey` | The room's id, its label in the Desk's bar, its address, and the number key that opens it (1 to 9, then 0; a page past the tenth, like the Annex, has none). |
| `accent` | The colour token from `desk.css`, e.g. `--room-green`. |
| `submind`, `live` | Its lead (a `SUBMINDS` id, `skippy` for Today, or a `DESK_SUBMINDS` id for a Desk-only room such as the Annex, #618) and whether its agents are real work, not the demo. |
| `auth` | Each of its endpoints (an `azure/src/index.ts` name) and the ways in: `public`, `site`, `passkey`, `token`. |
| `keys`, `usesClaude` | The secret settings only it reads, and whether any endpoint calls Claude. |
| `threat` | Its THREAT-MODEL.md ids (`TB1`, `R5`). |
| `budgetKb` | Its lazy-loaded JS budget, in raw KB. |
| `name`, `page` (from `nav.ts`) | `page` is the lazy page loader, resolving to `{ default: Page }`; the Desk renders and prefetches it and hands it `{ data, now, connected, awaySince }`. Every room but Today has one (Today is in the first load). |
| `sections` (from `nav.ts`) | Optional: the room's sub-menu, `{ id, label, path, hint }[]` (`@ceo/engine/web/sections.ts`). The first is the room's front page at its own path, the rest at `<path>/<id>`, each linkable and reloadable (the contract test holds the addresses). The Desk names the tab from them (`Controls · Boiler Room · C.E.O.`) and the page draws them with `<RoomSections>` (`@ceo/engine/web/RoomSections.tsx`) in its own look. The Boiler Room is the first. |
| `purpose` | `goal` (one sentence, at most 200 characters), `agents` (its real integrations: `{ name, use }`, named as THREAT-MODEL.md names them) and `measure`. |
| `tools` | Optional (#646): the room's tools for Skippy, data only, from `rooms/<id>/tools.ts` (`RoomTool[]`, `@ceo/engine/tools`). Names are unique across rooms and each has a server executor in `api/_skippy/agent/tools.ts`; anything that sends, spends or deletes needs Nikita's tap (a contract test holds both). |
| `lore` | `submind`, `agents`, `house`, `section` (a heading in `lore/syntherion.md`) and `lines` (the flavour pool: a `ROOM_QUIPS` room, or `skippy`). |

### Purpose

Each room says, in one plain sentence, how it moves Nikita's AI and agent-integration goals (Nikita, 2026-11-03). The
goal is about the agents and what they do for Nikita, not about the room's look. `agents` lists only real services
the room's agents use today, so a room that isn't live lists none. `measure` names the count from its feed that shows
it working.

### Lore

A room's lore is a hook into the world's lore, never a copy of it. The text lives where CLAUDE.md's lore rule puts it
(`lore/syntherion.md`, the dossiers in `packages/simulator/src/lore.ts`, bios and relationships in `cast.ts`, lines
in `quips.ts`), and a room reaches it only through `@ceo/engine/lore`.

**Lore stays subtle.** Function comes first. A room page shows at most one flavour line, through the engine's
`<LoreLine>`, under the functional content: never above the fold on a phone, never in an empty room, and never with
room data in it.

## Lint

`scripts/eslint-rooms.mjs`, wired in `eslint.config.mjs`:

- **Errors** in `rooms/**` and `packages/engine/**`: no room imports another room; the engine imports no rooms (the
  contract test is the one exception, to load the manifests); room web code reaches lore only through
  `@ceo/engine/lore`; no `process.env` in `rooms/*/api`. The one allowance is `KNOWN_CROSSINGS`: the reads one room
  still makes of another, listed file by file (19 at step 14, in the Boiler Room, Today and the Exchange). The list
  only shrinks: `scripts/eslint-rooms.test.mjs` fails on an entry whose import is gone, and a new crossing is an error.
- **Errors** in `apps/world/src/desk/**`: a shared kit (flow, skippy, confluence, hologram, hero) importing a room.
  This was a warning while the rooms moved out (15 at step 1, 18 by step 3, 0 by step 13) and became an error at
  step 14, once every room had left the Desk.
