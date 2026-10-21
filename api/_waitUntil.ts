/**
 * `waitUntil` that works on Vercel and on Azure (docs/AZURE.md). Work handed to it carries on after the response:
 *   Vercel  @vercel/functions' own waitUntil, exactly as before: the function stays alive until the work is done.
 *   Azure   Azure Functions has no such hook, so the adapter (azure/src/adapter.ts) runs each request inside
 *           `collectWaitUntil`, which gathers the work here, and waits for it before it answers (up to a limit per
 *           route; what is left after that keeps running on the warm instance).
 *
 * Underscore file: Vercel never serves it as a function.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { waitUntil as vercelWaitUntil } from "@vercel/functions";

const scope = new AsyncLocalStorage<Promise<unknown>[]>();

/** Keep `promise` running after the response (its result and any failure are ignored by the response). */
export function waitUntil(promise: Promise<unknown>): void {
  const pending = scope.getStore();
  if (pending) pending.push(promise);
  else vercelWaitUntil(promise);
}

/** Run `fn` and gather everything it (and anything it awaits) hands to waitUntil. */
export async function collectWaitUntil<T>(fn: () => Promise<T>): Promise<{ result: T; pending: Promise<unknown>[] }> {
  const pending: Promise<unknown>[] = [];
  const result = await scope.run(pending, fn);
  return { result, pending };
}
