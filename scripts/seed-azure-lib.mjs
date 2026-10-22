/**
 * What the one-off Azure seed copies from production's Vercel Blob store (docs/AZURE.md, "Seeding the Azure state"),
 * and where each file lands on disk before the workflow uploads it into `ceo-state` under the same name.
 *
 * Only the world, its stories and the idea pictures: the Desk's sign-ins (`desk/`) stay behind, because passkeys and
 * push subscriptions belong to the address they were made on, and Skippy's chat ledger is per copy.
 */

import { join, normalize, sep } from "node:path";

/** The prefixes copied, as the stores name them (api/_world/store.ts, api/_world/story.ts, api/foundry-image.ts). */
export const SEED_PREFIXES = ["world/", "foundry/ideas/"];

/**
 * The file a blob's pathname is written to under `root`, or null when the name isn't one to copy or could step out
 * of `root` (an absolute name, `..`, a backslash or a control character): the listing comes from a remote store, so
 * its names are checked before they become paths.
 */
export function seedTarget(root, pathname) {
  if (typeof pathname !== "string" || pathname === "" || pathname.endsWith("/")) return null;
  if (!SEED_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f]/.test(pathname) || pathname.startsWith("/")) return null;
  if (pathname.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  const target = normalize(join(root, pathname));
  return target.startsWith(normalize(root) + sep) ? target : null;
}
