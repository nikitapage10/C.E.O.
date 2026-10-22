# Invoices through PayPal: the Spire's ledger

The Spire's first real line (#279; Nikita, 2026-10-22: "For the spire, I want to integrate my PayPal API to be able to
make invoices"). It runs **on the Azure copy only**, in the Function App, with PayPal keys that live only there. The
Vercel copy's Spire page says "Invoices: on the Azure copy".

## What it does

The **Spire page** on the Desk (`/spire`) has an **Invoices** panel, behind the passkey:

1. **New invoice**: the client's name and email, up to 20 lines (what it's for, optional details, quantity, price
   each), a due date, a currency (USD unless picked) and an optional note. **Make a draft** creates a PayPal
   **draft** invoice. Nothing goes to the client.
2. Each draft has **Send**. It asks again in the page ("Send this invoice to …? PayPal emails it to them now.") with
   **Yes, send it** and **Not yet**. Only **Yes, send it** makes the separate send call; PayPal then emails the
   client and a copy to Nikita.
3. The list shows the newest 50 invoices and where each stands: **Draft**, **Sent, unpaid**, **Sent, viewed** (when
   PayPal says the client opened it), **Part paid**, **Paid**, **Overdue** (unpaid past its due date, by Mountain
   time), **Cancelled** or **Refunded**, with **Open in PayPal** for the full view. A sent, unpaid invoice can be
   cancelled the same two-step way (PayPal tells the client).

The ledger at the top of the page shows the counts (open, paid, overdue), Today's Spire thread reports them in the
Executive's voice, the Lattice's Spire room has the open-invoice count on the Executive's easel, and Systems and the
Boiler Room have a PayPal pipe.

### The PayPal calls

The code is in [`api/_paypal/`](../api/_paypal), registered in [`azure/src/index.ts`](../azure/src/index.ts) as
`/api/invoices`. Shapes checked against PayPal's published spec for Invoicing v2
(`developer.paypal.com/api/invoicing/v2/schema.json`, read 2026-10-22):

| Call | When |
| --- | --- |
| `POST /v1/oauth2/token` (client credentials) | When the cached token is missing or within two minutes of expiring; one token per warm instance |
| `POST /v2/invoicing/generate-next-invoice-number` | Before each draft (if it fails, PayPal numbers the draft itself) |
| `POST /v2/invoicing/invoices` with `Prefer: return=representation` | **Make a draft**. One recipient, the lines as `QUANTITY` items, `payment_term.due_date`, the note; no tips. The invoicer block is left out: PayPal fills it from the account the keys belong to |
| `GET /v2/invoicing/invoices/{id}` | Before a send or cancel, to check it is still a draft (or still open) |
| `POST /v2/invoicing/invoices/{id}/send` (`send_to_recipient`, `send_to_invoicer`) | Only on **Yes, send it** |
| `POST /v2/invoicing/invoices/{id}/cancel` | Only on **Yes, cancel it**, for a sent, unpaid invoice |
| `GET /v2/invoicing/invoices?page=1&page_size=50` | The Spire page, every minute while it's open; the public counts at most every five minutes |

No other PayPal path can be called: the one request function refuses anything outside that list before it uses the
token. Nothing touches payments, payouts, refunds, balances or the account.

## Safety

- **Nothing reaches a client without two deliberate steps.** Make a draft never sends. The send request must be a
  `POST` with `{ action: "send", id, confirm: true }`; without `confirm: true` exactly, the answer is 409 and PayPal
  isn't called. The page adds `confirm: true` only after its own **Yes, send it** step. Cancel works the same way.
- **The passkey, from the Desk's own pages.** Every read of the list and every write goes through `requireSession`,
  the same check as Skippy and the email agent: a good Desk session for a passkey that is still enrolled, and an
  `Origin` that is this site (403 otherwise). Writes must be `application/json` (415 otherwise), which a plain form
  on another site can't send, and the session cookie is `SameSite=Strict`. The site gate sits in front of it all.
- **Checked on the server.** Client name 1 to 120 characters; email in PayPal's own restrictive form, at most 254;
  1 to 20 lines, each named (up to 120), details up to 300, quantity above 0 up to 9,999 with at most two decimals,
  price above 0 up to 100,000 with at most two decimals; a total of at most 250,000; a due date from today (Mountain)
  up to a year out; a note up to 1,000; currency one of USD, CAD, EUR, GBP, AUD (USD by default). Control characters
  are refused. A bad draft is answered with a code (`client-email`, `amount`…) and never reaches PayPal.
- **Sandbox by default.** Anything but `PAYPAL_ENV=live` uses `https://api-m.sandbox.paypal.com`; the page says
  "PayPal sandbox: test money only" until it's live.

## Privacy

- **To the browser**, the list (client names, emails, numbers, amounts, dates) only through `GET /api/invoices` in the
  passkey session, `private, no-store`, every value wrapped in `<Private>` so **Hide** masks it.
