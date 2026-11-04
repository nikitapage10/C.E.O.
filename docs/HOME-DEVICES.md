# Home devices: the vacuum, the cat's feeders and fountain, the Litter-Robot

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
| Vacuum | state (docked, cleaning, returning, paused, charging…), battery, alerts (bin missing, dock bin problems, clean water tank empty or low, dirty water tank full, "needs a look" for any other error code), its map's room names | Start, Pause, Dock, **clean named rooms** (`app_segment_clean` with the map's segment ids, matched to the room names from the Roborock app) |
| Dry food feeder | online, food low, last feed, manual feeds today and the cap | **Feed 1 portion** |
| Wet food feeder | online, lid open or closed, last feed, openings today and the cap | **Open the tray** (opens the current plate's lid: the wet feeder serves trays, not portions) |
| Fountain | online, water level, filter life left, alerts (water low, filter due, needs a clean) | none |
| Litter-Robot 5 Pro | state (ready, cycling, cat inside, drawer full, paused, offline…), waste drawer %, litter level %, last visit, alerts (drawer full, drawer out, bonnet off, sensors need a wipe, litter low) | **Clean now** (a clean cycle) |

## The API

- `GET /api/haven/devices`: a passkey session or a phone key in `x-ceo-phone-key` ([HEY-SKIPPY.md](HEY-SKIPPY.md)). Every device's
  reading, each vendor's state (`waiting`, `live`, `down`) and the feed cap.
- `GET /api/haven/devices?view=status`: public. Each vendor's state and each device's kind and state; never a name,
  model, place, room or serial.
- `POST /api/haven/devices/action` `{ action, device?, rooms? }`: a passkey session or a phone key. `action` is one of
  `vacuum.start`, `vacuum.pause`, `vacuum.dock`, `vacuum.rooms`, `feeder.feed`, `wet.open`, `litter.clean`. Answers
  `{ ok, say, code? }`: 200 done, 409 a rail said no, 502 the vendor failed, 503 not connected.
- `POST /api/haven/devices/connect`: passkey session only (a bearer is refused). Connect Roborock: `send` (email),
  `code`, `disconnect`.
- Hey Skippy on the phone ([`api/_haven/classify.ts`](../api/_haven/classify.ts)) turns "vacuum the kitchen",
  "vacuum, go home", "pause the vacuum", "feed the cat", "give the cat wet food" and "run a litter clean cycle" into
  the same actions, with no model call. Everything else goes to Skippy's chat as before.

## Safety rails

Checked on the server, before the vendor is called, whoever asks ([`rails.ts`](../api/_haven/devices/rails.ts)):

- **Feeding.** At most `HOME_FEED_CAP` manual feeds a Mountain day **per feeder** (2 by default, 0 to 6): one portion
  each on the dry feeder, one opening each on the wet feeder, counted separately. The count is taken before the vendor
  is called and given back if the call fails. Scheduled meals in the Petlibro app are not touched or counted.
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
- **Pace.** Readings are cached 30 seconds per warm instance; a phone key's device calls share its 30 an hour.
