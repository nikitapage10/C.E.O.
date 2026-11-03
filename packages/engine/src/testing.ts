import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Helpers for the room contract's tests (#617, docs/ROOMS.md). They read the repo's own files as text, so a test can
 * hold a manifest to the docs and the Azure wiring without importing modules that do work when loaded.
 * Node only: never imported by a page.
 */

/** The repo's root folder. */
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** A file in the repo, as text, or null when it isn't there. */
export function readRepoFile(path: string): string | null {
  try {
    return readFileSync(REPO_ROOT + path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Every Markdown heading's text, without the hashes. Parsed line by line with no backtracking regex, so a long run of
 * spaces can't make it slow (CodeQL js/polynomial-redos).
 */
export function headingsOf(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    let hashes = 0;
    while (hashes < line.length && line[hashes] === "#") hashes++;
    if (hashes < 1 || hashes > 6) continue;
    const next = line[hashes];
    if (next !== " " && next !== "\t") continue;
    const text = line.slice(hashes).trim();
    if (text) out.push(text);
  }
  return out;
}

/** The secret settings the Function App resolves from the Key Vault (azure/src/env.ts, SECRET_SETTINGS). */
export function secretSettings(): string[] {
  const src = readRepoFile("azure/src/env.ts") ?? "";
  const block = src.match(/export const SECRET_SETTINGS = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
  return [...block.matchAll(/^\s*"([A-Z0-9_]+)",/gm)].map((m) => m[1]!);
}

/** The Function App's endpoint names (azure/src/index.ts, ENDPOINTS). */
export function azureEndpoints(): string[] {
  const src = readRepoFile("azure/src/index.ts") ?? "";
  const block = src.match(/export const ENDPOINTS[^=]*= \[([\s\S]*?)\n\];/)?.[1] ?? "";
  return [...block.matchAll(/^\s*\["([a-z-]+)",/gm)].map((m) => m[1]!);
}

/** The custom properties a stylesheet defines (`--name:`). */
export function cssTokens(path: string): Set<string> {
  const css = readRepoFile(path) ?? "";
  return new Set([...css.matchAll(/(--[a-z][a-z0-9-]*)\s*:/g)].map((m) => m[1]!));
}