- **To the public** (the Lattice's easel, the Spire ledger, Today's thread, Systems, the Boiler Room,
  `GET /api/invoices?view=status`): `InvoiceStatus` only ([`api/_paypal/status.ts`](../api/_paypal/status.ts)), an
  allowlist of counts (drafts, open, overdue, paid), PayPal's state (waiting, live, error), the mode (sandbox, live)
  and a timestamp. It refuses any unknown key or free string; a test checks no client, email, number or amount
  reaches it.
- **Nothing is stored.** The list is read from PayPal each time; only the counts and the access token are kept, in
  the warm instance's memory.
- **Logs hold nothing.** The code logs nothing; errors carry a short code, never PayPal's message, which can echo
  what was sent.
- **The keys** are Key Vault secrets behind the Function App's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`
  settings. They never reach the browser, the repo or Vercel; the token is sent only to PayPal.

## Setup (done for the sandbox)

The Function App `func-ceo-besgu7fnckib2` already has `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (Key Vault
references) and `PAYPAL_ENV=sandbox`. After this change deploys to Azure (the **Deploy to Azure** run, 3 to 4
minutes after the merge), the Spire page on the Azure copy shows the panel.

### Try a sandbox invoice

1. Open <https://developer.paypal.com/dashboard/accounts> (signed in as yourself) and copy the email of a
   **Personal** sandbox account (one is made for you; **Create account** makes another). That is the test client.
2. Open <https://thankful-forest-019308c1e.5.azurestaticapps.net/spire> and sign in with your passkey.
3. **Invoices** → **New invoice** → a name, that sandbox email, one line (for example "Test", 1, 10.00), a due date
   → **Make a draft**. It appears as **Draft**.
4. **Send** → **Yes, send it**. It becomes **Sent, unpaid**. PayPal's sandbox doesn't deliver real email: log in at
   <https://www.sandbox.paypal.com> as that Personal account (its password is on the same accounts page, under
   **⋯** → **View/edit account**) to see the invoice and pay it.
5. Pay it there, and within a minute the Desk shows **Paid**; the Lattice's easel counts it out.

### Switch to live

1. At <https://developer.paypal.com/dashboard/applications/live>, open (or **Create App**) your Live REST app and
   copy its **Client ID** and **Secret**. The app needs the **Invoicing** feature ticked (it is by default).
2. In Azure Cloud Shell (<https://shell.azure.com>, Bash), paste this one line. It asks for the Live client ID and
   secret (typing hidden), writes them over the sandbox ones, points the settings at them, sets `PAYPAL_ENV=live`
   and restarts the Function App:

```bash
KV=kv-ceo-besgu7fnckib2; read -rp "PayPal LIVE client ID: " PID; read -rsp "PayPal LIVE secret: " PSECRET; echo; az keyvault secret set --vault-name $KV -n paypal-client-id --value "$PID" -o none && az keyvault secret set --vault-name $KV -n paypal-client-secret --value "$PSECRET" -o none && echo "set paypal keys"; unset PSECRET; az functionapp config appsettings set -g rg-ceo-prod -n func-ceo-besgu7fnckib2 --settings "PAYPAL_CLIENT_ID=@Microsoft.KeyVault(VaultName=$KV;SecretName=paypal-client-id)" "PAYPAL_CLIENT_SECRET=@Microsoft.KeyVault(VaultName=$KV;SecretName=paypal-client-secret)" "PAYPAL_ENV=live" -o none && az functionapp restart -g rg-ceo-prod -n func-ceo-besgu7fnckib2 -o none && echo "PayPal is live; function app restarted"
```

3. The Spire page now says **Live PayPal**. The first draft you make is a real draft on your PayPal account, and
   **Send** emails a real client.

To go back to the sandbox, run the same paste with the sandbox app's ID and secret and `PAYPAL_ENV=sandbox`. If the
template is ever run again, pass `paypalEnv=live` on it (`infra/main.bicep`), or it writes `sandbox` back. To turn
invoicing off, delete the `PAYPAL_*` app settings: the page then waits for its keys.

## The checks

`api/_paypal/paypal.test.ts` (with `npm test`, every PayPal call mocked, PayPal never reached): the token is fetched
with client credentials and cached until shortly before it expires, and retried once when PayPal refuses it; only
invoicing paths can be called; the server-side validation; the draft's exact payload (no invoicer, two-decimal
amounts, a due date); create never calls send; send and cancel need the passkey session, the Desk's origin, JSON and
`confirm: true`, and only reach a draft (or an open invoice); PayPal's statuses and overdue; the public counts are an
allowlist with no client, email, number or amount, cached for five minutes, and say waiting or error rather than a
made-up zero. `apps/world/src/desk/spire/invoices.test.ts` covers the Desk side: the counts-only line, the pipe, the
defensive reads, the form check, that nothing is sent without the page's confirm step, and the Vercel copy showing
"on the Azure copy".
