/**
 * The world's steady clock (#271, docs/WORLD.md): a timer on the Azure Function App that steps the world, because
 * GitHub's hourly schedule (.github/workflows/world-step.yml) is best-effort and on 2026-10-21/22 fired only every
 * four to five hours, so the Boiler Room's world clock went DOWN (past three hours) between runs.
 *
 * Twice an hour, at :05 and :35 (Azure's six-field cron, UTC), it runs the same step handler in-process
 * (api/world-step.ts POST): no HTTP, so neither the site gate nor the Static Web App's proxy cut is in the way, and the
 * day's and week's stories are waited for.
 *
 * Azure is the only home since #313, so the old Vercel knock is off by default. The adapter stays until Vercel is
 * switched off: WORLD_TICK_VERCEL set to "on" knocks the old Vercel step again, or to an https:// URL knocks that step.
 *
 * The step does nothing until 55 minutes have passed since the last, so the :35 knock only matters when the :05 one
 * was missed or failed; GitHub's cron and the Foundry doorbell stay on as extra knocks. A failure on either side is
 * logged as an error (Application Insights) and thrown, so the run shows as failed.
 */

import { collectWaitUntil } from "../../api/_waitUntil.js";
import { settle } from "./adapter.js";

/** :05 and :35 past every hour. */
export const TICK_SCHEDULE = "0 5,35 * * * *";
export const VERCEL_STEP_URL = "https://command-everything-obviously.vercel.app/api/world-step";

/** One side's answer: the HTTP status (0 when it never answered) and the short JSON it sent. */
export interface TickSide {
  status: number;
  body: string;
}

export interface TickDeps {
  /** The step handler's POST (api/world-step.ts). */
  step: () => Response | Promise<Response>;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  log: Pick<Console, "log" | "error">;
}

/** 200 (stepped, or not due yet) and 409 (another knock stepped first) are both a working clock. */
export function stepOk(status: number): boolean {
  return status === 200 || status === 409;
}

/** Where to knock on Vercel: nowhere unless WORLD_TICK_VERCEL is "on" (the old step) or an https:// URL (#313). */
export function vercelUrl(env: Record<string, string | undefined>): string | null {
  const v = env.WORLD_TICK_VERCEL?.trim();
  if (v === "on") return VERCEL_STEP_URL;
  return v && /^https:\/\//.test(v) ? v : null;
}

async function stepHere(step: TickDeps["step"]): Promise<TickSide> {
  try {
    const { result, pending } = await collectWaitUntil(async () => step());
    // The day's and week's stories: a timer has no proxy to beat, so wait for them (the host's own timeout still holds).
    await settle(pending, 2 ** 31 - 1);
    return { status: result.status, body: (await result.text()).slice(0, 300) };
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

async function knock(url: string, fetcher: typeof fetch): Promise<TickSide> {
  try {
    const res = await fetcher(url, { method: "POST", signal: AbortSignal.timeout(170_000) });
    return { status: res.status, body: (await res.text()).slice(0, 300) };
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

/** One tick: the Azure world, and the Vercel one too when asked. Throws when either side failed, after both have been tried. */
export async function tick(deps: TickDeps): Promise<{ azure: TickSide; vercel: TickSide | null }> {
  const url = vercelUrl(deps.env);
  const [azure, vercel] = await Promise.all([stepHere(deps.step), url ? knock(url, deps.fetch) : Promise.resolve(null)]);
  deps.log.log(`world tick: azure HTTP ${azure.status} ${azure.body}`);
  if (vercel) deps.log.log(`world tick: vercel HTTP ${vercel.status} ${vercel.body}`);
  const failed = [!stepOk(azure.status) && `azure HTTP ${azure.status}`, vercel && !stepOk(vercel.status) && `vercel HTTP ${vercel.status}`].filter(Boolean);
  if (failed.length) {
    const msg = `world tick failed: ${failed.join(", ")}`;
    deps.log.error(msg);
    throw new Error(msg);
  }
  return { azure, vercel };
}
