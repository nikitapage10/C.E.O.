/**
 * Send to King Soopers wired to the live settings (#664, docs/HOME-DEVICES.md, "King Soopers"). Azure only:
 *
 *   KROGER_CLIENT_ID, KROGER_CLIENT_SECRET   the Kroger app (Key Vault `kroger-client-id`, `kroger-client-secret`)
 *   HOME_TOKEN_KEY                           seals the cart grant in the private store
 *   CLAUDE_API_KEY (or ANTHROPIC_API_KEY)    the quantity check's Haiku call (#761; Key Vault, the same key as the
 *                                            world step and Skippy's), counted in Skippy's month (SKIPPY_BUDGET_USD)
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../../_blob.js";
import { pickAuthStore } from "../../_desk/store.js";
import { BlobChatLedger, KERNEL_LEDGER_PATH, canChat, chatMonth, skippyBudget } from "../../_skippy/budget.js";
import { claudeKey } from "../../_world/claude.js";
import { HomeVault, homeKey } from "../devices/vault.js";
import { krogerClientFrom } from "./api.js";
import { liveReviewAsk, type ReviewBudget } from "./review.js";
import { krogerCallback, krogerGet, krogerLink, krogerPost, type KrogerDeps } from "./route.js";

type Env = Record<string, string | undefined>;

/**
 * Skippy's month for the quantity check (#761): the chat's ledger and the Kernel responder's together under his one
 * cap, as Today's parse counts (api/_today/route.ts). The check's cost goes on the chat's ledger as triage (Haiku).
 * Unreadable means no call.
 */
function skippyMonth(blob: NonNullable<ReturnType<typeof pickBlob>>, env: Env): ReviewBudget {
  const chat = new BlobChatLedger(blob);
  const kernel = new BlobChatLedger(blob, KERNEL_LEDGER_PATH);
  return {
    fits: async (ceiling) => {
      const now = Date.now();
      const [c, k] = await Promise.all([chat.load(), kernel.load()]);
      return canChat(chatMonth(c, now).usd + chatMonth(k, now).usd, skippyBudget(env.SKIPPY_BUDGET_USD), ceiling);
    },
    add: (usage, usd) => chat.add(Date.now(), usage, usd, { triage: usd }),
  };
}

export function krogerDeps(env: Env = process.env): KrogerDeps {
  const blob = pickBlob(env);
  const sealKey = homeKey(env.HOME_TOKEN_KEY, "seal");
  return {
    desk: { deskKey: env.FOUNDRY_DESK_KEY ?? "", store: pickAuthStore(env), now: Date.now() },
    blob,
    vault: blob && sealKey ? new HomeVault(blob, sealKey) : null,
    client: krogerClientFrom(env),
    fetch: (url, init) => fetch(url, init),
    now: Date.now(),
    log: (line) => console.log(line),
    review: { ask: liveReviewAsk(claudeKey(env)), budget: blob ? skippyMonth(blob, env) : null },
  };
}

/** The King Soopers link's state, for the devices route's answers (and so Systems). */
export const krogerLinkFromEnv = (env: Env = process.env) => krogerLink(krogerDeps(env));

/* ── The handlers Azure registers ── */

export const krogerRoute = {
  GET: (request: Request) => krogerGet(request, krogerDeps()),
  POST: (request: Request) => krogerPost(request, krogerDeps()),
};
export const krogerCallbackRoute = { GET: (request: Request) => krogerCallback(request, krogerDeps()) };
