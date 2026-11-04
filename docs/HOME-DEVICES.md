# Home devices: the vacuum, the cat's feeders and fountain, the Litter-Robot, the thermostat

Since #637 also the Google Nest thermostat and Google Tasks' "Shopping" list, and since #664 Send to King Soopers (see
["Nest, Google Tasks and King Soopers"](#nest-google-tasks-and-king-soopers) below).

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
| Dry food feeder | online, food low, last feed, manual portions today and the cap; today's amount (in the app's unit; a portion is 1/12 cup) and feedings, and today's schedule (time, portions, on or off, served / skipped / next) (#685) | **Feed N portions** (`portions`, 1 to 6; every portion counts against the cap) |
| Wet food feeder | online, lid open or closed, which bowl is in front, its schedule from the Petlibro app (each bowl's window, completed / feeding now / next by the clock), openings today and the cap; today's eating visits and eating time when the feeder reports them (#685) | **Open the tray** (opens the bowl in front), **Next bowl** / **bowl N** (`wet.rotate`), **Close the lid** (`wet.close`), **What's in it** (`wet.status`) |
| Fountain | online, water level, filter life left, alerts (water low, filter due, needs a clean); today's intake (mL, shown in oz), visits and average visit, and the days until the filter change and the clean (overdue in ember) (#685) | none |
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

**When Petlibro or Whisker reads "down"** (#672), Boiler Room > Controls says why, signed in only (the public pages
keep the state alone), in fixed words, never the vendor's own answer:
- *no such account*: Petlibro answered 1101 (`MEMBER_NOT_EXIST`) for the email in the Key Vault. An account made with
  Apple or Google sign-in (or behind an Apple relay address) has no email and password to match: give it a password
  in the app, or use a second account, and run the paste again.
- *sign-in refused*: any other refusal of the digest (the password changed, or it is over Petlibro's 18 characters).
  Run the paste again. A refused sign-in is held off for 15 minutes, so a wrong digest never hammers the login.
- *signed out*: a fresh sign-in was taken back at once and no newer token is stored, so something outside C.E.O.
  holds the account's one session (the phone app, or another integration such as Home Assistant on the same
  account). Use a second account shared to the feeders, as above. A lapsed token (1009) on its own is not a fault:
  the client first takes a newer token another Function App instance stored, then signs in again. Only one instance
  signs in at a time (#683): it takes a 20-second lease in the private store (`haven/devices/petlibro.lease.json`,
  a time only), and the others wait for the token it stores instead of signing in over it, since every sign-in
  cancels the tokens before it.
- *no answer*: the vendor's cloud didn't answer; it tries again on the next read.

### 2. The Desk: Connect Roborock

> **What this does.** Service: Roborock. On the Desk (signed in with your passkey), **Today → Home → Connect
> Roborock**: enter the Roborock account email, Roborock emails you a code, enter it. The login comes back to the
> Function App, is sealed in the private store and never shown. **Disconnect** forgets it.

If Roborock says to accept its user agreement, open the Roborock app once, accept, and try again.

### The feed cap

`HOME_FEED_CAP` is a plain app setting (2 by default). To change it, set it on the Function App
(**Configuration → Application settings**, 0 to 6); each deploy keeps the live value.

## Nest, Google Tasks and King Soopers

Three more connections from the Function App (#637, #664), Azure only, each "waiting" on the Desk and in Systems until it
is set up (never a made-up reading):

| Connection | Code | What it does |
| --- | --- | --- |
| Google Nest thermostat | [`api/_haven/google/nest.ts`](../api/_haven/google/nest.ts) | Reads the thermostat through Google's Smart Device Management API and sets it, inside the rails above; every change, done or refused, goes to the Council. It sits on the Home chip beside the other devices. |
| Google Tasks quick-add | [`api/_haven/google/tasks.ts`](../api/_haven/google/tasks.ts) | Every five minutes, the open tasks in the Tasks list called "Shopping" (the name can be changed on the Desk) go onto the Kitchen list, then are marked completed in Tasks so they come over once. "Hey Google, add oat milk to my Shopping list in Google Tasks." |
| Send to King Soopers | [`api/_haven/kroger/`](../api/_haven/kroger/) | On the Haven's Kitchen page, each open list item is matched to a product at your home King Soopers through Kroger's public API (price and stock), you swap any pick, and **Send to King Soopers** adds the shown picks to your King Soopers cart and opens it. You check out (pickup or delivery) in the King Soopers app: nothing is bought from here. See ["King Soopers"](#king-soopers) below. |

- **Keys.** The Google OAuth client (`haven-google-client-id`, `haven-google-client-secret`), the Device Access
  project id (`haven-nest-project-id`) and the Kroger app (`kroger-client-id`, `kroger-client-secret`) live only in the Key Vault
  `kv-ceo-besgu7fnckib2`, read by the Function App; the Desk's Keys form can't set or read them. The two Google grants
  (Connect Nest, Connect Google Tasks) and the King Soopers cart grant are made on the Desk in a passkey session and sealed with `home-token-key` in
  the private store; the browser never sees a token, and no log line holds one.
- **Private.** Signed out, the Desk, `GET /api/haven/google?view=status` and `GET /api/haven/kroger?view=status` show
  each connection's state only (`waiting`, `live`, `down`) and counts; temperatures, list names, the ZIP, the store,
  items, prices and links need the passkey.
- **API.** `GET /api/haven/google` (passkey) and `POST /api/haven/google` `{ action: "connect" | "disconnect", grant:
  "nest" | "tasks" }`, `{ action: "tasks-list", title }`, `{ action: "tasks-sync" }`; Google comes back to
  `/api/haven/google-callback`. King Soopers is `GET`/`POST /api/haven/kroger` (actions in
  [`api/_haven/kroger/route.ts`](../api/_haven/kroger/route.ts)); Kroger comes back to `/api/haven/kroger-callback`.

### Nikita's setup for Nest and Google Tasks (browser and Cloud Shell only)

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

#### B. Device Access (clicks)

> **What this does.** Service: Google's Device Access program. It lets your own OAuth client reach your own Nest;
> Google charges a **one-time, non-refundable US$5** for it. Undo: delete the Device Access project.

1. Open <https://console.nest.google.com/device-access>, accept the terms and pay the US$5 fee.
2. **Create project** → name `C.E.O.` → **OAuth client ID**: paste the Client ID from step A → skip **Events**
   (leave Pub/Sub off) → **Create project**. Copy the **Project ID** (a long id with dashes) for step C.
Skip it to leave the Nest "waiting".

#### C. Azure Cloud Shell: the three secrets (one paste)

> **What this does.** Services: Azure (the Key Vault and the Function App). It asks for the Google client ID, the
> client secret (typed hidden) and the Device Access project ID, stores each one
> that isn't empty in `kv-ceo-besgu7fnckib2`, points the Function App's settings at them and restarts it. Nothing is
> printed or written to a file. Free. Undo: delete the secrets and restart.

Open <https://shell.azure.com> (Bash) and paste:

```bash
KV=kv-ceo-besgu7fnckib2; RG=rg-ceo-prod; APP=func-ceo-besgu7fnckib2; read -rp "Google client ID: " GID; read -rsp "Google client secret: " GSEC; echo; read -rp "Device Access project ID: " NPID; S=(); put() { if [ -n "$3" ]; then az keyvault secret set --vault-name $KV -n "$1" --value "$3" -o none && S+=("$2=@Microsoft.KeyVault(VaultName=$KV;SecretName=$1)") && echo "set $1"; fi; }; put haven-google-client-id HAVEN_GOOGLE_CLIENT_ID "$GID"; put haven-google-client-secret HAVEN_GOOGLE_CLIENT_SECRET "$GSEC"; put haven-nest-project-id HAVEN_NEST_PROJECT_ID "$NPID"; unset GSEC; [ ${#S[@]} -gt 0 ] && az functionapp config appsettings set -g $RG -n $APP --settings "${S[@]}" -o none; az functionapp restart -g $RG -n $APP -o none && echo "restarted; Haven connections ready to connect"
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

If "Hey Google, add … to my shopping list" lands in Google Keep instead of Tasks for your account, say "… to my
Shopping list in Google Tasks", or make Tasks the default shopping list in the Google Home app if it offers it.

### King Soopers

Send to King Soopers (#664) uses Kroger's free public API (developer.kroger.com), since Instacart's developer platform
closed and MealMe offered only King Soopers here. Kroger's app **CEO Haven** is registered (Production; Cart,
Locations, Products and Profile) with both redirect URIs, `https://ceo.nikita.page/api/haven/kroger-callback` and
`https://thankful-forest-019308c1e.5.azurestaticapps.net/api/haven/kroger-callback`. Its id and secret are the Key
Vault secrets `kroger-client-id` and `kroger-client-secret`, read through the app settings `KROGER_CLIENT_ID` and
`KROGER_CLIENT_SECRET` (Key Vault references in `infra/resources.bicep`, so each deploy keeps them). Until both are
in, King Soopers shows "waiting".

On the Desk, signed in with your passkey. Setup is in **Boiler Room → Controls → Connections** (the house block):

1. Under **King Soopers**, type your ZIP → **Find stores** → **Use this** on your home store. The ZIP and the store
   stay in the Haven's private store, read only by your passkey; picking another store starts the picks over.
2. **Connect King Soopers** once: Kroger's sign-in, for the cart only. Kroger sends you back to Controls. The refresh
   token is sealed with `home-token-key`; **Disconnect** forgets it.

Then **Haven → Kitchen** (or **Order at King Soopers** on Today's Kitchen chip):

3. **Match N items at this store**: each open item gets the first in-stock product at that store, with its price (the sale price
   when there is one) and stock. **Swap** shows the other matches, or searches another way; untick an item to leave it
   out. A match is kept, so an item is looked up once (again after three days unless you chose it yourself).
4. **Send N to King Soopers** adds exactly the picks shown to your King Soopers cart and opens it. Pick pickup or
   delivery and check out in the King Soopers app. Nothing is bought from the Desk.

Calls happen only on those taps (Kroger's limits: 10,000 product calls and 1,600 location calls a day, 5,000 cart calls
a day), never on a timer. `MEALME_API_KEY` (Key Vault `haven-mealme-key`) stays on the Function App, unread, from
before King Soopers replaced MealMe.

## The meal planner

The Kitchen page is the meal planner (#678, [`MealPlanner.tsx`](../apps/world/src/desk/haven/MealPlanner.tsx)) with the
Kitchen list and King Soopers as its rail: the week as seven day cards (the dinner's photo and the day's protein ring
against the goal, at least 200 g), the open night in a drawer (recipe, macros, parts to swap, portion, spice,
HelloFresh, for two, in the cart, backups, Not for me), "Try something new?" picks, and the catalog and taste profile
as drawers. Every week plans as cook-yourself; HelloFresh is a switch per night (it counts a fixed protein and buys
nothing). Server side: [`api/_haven/meals.ts`](../api/_haven/meals.ts); the shapes and every edit, pure and shared by
the server, the Desk and Skippy's tools: [`api/_haven/mealShape.ts`](../api/_haven/mealShape.ts).

- **Where.** One file in the private store, `haven/meals.json`: the taste profile (protein goal, top-up, avoid rules
  with an `unless`, likes, rules, and the budget, which is only ever there), the catalog (each meal's ingredients, its
  swappable `parts`, macros as built, a photo id, times had, passed) and the week (seven slots: meal, two backups, lunch,
  for two, HelloFresh, in the cart, `custom`, the night's own `photo`). Nothing of it is in the repo; signed out,
  `/api/haven?view=status` carries `meals: { planned, cooking, helloFresh, confirmed }` only.
- **The swap model.** A meal's protein, carb and side are parts pointing into a component library (`COMPONENTS`, plus
  any the file adds): each component has its own ingredients and macros for one portion. A swap takes the old
  component's ingredients out and the new one's in and moves the macros by the difference, so the ring and the week's
  shopping follow at once. A night's `custom` is `{ parts: { "<part index>": "<component id>" }, portion, spice }`.
- **Edits** (`MealEdit`, the one closed set; `POST /api/haven-meals { action: "edit", edit }` answers `{ meals,
  changes }`, and Undo holds the state before the last edit):

  | Edit | Does |
  | --- | --- |
  | `{ op: "swap", day, meal }` | puts a catalog meal on a night (a backup trades places) |
  | `{ op: "nope", day }` | Not for me: passes on the meal, its first usable backup goes on |
  | `{ op: "customize", day, part?: { index, option }, portion?: 0.75 \| 1 \| 1.25 \| 1.5, spice?: "mild" \| "medium" \| "hot", reset? }` | changes a part, the portion or the spice; `reset` puts it back as written |
  | `{ op: "night", day, helloFresh?, forTwo?, inCart? }` | the night's switches |
  | `{ op: "avoid", term, unless? }` / `{ op: "unavoid", term }` | a taste rule; every night that breaks it is swapped for a backup without it |
  | `{ op: "like", term, liked }` | a like in the taste profile (or taken off); a meal with it is planned first among equals |
  | `{ op: "heat", spice \| null }` | the house heat: every night cooked mild, medium or hot unless the night says otherwise (null: as written). It isn't a customization, so it never asks for a photo |
  | `{ op: "goal", protein }`, `{ op: "pass", meal, passed }` | the protein goal; pass on (or bring back) a catalog meal |
  | `{ op: "next-week" }` | counts the cooked nights as had and plans the next week from the catalog |
  | `{ op: "confirm" }`, `{ op: "photo", day \| meal, photo }`, `{ op: "undo" }` | see below; the photo library's id; Undo |

  Any change to the plan makes a confirmed week a draft again.
- **Confirm week.** `POST /api/haven-meals { action: "confirm" }` confirms the week, puts its shopping (cooked nights
  in the cart, by portions: for two, plus one for each lunch left over, staples left out) on the Kitchen list with
  source `meals`, where the King Soopers rail matches and sends it, and queues the customized nights in
  `week.photoQueue` (`photoJobs`). The Desk then hands those nights to the photo library (`POST /api/haven-photos
  { action: "confirm", meals }`, below, with the components as customized) and writes each id back with the `photo`
  edit; a night shows its own photo once the library says `ready`, its meal's photo (or a placeholder) until then.
- **Seeding.** `PUT /api/haven-meals { meals, replace? }` with the feed key (counts back), or the Kitchen's "Load a
  planner file" when nothing is loaded. Without `replace` it never overwrites a planner that's there.
- **Cook mode (#705).** "Cook mode" in a night's drawer (not on a HelloFresh night) opens the dinner full screen, one
  step at a time in big type ([`CookMode.tsx`](../apps/world/src/desk/haven/CookMode.tsx), built by `cookOf` in
  [`cook.ts`](../apps/world/src/desk/haven/cook.ts) from `slotDish`, so it is the night as customized). A step that
  names a swapped part names the new one, marked in gold; a step for a part left out (No carb, No side) says to skip
  it. Beside it (a panel behind "Ingredients" on a phone): the parts tonight, how many portions go in the pan
  (`portionsOf`: for two, a lunch left over), the heat, and the amounts for all of them. Next and Back are wide
  buttons at the bottom; the arrow and Page keys, Home and End, a sideways swipe or the step marks move too, and
  Escape or Close leaves (the Kitchen stays open). The screen is kept awake with the browser's Wake Lock while it's
  open ("Screen stays on"), taken again when the tab comes back; where the browser lacks it or refuses, the note just
  isn't there. Screen code only: nothing new is read, sent or stored.
- **Talking to it (#698).** Nikita edits the week by talking to Skippy: his chat on the Desk, a room's mic (the Haven's
  Steward, or Skippy on Today) or Hands-free. The Haven's tools (rooms/haven/tools.ts, run in
  `api/_skippy/agent/tools.ts`) make the same edits, each through `readEdit` first, so a tool can only make an edit the
  closed set allows:

  | Said | Tool | Edit |
  | --- | --- | --- |
  | "what's for dinner this week?" | `meals_week` | reads the week (never the budget) |
  | "swap Tuesday for the kofta", "not for me" | `meals_swap` | `swap` by the meal's name, or `nope` |
  | "quinoa instead of rice on Monday", "no carb Friday", "a bigger portion Thursday", "make Wednesday hot" | `meals_customize` | `customize`: a part by name (`componentFor`), portion, that night's spice, reset |
  | "Friday's a HelloFresh night", "Saturday for two" | `meals_night` | `night` |
  | "I don't like mushrooms", "mushrooms are fine again" | `meals_avoid` | `avoid` / `unavoid` |
  | "I love salmon", "more spicy", "protein goal 210" | `meals_taste` | `like`, `heat`, `goal` |
  | "undo that" | `meals_undo` | `undo` |
  | "put the week on the list" | `meals_send` | the week's shopping onto the Kitchen list |
  | "send it to King Soopers" | `meals_cart` | waits for Nikita's Yes tap in the Desk's chat (it sends), then adds the matched picks the Kitchen shows to the cart (`sendPicks`, the Send button's own path); never on a mic or a call |
  | "plan next week" | `meals_next_week` | `next-week` |

  In the Haven, meal talk always goes to Skippy, never the to-do or shopping rules (`mealTalk` in
  api/_haven/classify.ts: "swap Tuesday for tacos" is a swap, not a to-do). The Kitchen page follows at once: each
  answer names the tools that changed something (`wrote`, docs/SKIPPY.md), and the planner reads itself again, opens
  the night that changed and says "Skippy changed it: …". Confirm week stays a tap on the Kitchen page (it starts the
  customized nights' photos).

## The meal photo library

The Kitchen's meal planner (#678) shows a photo on every night; this is where they live and how a customized meal gets
its own (#687, [`api/_haven/photos.ts`](../api/_haven/photos.ts), shapes in
[`api/_haven/photoShape.ts`](../api/_haven/photoShape.ts)). Azure only.

- **Where.** The private container `haven-meals` in the storage account (`stceobesgu7fnckib2`; infra/resources.bicep,
  no public access, no account keys), reached only with the Function App's identity: `catalog.json` (every photo's
  id, meal, key, prompt, style `plate` or `prep`, source `openai`, `upload` or `seed`, state and times),
  `full/<id>.png|jpg` (as made or uploaded) and `720/<id>.jpg` (the Desk's copy, 720 px wide). Nothing is in the repo
  and no blob URL is ever handed out: a photo comes back only through `GET /api/haven-photos` to the passkey session.
  The template makes the container; until the deploy can apply it (the role paste, docs/AZURE.md) the first write
  makes it instead, private (azure/src/blob.ts, #711).
- **Made.** OpenAI's images API with the Studio's key (Key Vault secret `openai`, `OPENAI_STUDIO_KEY`):
  `gpt-image-2`, 1024 × 1536, quality medium, streamed with one partial image (the final
  `image_generation.completed` event's image is kept), then low once if medium fails. The prompt is the demo's two
  styles (plated on off-white ceramic in daylight; meal-prep containers on grey stone) with the dish's name,
  description and components after Customize ([`api/_haven/photoGen.ts`](../api/_haven/photoGen.ts)).
- **The cap.** The project's OpenAI images cap, **$10 a month**, in the ledger `openai/images-<YYYY-MM>.json` in the
  private store. Each attempt is counted before the call at $0.10 (medium) or $0.03 (low), above list price, and
  handed back only when OpenAI answered with an error status. About 100 photos a month; past the cap nothing is
  called and the waiting photos read `budget` until the month turns and the week is confirmed again.
- **One at a time.** Photos are made after the answer, oldest first, one run at a time under a lease in the catalog;
  the timer `haven_photos` runs every ten minutes while anything waits, so a run cut short is picked up again.
- **Idempotent.** A photo's `key` is the SHA-256 (16 hex) of its meal id, its components as a set (case and order don't
  matter) and its style; its id is `<meal>-<first 8 of the key>`. Confirming the same week again returns the same ids
  and makes nothing; a `failed` or `budget` photo is tried once more. A `ready` photo with the same key wins, an
  upload included.
- **Logs** say counts and states only, never a meal, a prompt or the key.

### The contract (for the planner's UI and Talk to edit)

Every call is the Desk's passkey session except the feed key's PUT. A meal to photograph (`MealToShoot`):

```json
{ "meal": "gochujang-chicken-bowl", "name": "Gochujang chicken bowl",
  "description": "Sticky chicken thighs over rice with a crunchy slaw.",
  "components": ["Chicken thighs", "Quinoa", "Cabbage slaw"], "style": "plate" }
```

`meal` is the planner's meal id (`/^[a-z0-9][a-z0-9-]{1,47}$/`), `components` the component names as customized (up to
8), `style` `plate` or `prep`. Text is taken as untrusted: control characters and `<>{}` are dropped and each field
capped.

| Call | Answer |
| --- | --- |
| `POST /api/haven-photos { action: "confirm", meals: MealToShoot[] }` (1–14 meals): the confirm-week hook | `{ photos: [{ meal, key, id, status }], budget }` at once. `status` is `queued`, `making`, `ready`, `failed` or `budget`; put `id` on the night (`slot.photo`) and show it once `ready`. |
| `POST /api/haven-photos { action: "generate", meal: MealToShoot }`: one meal | `{ photo: { meal, key, id, status }, budget }` |
| `GET /api/haven-photos?view=catalog[&ids=a,b,…]`: poll the tickets (up to 50 ids) or list the library | `{ photos: PhotoEntry[], budget, ready }`; `ready` is false until the OpenAI key is set |
| `GET /api/haven-photos?id=<id>[&size=full]`: the photo (`photoUrl(id)` in photoShape.ts) | the 720 px JPEG (or the original), `Cache-Control: private, max-age=3600`; 404 when there is none |
| `POST /api/haven-photos { action: "upload", meal, image, id?, name?, style?, components?, source? }` | `{ photo: PhotoEntry }`. `image` is base64 PNG or JPEG (a `data:` prefix is fine), at most 4 MB decoded; the id is `id` or the meal's own, and an upload under an id already there replaces it. |
| `POST /api/haven-photos { action: "remove", id }` | `{ ok: true }`, or 404 |
| `PUT /api/haven-photos { meal, image, id?, name?, style?, components? }` with the feed key (`x-ceo-room-key` or `Authorization: Bearer`), no query | `{ ok, id, bytes }` only, source `seed`: the Builder loads photos with no tap. Neither room key can read a photo. |

`budget` is `{ month, images, usd, capUsd, left, reached }`. Errors: 401 without the session, 400 `bad-meals`,
`bad-photo` (the bytes aren't an image it can read) or `bad-request`, 413 `too-big`, 503 `not-set-up` or `store`
(an upload the library couldn't keep; the log says the error's class and code, never the photo or its meal).

## Vendor limits

- **No official APIs.** Each vendor can change its cloud without notice; a change shows as that vendor "down" on the
  Desk and in Systems, and the others carry on.
- **Roborock.** Only the cloud path (no local LAN control from Azure). The home's device list is read at most every
  six hours to stay well under Roborock's rate limits; the status and map are read live. Only the V1 protocol
  (`pv 1.0`) is spoken, which the Qrevo line uses; the email code is the only sign-in (no password is ever stored).
- **Petlibro.** The US region only (`api.us.petlibro.com`). One session per account (see above). The wet feeder opens
  the current plate's lid; it can't choose a tray or a portion size.
- **Petlibro's day (#685).** Read only, from the endpoints the community integration uses: `todayDrinkData` (the
  fountain), `grainStatus` (feeders), `feedingPlan/list` and `feedingPlan/todayNew` (the dry schedule), and the wet
  plan's windows. Each field is taken only when it has the expected shape and hidden otherwise; a side read Petlibro
  refuses leaves only its part out. The app's optional daily water goal has no known field in the API and isn't
  shown. These are private readings: the public face stays each device's kind and state.
- **Whisker.** The Litter-Robot 5 and 5 Pro are supported through pylitterbot's LR5 REST path; a Litter-Robot 4 (a
  different, GraphQL API) is not implemented. Night light, sleep mode and cycle delay are not exposed.
- **Petlibro's wet tray.** `platePositionChange` and `stopFeedNow` come from the community integration, not a
  published API; the plan's bowl per meal is read when the app sends it, and only meals opened from here are counted
  as served.
- **Nest.** Through Device Access only (no local control); eco mode can't be changed through SDM, so the Desk says to
  change it in the Home app.
- **Google Tasks.** It reads the one list by name; Google Keep lists have no API.
- **Pace.** Readings are cached 30 seconds per warm instance, and callers at once share one read; a phone key's device
  calls share its 30 an hour. After a command, its vendor's reading is taken as the command left it for 20 seconds
  instead of being read again (the Nest's set point and mode; Google SDM rate-limits reads per user), and a read that
  fails in passing (429, a 5xx, a timeout) keeps the vendor's last good reading, marked stale, for up to 10 minutes
  before it reads "down" (#681). A refused login is down at once.
