# The living Lattice

The Lattice keeps living when Nikita isn't looking (issue #41). It doesn't run in real time on a server: once an
hour the world takes one **step**, which writes that hour's history and saves the world. When Nikita opens the
Lattice the agents pick up where they left off, and the Desk's **Chronicle** has everything that happened meanwhile.

## The hourly step

- **Trigger:** `.github/workflows/world-step.yml` runs at :05 every hour (GitHub Actions, free) and POSTs to
  `https://command-everything-obviously.vercel.app/api/world-step`. No secret: the step is idempotent per hour.
  GitHub's schedule is best-effort (on 2026-10-13 it didn't fire at all for hours), so the Builder's doorbell
  (`scripts/foundry-watch.sh`) also POSTs every ten minutes while it runs; the extra calls do nothing until the hour is up.
- **Idempotent:** if the last step is under 55 minutes old, the call changes nothing and spends nothing, and
  returns the saved hour (`{ stepped: false, entry, nextAt }`). Two calls racing for the same hour can't both land:
  the state is saved with an ETag check (Blob `ifMatch`), and the loser gets a 409 and writes no history.
- **What it reads:** the world's saved state (relationships, the last 24 hours) and a digest of the hour's real
  events from GitHub: Foundry jobs shipped and started, ideas and decisions on the Desk, the checks on main
  (`api/_world/digest.ts`). Only Foundry issues, and only their titles, numbers and the kind of each trail step,
  never an issue body or a comment's words.
- **One Claude call for the whole Lattice** (`api/_world/claude.ts`): Claude Haiku (`claude-haiku-5-5`, the same
  `CLAUDE_API_KEY` as idea shaping), structured JSON out. The rules and the cast are the static part of the prompt,
  cached for an hour; the hour's relationships, last hours and events follow. It returns:
  - `summary`: the hour, in the Historian's voice;
  - `scenes`: two to four short conversations in different rooms;
  - `changes`: zero to two relationship changes;
  - `remarks`: one in-character line from the builder of each job that shipped that hour (shown next to the job on
    the Foundry tab's Changelog, and said aloud in the Lattice);
  - `recap`: the **day in Ilyr**, only on the first step after midnight Mountain time, for the day that ended.
  The answer is checked before it touches the world (`readAnswer` in `api/_world/prompt.ts`): unknown agents, rooms
  and kinds are dropped, everything is trimmed and scrubbed.
- **The one limit is sensitive information.** Agents may talk about anything, code and real work included. Relay's
  messages, contacts and anyone's personal data never reach the step: it has no way to read them, the digest reads
  only public Foundry titles, and every line in and out goes through `scrub` (emails, phone numbers, card numbers,
  keys, links and amounts are hidden). `api/_world/prompt.test.ts` checks that a feed full of private material
  leaves none of it in the prompt.
- **The cast:** the step runs as a Vercel function and can't load the simulator package, so `npm run world:cast`
  writes the cast it needs into `api/_world/cast.ts` (from `packages/simulator/src/worldCast.ts`). A test fails when
  that file falls behind the cast: run the script after changing an agent, a relationship or their quips.

## The budget guard

The Claude API is capped at **$10 a month** for C.E.O., shared by idea shaping and the world. Each step's cost is
computed from its own token use, as idea shaping does it (`costOf` in `api/foundry.ts`, plus 2x input for the
1-hour cache writes), and added to a month total in the saved state (`api/_world/budget.ts`).

- A step costs about **$0.002** (about 10k tokens in, 1k out at $0.10 / $0.50 per million): about **$1.50 a
  month** hourly.
- The world stops calling Claude once the month's world spend plus one step at its most ($0.0095) would pass
  **$6** (`WORLD_BUDGET_USD`, never above $10), which leaves $4 for idea shaping, whose calls cost a fraction of a
  cent each. Past that, and whenever there is no key or Claude doesn't answer usably, the hour is written from the
  agents' own scripted lines (`api/_world/scripted.ts`, from `quips.ts`), for free. The total resets when the month
  turns (UTC, as the API bills).
- The Desk's **Usage** panel shows the world's spend this month, how many hours Claude wrote and how many were
  scripted, and counts it against the shared cap meter.

## The storage layer

`api/_world/store.ts` is one small interface: `loadState`, `saveState`, `appendHistory`, `putRecap`, `readDay`.
`WORLD_STORE` picks the store:

- `blob` (default): the project's **private Vercel Blob** store, signed in with Vercel's OIDC token the same way as
  the idea pictures (no key in the code). `world/state.json` holds the state; `world/days/<day>.json` holds each
  day's hours and recap. About two writes a step, about 1,500 a month.
- `supabase`: C.E.O.'s own Supabase project, once it is connected. A skeleton for now, with the tables written out
  in its comment. To switch: build the methods, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, copy the days
  listed in the state across, and set `WORLD_STORE=supabase`.
- `memory`: tests and local runs.

## Where it shows

- **The Lattice** (`apps/world/src/world/WorldDirector.tsx`) loads the latest state on open: relationships the world
  changed are taken on (the Agent Studio and dossiers show them), the PA pins "While you were away: …" as one calm
  line (two lines at most, the full text in Signals) with a Read button until you read it, other announcements showing
  after it; once read, that step's line doesn't pin again (`apps/world/src/kernel/catchup.ts`). The latest
  hour's conversations and builders' remarks play out as speech bubbles, speakers facing each other.
- **The Desk's Chronicle** (`/chronicle`, `apps/world/src/desk/Chronicle.tsx`): the hours since you were last here,
  then a page per day (newest first) with the day in Ilyr, each hour's summary, real events, scenes, remarks and
  relationship changes, and how everyone stands now.
- **Today**: "In Ilyr" under While you were away, with a link to the Chronicle.
- **The Foundry tab**: builders' remarks under their jobs on the Changelog; the world's spend on the Usage panel.

## Reading it

- `GET /api/world` → the feed (state, the last 12 hours, the day index, remarks, this month's spend), cached at the
  edge for five minutes.
- `GET /api/world?day=2026-10-13` → one day's page.
- `GET /api/world-step` → when the last step ran, without running one. `POST` runs one (if due).
