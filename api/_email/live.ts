/**
 * The email agent's minute as the Azure timer runs it (azure/src/index.ts, `email_tick`): everything `tick` needs,
 * from the Function App's settings. Azure only; Vercel never imports it.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { deliver, webPushSend } from "../desk-pings.js";
import { liveSubs } from "../_desk/pings.js";
import { pickAuthStore } from "../_desk/store.js";
import { emailBudget } from "./budget.js";
import { clientFrom } from "./route.js";
import { priorityFrom, skipTermsFrom } from "./filter.js";
import { claudeCall } from "./sort.js";
import { pickEmailStore } from "./store.js";
import { tick, type TickDeps, type TickResult } from "./tick.js";

type Env = Record<string, string | undefined>;

export function liveTickDeps(env: Env = process.env): TickDeps | null {
  const store = pickEmailStore(env);
  if (!store) return null;
  const auth = pickAuthStore(env);
  const pingsReady = Boolean(env.DESK_VAPID_PUBLIC_KEY && env.DESK_VAPID_PRIVATE_KEY && auth);
  return {
    store,
    fetcher: (url, init) => fetch(url, init),
    client: clientFrom(env),
    claude: claudeCall(env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || ""),
    budget: emailBudget(env.EMAIL_BUDGET_USD),
    skipTerms: skipTermsFrom(env.EMAIL_SKIP_TERMS),
    priority: priorityFrom(env.EMAIL_PRIORITY),
    now: Date.now(),
    ping: async (text) => {
      if (!pingsReady || !auth) return 0;
      const [state, passkeys] = await Promise.all([auth.pings(), auth.passkeys()]);
      const subs = liveSubs(state.subs, passkeys);
      return subs.length ? deliver(auth, subs, text, webPushSend) : 0;
    },
  };
}

/** One minute's check, or "waiting" when the store or GMAIL_TOKEN_KEY isn't there yet. */
export async function runEmailTick(env: Env = process.env): Promise<TickResult> {
  const deps = liveTickDeps(env);
  return deps ? tick(deps) : "waiting";
}
