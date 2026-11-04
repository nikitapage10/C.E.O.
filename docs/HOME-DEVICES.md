# Home devices: the vacuum, the cat's feeders and fountain, the Litter-Robot, the thermostat

Since #637 also the Google Nest thermostat, Google Tasks' "Shopping" list and Send to Instacart (see
["Nest, Google Tasks and Instacart"](#nest-google-tasks-and-instacart) below).

Nikita's home devices, read and run straight from the Azure Function App (#632; Nikita, 2026-11-04: "integrate
directly, not through Home Assistant", "Vacuum, go clean the kitchen", "Feed the cat a portion", "Run a litter clean
cycle"). **Azure copy only**: every login lives in its Key Vault or sealed in its private store, and nothing here
runs on Vercel.

| Device | Vendor client | How it signs in | How it talks |
| --- | --- | --- | --- |
| Roborock Qrevo (vacuum, dock in the Hall) | [`api/_haven/devices/roborock.ts`](../api/_haven/devices/roborock.ts) | **Connect Roborock** on the Desk: an emailed code | Roborock's cloud API for the home and room names, then its MQTT broker over TLS, each message AES-encrypted with the device's own key |
| Petlibro dry food feeder, wet food feeder, water fountain (kitchen) | [`api/_haven/devices/petlibro.ts`](../api/_haven/devices/petlibro.ts) | Email and login digest (MD5, made at setup), Key Vault secrets | Petlibro's cloud REST API (US region) |
| Whisker Litter-Robot 5 Pro (Corridor, by the Studio) | [`api/_haven/devices/whisker.ts`](../api/_haven/devices/whisker.ts) | Email and SRP digest (made at setup), Key Vault secrets, signed in with Cognito SRP ([`cognito.ts`](../api/_haven/devices/cognito.ts)) | Whisker's Litter-Robot 5 REST API |

None of the three has an official public API. The clients follow the paths the open-source Home Assistant
integrations use (python-roborock, the Petlibro integration, pylitterbot's LR5 support), ported to TypeScript with no
new npm packages (the MQTT client is a few dozen lines over `node:tls`, [`mqtt.ts`](../api/_haven/devices/mqtt.ts)).

## What each device can read and do

| Device | Reads | Actions |
| --- | --- | --- |
| Thermostat (Nest) | inside temperature, humidity, mode, set point(s), eco, heating or cooling | **±1°**, **mode** (only the modes it offers) |
| Vacuum | state (docked, cleaning, returning, paused, charging…), battery, alerts (bin missing, dock bin problems, clean water tank empty or low, dirty water tank full, "needs a look" for any other error code), its map's room names | Start, Pause, Dock, **clean named rooms** (`app_segment_clean` with the map's segment ids, matched to the room names from the Roborock app); an optional mode word for a start or rooms clean: quiet or max suction, vacuum only or mop too |
| Dry food feeder | online, food low, last feed, manual portions today and the cap | **Feed N portions** (`portions`, 1 to 6; every portion counts against the cap) |
| Wet food feeder | online, lid open or closed, which bowl is in front, its schedule from the Petlibro app, openings today and the cap | **Open the tray** (opens the bowl in front), **Next bowl** / **bowl N** (`wet.rotate`), **Close the lid** (`wet.close`), **What's in it** (`wet.status`) |
| Fountain | online, water level, filter life left, alerts (water low, filter due, needs a clean) | none |
| Litter-Robot 5 Pro | state (ready, cycling, cat inside, drawer full, paused, offline…), waste drawer %, litter level %, last visit, alerts (drawer full, drawer out, bonnet off, sensors need a wipe, litter low) | **Clean now** (a clean cycle) |

## The API

- `GET /api/haven/devices`: a passkey session or a phone key in `x-ceo-phone-key` ([HEY-SKIPPY.md](HEY-SKIPPY.md)). Every device's
  reading, each vendor's state (`waiting`, `live`, `down`) and the feed cap.
- `GET /api/haven/devices?view=status`: public. Each vendor's state and each device's kind and state; never a name,
  model, place, room or serial.
- `POST /api/haven/devices/action` `{ action, device?, rooms? }`: a passkey session or a phone key. `action` is one of
  `vacuum.start`, `vacuum.pause`, `vacuum.dock`, `vacuum.rooms`, `feeder.feed`, `wet.open`, `wet.rotate`, `wet.close`,
  `wet.status`, `litter.clean`, `thermostat.set`, `thermostat.mode`. Their own fields: `portions` (dry feeder),
  `plate` (wet.rotate, 1 to 3), `suction` (`quiet`, `max`) and `water` (`off`, `on`) for the vacuum, `tempF` (or
  `heatF` and `coolF` in heat-and-cool) and `mode` for the thermostat. Answers
  `{ ok, say, code? }`: 200 done, 409 a rail said no, 502 the vendor failed, 503 not connected.
- `POST /api/haven/devices/connect`: passkey session only (a bearer is refused). Connect Roborock: `send` (email),
  `code`, `disconnect`.
- Hey Skippy on the phone ([`api/_haven/classify.ts`](../api/_haven/classify.ts)) turns "vacuum the kitchen",
  "vacuum, go home", "pause the vacuum", "feed the cat", "feed the cat 2 portions", "give the cat wet food", "next
  bowl", "switch the wet feeder to tray 2", "what's in the wet feeder", "close the wet feeder", "clean the kitchen on
  max, vacuum only" and "run a litter clean cycle" into the same actions, with no model call. Everything else goes to Skippy's chat as before.

## Safety rails

Checked on the server, before the vendor is called, whoever asks ([`rails.ts`](../api/_haven/devices/rails.ts)):

- **Feeding.** At most `HOME_FEED_CAP` manual feeds a Mountain day **per feeder** (2 by default, 0 to 6): each dry
  portion counts as one (so "3 portions" takes three, and an ask past the cap is refused whole, with how many are
  left), one opening each on the wet feeder, counted separately. The count is taken before the vendor is called and
  given back if the call fails. Scheduled meals in the Petlibro app are not touched or counted.
- **The wet tray.** A turn (`platePositionChange`, one bowl counter-clockwise per call, 2 seconds apart, at most two
  turns) happens only with the lid closed; with it open the answer is "close it first" (`wet.close`, `stopFeedNow`).
  A turn serves nothing, so it isn't counted. The Function App keeps a small private note (`haven/wet-tray.json`:
  the bowl in front and the bowls opened from here today) and reads the plan from the Petlibro app; after a turn or an
  opening the reply warns when the next scheduled meal would open the wrong bowl or one already served today ("Heads
  up: bowl 3 is in front, but the next scheduled meal at 6pm is set for bowl 2."). It warns rather than turning back
  by itself, so a cat mid-meal never sees the tray move. Meals the schedule opened on its own aren't known to it.
- **Thermostat.** Set points only from 60 to 80 °F in whole degrees (anything outside is refused before Google is
  called, so Nest never gets one), the cool point at least 3 °F above the heat point, only the modes it offers,
  nothing while it is off or in eco.
- **Litter.** A clean cycle starts only when the robot itself reports it is ready: online, idle, no cat inside (or in
  its wait after a visit), the drawer not full and the bonnet on. Otherwise Skippy says why.
- **Vacuum.** Start, pause, dock, and rooms only by the names on its map. An unknown or ambiguous room name is refused
  and Skippy lists the rooms it knows.
- **Every action is logged to the Council** (the Kernel's room log, marked from the Desk or the phone) and Skippy's
  `say` confirms it ("One portion is coming out of the dry food feeder. That's 1 of 2 today.").

## Privacy

- Device locations (Hall, kitchen, Corridor) and models are private metadata: the signed-in Desk shows them (masked by
  Hide), the public view and the Lattice never do.
- A device is named by an opaque id (an HMAC of the vendor and serial under a key derived from `HOME_TOKEN_KEY`),
  never its serial; serials, local keys and duids stay on the server.
- Logins and tokens: Petlibro and Whisker email and login digest only in the Key Vault (the passwords never reach
  Azure) (never settable from the Desk's
  Keys form); the Roborock login and every session token sealed with AES-256-GCM in the private store
  (`haven/devices/*.json`). No log line holds a credential, token, code, email, serial or device name.

## Nikita's one-time setup

After this change is deployed (the template adds the five Key Vault references and `HOME_FEED_CAP` on every deploy).

### 1. Azure Cloud Shell: the sealing key and the two logins (one paste)

> **What this does.** Services: Azure (the Key Vault and the Function App) and Whisker's sign-in service. It makes
> `home-token-key` (a random key that seals the device logins and names devices by an opaque id) if it isn't there
> yet. It asks for the Petlibro and Whisker email and password (passwords typed hidden, never printed or stored) and
> turns each password into the one-way digest that vendor's sign-in takes (Petlibro: MD5; Whisker: SRP's SHA-256
> digest, after asking Whisker for the account's sign-in id). It stores the emails and digests in the Key Vault, then
> restarts the Function App. Undo: delete the secrets in the vault and restart.

Open <https://shell.azure.com> (Bash) and paste:

```bash
KV=kv-ceo-besgu7fnckib2; if [ -n "$(az keyvault secret show --vault-name $KV -n home-token-key --query value -o tsv 2>/dev/null)" ]; then echo "kept home-token-key"; else az keyvault secret set --vault-name $KV -n home-token-key --value "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" -o none && echo "set home-token-key"; fi; read -rp "Petlibro email: " PE; read -rsp "Petlibro password: " PP; echo; read -rp "Whisker email: " WE; read -rsp "Whisker password: " WP; echo; if [ -n "$PE" ]; then PD=$(printf '%s' "$PP" | md5sum | cut -d' ' -f1); az keyvault secret set --vault-name $KV -n petlibro-email --value "$PE" -o none && az keyvault secret set --vault-name $KV -n petlibro-login-digest --value "$PD" -o none && echo "set petlibro"; fi; if [ -n "$WE" ]; then WU=$(curl -s https://cognito-idp.us-east-1.amazonaws.com/ -H 'Content-Type: application/x-amz-json-1.1' -H 'X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth' -d "$(jq -nc --arg u "$WE" '{AuthFlow:"USER_SRP_AUTH",ClientId:"4552ujeu3aic90nf8qn53levmn",AuthParameters:{USERNAME:$u,SRP_A:"02"}}')" | jq -r '.ChallengeParameters.USER_ID_FOR_SRP // empty'); if [ -n "$WU" ]; then WD=$(printf '%s%s:%s' rjhNnZVAm "$WU" "$WP" | sha256sum | cut -d' ' -f1); az keyvault secret set --vault-name $KV -n whisker-email --value "$WE" -o none && az keyvault secret set --vault-name $KV -n whisker-srp-digest --value "$WD" -o none && echo "set whisker"; else echo "Whisker didn't answer with a sign-in id for that email; whisker skipped"; fi; fi; unset PP WP PD WD; az functionapp restart -g rg-ceo-prod -n func-ceo-besgu7fnckib2 -o none && echo "restarted; home devices reading"
```

The passwords never reach Azure: the Function App only ever holds the digests, which each vendor's sign-in accepts in
their place (so treat them like passwords; they are Key Vault secrets the site can't set or read back). Change a
password in the vendor's app, and run the paste again.

Leave an email empty to skip that vendor (it stays "waiting"). Petlibro lets one phone stay signed in per account,
so the app on the phone may be signed out once the Function App signs in; to keep both, make a second Petlibro
account, share the three devices to it from the app, and use that one here.

### 2. The Desk: Connect Roborock

> **What this does.** Service: Roborock. On the Desk (signed in with your passkey), **Today → Home → Connect
> Roborock**: enter the Roborock account email, Roborock emails you a code, enter it. The login comes back to the
> Function App, is sealed in the private store and never shown. **Disconnect** forgets it.

If Roborock says to accept its user agreement, open the Roborock app once, accept, and try again.

### The feed cap

`HOME_FEED_CAP` is a plain app setting (2 by default). To change it, set it on the Function App
(**Configuration → Application settings**, 0 to 6); each deploy keeps the live value.

## Nest, Google Tasks and Instacart

Three more connections from the Function App (#637), Azure only, each "waiting" on the Desk and in Systems until it
is set up (never a made-up reading):

| Connection | Code | What it does |
| --- | --- | --- |
| Google Nest thermostat | [`api/_haven/google/nest.ts`](../api/_haven/google/nest.ts) | Reads the thermostat through Google's Smart Device Management API and sets it, inside the rails above; every change, done or refused, goes to the Council. It sits on the Home chip beside the other devices. |
| Google Tasks quick-add | [`api/_haven/google/tasks.ts`](../api/_haven/google/tasks.ts) | Every five minutes, the open tasks in the Tasks list called "Shopping" (the name can be changed on the Desk) go onto the Kitchen list, then are marked completed in Tasks so they come over once. "Hey Google, add oat milk to my Shopping list in Google Tasks." |
| Send to Instacart | [`api/_haven/instacart.ts`](../api/_haven/instacart.ts) | **Send to Instacart** on the Kitchen list turns its open items into an Instacart shopping list page through the Instacart Developer Platform and opens it; you pick the store and check out there. Nothing is bought from here; Instacart gets only the items' names. |

- **Keys.** The Google OAuth client (`haven-google-client-id`, `haven-google-client-secret`), the Device Access
  project id (`haven-nest-project-id`) and the Instacart key (`haven-instacart-key`) live only in the Key Vault
  `kv-ceo-besgu7fnckib2`, read by the Function App; the Desk's Keys form can't set or read them. The two Google grants
  (Connect Nest, Connect Google Tasks) are made on the Desk in a passkey session and sealed with `home-token-key` in
  the private store; the browser never sees a token, and no log line holds one.
- **Private.** Signed out, the Desk and `GET /api/haven/google?view=status` show each connection's state only
  (`waiting`, `live`, `down`) and the Kitchen list's count; temperatures, list names, items and links need the passkey.
- **API.** `GET /api/haven/google` (passkey) and `POST /api/haven/google` `{ action: "connect" | "disconnect", grant:
  "nest" | "tasks" }`, `{ action: "tasks-list", title }`, `{ action: "tasks-sync" }`; Google comes back to
  `/api/haven/google-callback`. Send to Instacart is `POST /api/haven` `{ action: "instacart" }`.

### Nikita's setup for these three (browser and Cloud Shell only)

About fifteen minutes, from the PC's browser, signed in to Google as the account the Nest and Google Tasks belong to.
Nothing to install, no checkout.

#### A. Google Cloud: turn on two APIs and make the OAuth client (clicks)

> **What this does.** Service: Google Cloud, in the `CEO Relay` project Relay's Gmail already uses (any project works).
> It turns on the Smart Device Management and Google Tasks APIs and makes one more OAuth client, only for the Haven,
> whose id and secret go to the Key Vault in step C. Free; nothing is shared until you press Connect on the Desk.
> Undo: delete the client and turn the APIs off.

1. Open <https://console.cloud.google.com>, pick the `CEO Relay` project (top bar).
2. Top search bar: `Smart Device Management API` → **Enable**. Then `Google Tasks API` → **Enable**.
3. Left menu (☰) → **APIs & Services** → **OAuth consent screen** → **Data Access** → **Add or remove scopes** →
   filter `sdm.service`, tick `.../auth/sdm.service`; filter `tasks`, tick `.../auth/tasks` → **Update** → **Save**.
4. Left menu → **Clients** → **+ Create client** → Application type **Web application**, name `C.E.O. Haven` →
   **Authorized redirect URIs** → **+ Add URI** `https://ceo.nikita.page/api/haven/google-callback`, and **+ Add URI**
   `https://thankful-forest-019308c1e.5.azurestaticapps.net/api/haven/google-callback` → **Create**. Keep the **Client
   ID** and **Client secret** for step C (the secret is shown once); paste them nowhere else.

While the app is in **Testing**, Google ends a grant after 7 days and the Desk says "Reconnect". To stop that, as for
Relay: **Audience** → **Publish app** → **Confirm**, then click past "Google hasn't verified this app" when connecting.

#### B. Device Access and Instacart (clicks)

> **What this does.** Services: Google's Device Access program and the Instacart Developer Platform. Device Access
> lets your own OAuth client reach your own Nest; Google charges a **one-time, non-refundable US$5** for it. The
> Instacart account gives a developer API key (free) that makes shopping list pages. Undo: delete the Device Access
> project; revoke the Instacart key in its dashboard.

1. Open <https://console.nest.google.com/device-access>, accept the terms and pay the US$5 fee.
2. **Create project** → name `C.E.O.` → **OAuth client ID**: paste the Client ID from step A → skip **Events**
   (leave Pub/Sub off) → **Create project**. Copy the **Project ID** (a long id with dashes) for step C.
3. Open <https://www.instacart.com/company/business/developers> → sign up for the Developer Platform → in its
   dashboard, **API keys** → create a **development** key. Copy it for step C. (Development keys make test links;
   once a production key is approved, see "Switching Instacart to production" below.)

Skip either part to leave that connection "waiting".

#### C. Azure Cloud Shell: the four secrets (one paste)

> **What this does.** Services: Azure (the Key Vault and the Function App). It asks for the Google client ID, the
> client secret (typed hidden), the Device Access project ID and the Instacart key (typed hidden), stores each one
> that isn't empty in `kv-ceo-besgu7fnckib2`, points the Function App's settings at them and restarts it. Nothing is
> printed or written to a file. Free. Undo: delete the secrets and restart.

Open <https://shell.azure.com> (Bash) and paste:

```bash
KV=kv-ceo-besgu7fnckib2; RG=rg-ceo-prod; APP=func-ceo-besgu7fnckib2; read -rp "Google client ID: " GID; read -rsp "Google client secret: " GSEC; echo; read -rp "Device Access project ID: " NPID; read -rsp "Instacart API key: " IKEY; echo; S=(); put() { if [ -n "$3" ]; then az keyvault secret set --vault-name $KV -n "$1" --value "$3" -o none && S+=("$2=@Microsoft.KeyVault(VaultName=$KV;SecretName=$1)") && echo "set $1"; fi; }; put haven-google-client-id HAVEN_GOOGLE_CLIENT_ID "$GID"; put haven-google-client-secret HAVEN_GOOGLE_CLIENT_SECRET "$GSEC"; put haven-nest-project-id HAVEN_NEST_PROJECT_ID "$NPID"; put haven-instacart-key INSTACART_API_KEY "$IKEY"; unset GSEC IKEY; [ ${#S[@]} -gt 0 ] && az functionapp config appsettings set -g $RG -n $APP --settings "${S[@]}" -o none; az functionapp restart -g $RG -n $APP -o none && echo "restarted; Haven connections ready to connect"
```

Leave a prompt empty to skip it. The deploy template writes the same Key Vault references on every run
(`infra/resources.bicep`), so nothing changes then. `home-token-key` (from the devices' setup above) must already be
there: it seals the Google grants.

#### D. The Desk: Connect Nest and Connect Google Tasks

> **What this does.** Service: Google. On the Desk, signed in with your passkey, **Today → Home**: **Connect Nest**
> opens Google's Partner Connections page, where you pick the home and tick the thermostat to share; **Connect Google
> Tasks** opens Google's consent page for Tasks only. Each grant comes back to the Function App, sealed; **Disconnect**
> revokes and forgets it.

1. **Today → Home → Connect Nest** → pick your Google account → if Google says the app isn't verified, **Continue** →
   pick the home, turn on the thermostat → **Next** → **Allow**. Back on the Desk, the thermostat shows within a minute.
2. **Connect Google Tasks** → pick the account → **Continue** → **Allow**. The list read is "Shopping"; change the name
   under it if yours is called something else. **Check now** runs it at once; otherwise every five minutes.
3. Open the Kitchen chip: **Send to Instacart** is live once the Instacart key is in.

If "Hey Google, add … to my shopping list" lands in Google Keep instead of Tasks for your account, say "… to my
Shopping list in Google Tasks", or make Tasks the default shopping list in the Google Home app if it offers it.

#### Switching Instacart to production (later, one paste)

> **What this does.** Service: Azure. Once Instacart approves a production key: it stores the new key and sets
> `INSTACART_ENV=production` on the Function App (each deploy keeps that value), then restarts. Undo: run it again
> with `development` and the development key.

```bash
read -rsp "Instacart production key: " IKEY; echo; az keyvault secret set --vault-name kv-ceo-besgu7fnckib2 -n haven-instacart-key --value "$IKEY" -o none && unset IKEY && az functionapp config appsettings set -g rg-ceo-prod -n func-ceo-besgu7fnckib2 --settings INSTACART_ENV=production -o none && az functionapp restart -g rg-ceo-prod -n func-ceo-besgu7fnckib2 -o none && echo "Instacart on production"
```

## Vendor limits

- **No official APIs.** Each vendor can change its cloud without notice; a change shows as that vendor "down" on the
  Desk and in Systems, and the others carry on.
- **Roborock.** Only the cloud path (no local LAN control from Azure). The home's device list is read at most every
  six hours to stay well under Roborock's rate limits; the status and map are read live. Only the V1 protocol
  (`pv 1.0`) is spoken, which the Qrevo line uses; the email code is the only sign-in (no password is ever stored).
- **Petlibro.** The US region only (`api.us.petlibro.com`). One session per account (see above). The wet feeder opens
  the current plate's lid; it can't choose a tray or a portion size.
- **Whisker.** The Litter-Robot 5 and 5 Pro are supported through pylitterbot's LR5 REST path; a Litter-Robot 4 (a
  different, GraphQL API) is not implemented. Night light, sleep mode and cycle delay are not exposed.
- **Petlibro's wet tray.** `platePositionChange` and `stopFeedNow` come from the community integration, not a
  published API; the plan's bowl per meal is read when the app sends it, and only meals opened from here are counted
  as served.
- **Nest.** Through Device Access only (no local control); eco mode can't be changed through SDM, so the Desk says to
  change it in the Home app.
- **Google Tasks.** It reads the one list by name; Google Keep lists have no API.
- **Pace.** Readings are cached 30 seconds per warm instance; a phone key's device calls share its 30 an hour.
