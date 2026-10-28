# @ceo/hub: Relay's texts hub on the MacBook (#535)

One Node file that runs under `launchd` on Nikita's always-on MacBook and gives Relay its texts line. The rules it
follows are in [`docs/RELAY-PRIVACY.md`](../../docs/RELAY-PRIVACY.md); this page is only the map.

- **In:** BlueBubbles Server's webhook, on `127.0.0.1:7420` only (`src/server.ts`), and BlueBubbles' local REST API
  for a chat's latest messages and the contacts (`src/bluebubbles.ts`). The hub never opens `chat.db`.
- **Settled on the Mac:** codes, short codes, promos, money and legal texts, and the private skip list
  (`src/rules.ts`), without a model.
- **Through the site:** placeholdered, trimmed snippets (`src/placeholders.ts`) go to `POST /api/relay-hub?view=sort`
  or `?view=draft`, where the site calls Claude with its own key (`api/_relay/models.ts`). The Mac holds no model key.
- **Out:** the public counts (`RelayStatus`) and the sealed who's-waiting list (names, gists, drafts), pushed to the
  site (`src/site.ts`). Never a message body.
- **Sends:** only `act` in `src/engine.ts`, only for a signed, single-use, 10-minute request Nikita made on the Desk.
- **State:** `relay.json` in `~/Library/Application Support/CEO Relay/` (`src/store.ts`); secrets in the login
  Keychain under "CEO Relay" (`src/keychain.ts`); logs of kinds and counts only (`src/log.ts`).

`npm run build -w @ceo/hub` bundles it into `apps/world/dist/relay/relay-hub.mjs` with its SHA-256 and the installer,
which the site serves at `/relay/`. On the Mac, one Terminal line installs it, asking only for the BlueBubbles password
and a pair code from the Desk:

    curl -fsSL https://ceo.nikita.page/relay/install.sh | bash

Then `relay status`, `relay off`, `relay on`, `relay wipe [--all]` and `relay wipe --verify`.

`src/index.ts` keeps the older, general hub interfaces (`EventSource`, `ActionExecutor`) from phase 2's plan.
