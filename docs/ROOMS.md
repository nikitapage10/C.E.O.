# Rooms and the engine

How the Desk's rooms are built (#617). One engine, `@ceo/engine` (`packages/engine`), holds the rules every room
follows: sign-in and the passkey lock, keys, Skippy and voice, the feed and the Council, privacy, security and
compliance, the sigil particle layer, lore, and how features get built. Each room lives in its own `rooms/<id>/`
folder and is free to work however it needs inside it. The room contract below writes the engine's rules down, and
tests and lint enforce it. The site keeps one address and one deploy.

The rooms are moving in over 14 steps (the plan is on #617). Step 1 added the engine's skeleton, a manifest for each of
the ten rooms, the contract test and the lint boundaries; nothing imports the manifests yet. Until a room's own step
lands, its code stays where it is in `apps/world/src/desk` and `api/`.

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

The contract test is `packages/engine/src/contract.test.ts`. Gaps that are real today are listed in its `KNOWN_GAPS`
and show as todos; a room's migration PR closes its own. When a gap starts passing, the test fails until it is taken
off the list, so the list only shrinks.

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

At step 1 each room has only its `room.ts`.

### The manifest

`defineRoom()` from `@ceo/engine/manifest` parses it on load:

| Field | What it is |
| --- | --- |
| `id`, `name`, `path`, `navKey` | The room's id, its label in the Desk's bar, its address, and the number key that opens it (1 to 9, then 0). |
| `accent` | The colour token from `desk.css`, e.g. `--room-green`. |
| `submind`, `live` | Its lead (a `SUBMINDS` id, or `skippy` for Today) and whether its agents are real work, not the demo. |
| `auth` | Each of its endpoints (an `azure/src/index.ts` name) and the ways in: `public`, `site`, `passkey`, `token`. |
| `keys`, `usesClaude` | The secret settings only it reads, and whether any endpoint calls Claude. |
| `threat` | Its THREAT-MODEL.md ids (`TB1`, `R5`). |
| `budgetKb` | Its lazy-loaded JS budget, in raw KB. |
| `page` | Optional: the lazy page loader. |
| `purpose` | `goal` (one sentence, at most 200 characters), `agents` (its real integrations: `{ name, use }`, named as THREAT-MODEL.md names them) and `measure`. |
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
  `@ceo/engine/lore`; no `process.env` in `rooms/*/api`.
- **Warnings** in `apps/world/src/desk/**`: a room's folder importing another room's, or a shared kit (flow, skippy,
  confluence, hologram, hero) importing a room. The baseline at step 1 is 15 warnings; they go as the rooms move, and
  become errors at step 14.
