/**
 * Google Tasks quick-add (#637, docs/HOME-DEVICES.md): Nikita says "Hey Google, add oat milk to my Shopping list
 * in Google Tasks"; every five minutes the Function App reads that Tasks list, puts each open task on the Kitchen list
 * (api/_haven/list.ts: an item already open there, ignoring case and a plural "s", is skipped) and marks the task
 * completed in Tasks, so it is taken once.
 *
 *   GET   https://tasks.googleapis.com/tasks/v1/users/@me/lists                 find the chosen list by its title
 *   GET   https://tasks.googleapis.com/tasks/v1/lists/{list}/tasks?showCompleted=false   its open tasks
 *   PATCH https://tasks.googleapis.com/tasks/v1/lists/{list}/tasks/{task}  { status: "completed" }
 *
 * The list's title is Nikita's choice (default "Shopping"), kept with the run's counts in the private store
 * (`haven/google-tasks.json`). If Google Home's shopping list doesn't land in Google Tasks for Nikita's account (it
 * may go to Google Keep instead, which has no API), the list simply stays empty and nothing is imported.
 *
 * Logs name only what happened ("tasks: 2 imported"), never a task's words.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import type { BlobBackend } from "../../_blob.js";
import { callJson, VendorError, withQuery, type Fetch } from "../devices/http.js";
import { obj, str } from "../devices/types.js";
import type { HomeVault } from "../devices/vault.js";
import { readJson, updateJson } from "../json.js";
import { cleanName, KitchenList } from "../list.js";
import { accessToken, GrantRefusedError, type HavenClient, type StoredGrant } from "./oauth.js";

export const TASKS_API = "https://tasks.googleapis.com/tasks/v1";
export const TASKS_STATE_PATH = "haven/google-tasks.json";
export const DEFAULT_LIST = "Shopping";
/** The most tasks taken in one run. */
export const TASKS_PER_RUN = 50;
export const LIST_TITLE_MAX = 60;

export type TasksResult = "waiting" | "no-list" | "synced" | "refused" | "failed";

/** What the store keeps: the chosen list's title and how the last run went. Counts only, never a task. */
export interface TasksState {
  list: string;
  lastRun: string | null;
  lastResult: TasksResult | null;
  /** Items put on the Kitchen list by the last run, and in all. */
  lastImported: number;
  imported: number;
}

export const emptyTasksState = (): TasksState => ({ list: DEFAULT_LIST, lastRun: null, lastResult: null, lastImported: 0, imported: 0 });

const RESULTS: readonly TasksResult[] = ["waiting", "no-list", "synced", "refused", "failed"];

export function cleanTasksState(raw: unknown): TasksState {
  const o = obj(raw);
  const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, 1_000_000) : 0);
  return {
    list: listTitle(o.list) || DEFAULT_LIST,
    lastRun: typeof o.lastRun === "string" ? o.lastRun : null,
    lastResult: RESULTS.includes(o.lastResult as TasksResult) ? (o.lastResult as TasksResult) : null,
    lastImported: n(o.lastImported),
    imported: n(o.imported),
  };
}

/** A list title as kept: one plain line, capped. "" when nothing is left. */
export function listTitle(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\p{Cc}<>]/gu, "").replace(/\s+/g, " ").trim().slice(0, LIST_TITLE_MAX) : "";
}

const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface TasksDeps {
  fetch: Fetch;
  client: HavenClient | null;
  vault: HomeVault | null;
  blob: BlobBackend | null;
  now: () => number;
  log: (line: string) => void;
}

export async function readTasksState(blob: BlobBackend): Promise<TasksState> {
  return cleanTasksState(await readJson(blob, TASKS_STATE_PATH, null));
}

/** Changes the chosen list's title. */
export async function setTasksList(blob: BlobBackend, title: string): Promise<TasksState> {
  return updateJson<unknown, TasksState>(blob, TASKS_STATE_PATH, null, (raw) => {
    const next = { ...cleanTasksState(raw), list: title, lastResult: null };
    return { next, result: next };
  });
}

async function note(blob: BlobBackend, now: number, result: TasksResult, added: number): Promise<void> {
  await updateJson<unknown, void>(blob, TASKS_STATE_PATH, null, (raw) => {
    const s = cleanTasksState(raw);
    return { next: { ...s, lastRun: new Date(now).toISOString(), lastResult: result, lastImported: added, imported: s.imported + added }, result: undefined };
  });
}

async function get(fetchFn: Fetch, token: string, url: string): Promise<Record<string, unknown>> {
  return obj(await callJson(fetchFn, url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error" }));
}

/** The id of the list with this title (ignoring case and spacing), or null. */
export async function findList(fetchFn: Fetch, token: string, title: string): Promise<string | null> {
  const want = key(title);
  let pageToken = "";
  for (let i = 0; i < 3; i++) {
    const page = await get(fetchFn, token, withQuery(`${TASKS_API}/users/@me/lists`, { maxResults: 100, ...(pageToken && { pageToken }) }));
    for (const l of Array.isArray(page.items) ? page.items : []) {
      const o = obj(l);
      if (typeof o.id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(o.id) && key(str(o.title)) === want) return o.id;
    }
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : "";
    if (!pageToken) break;
  }
  return null;
}

export interface OpenTask {
  id: string;
  title: string;
}

/** The list's open tasks with a title, oldest first as Tasks gives them, at most TASKS_PER_RUN. */
export async function openTasks(fetchFn: Fetch, token: string, list: string): Promise<OpenTask[]> {
  const page = await get(fetchFn, token, withQuery(`${TASKS_API}/lists/${encodeURIComponent(list)}/tasks`, { showCompleted: "false", showHidden: "false", showDeleted: "false", maxResults: 100 }));
  const out: OpenTask[] = [];
  for (const t of Array.isArray(page.items) ? page.items : []) {
    const o = obj(t);
    if (typeof o.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(o.id) || o.status === "completed" || o.deleted === true) continue;
    const title = cleanName(o.title);
    if (title) out.push({ id: o.id, title });
    if (out.length >= TASKS_PER_RUN) break;
  }
  return out;
}

async function complete(fetchFn: Fetch, token: string, list: string, task: string): Promise<boolean> {
  const res = await fetchFn(`${TASKS_API}/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(task)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ status: "completed" }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  }).catch(() => null);
  await res?.body?.cancel().catch(() => undefined);
  return Boolean(res?.ok);
}

/** One run of the quick-add. Never throws; the answer says how it went. */
export async function syncTasks(deps: TasksDeps): Promise<{ result: TasksResult; imported: number; skipped: number }> {
  const { client, vault, blob } = deps;
  const none = (result: TasksResult) => ({ result, imported: 0, skipped: 0 });
  if (!client || !vault || !blob) return none("waiting");
  const grant = await vault.read<StoredGrant>("google-tasks").catch(() => null);
  if (!grant) return none("waiting");
  if (grant.refused) return none("refused");
  const now = deps.now();
  const finish = async (r: { result: TasksResult; imported: number; skipped: number }) => {
    await note(blob, now, r.result, r.imported).catch(() => undefined);
    deps.log(r.result === "synced" ? `tasks: ${r.imported} imported, ${r.skipped} already listed` : `tasks: ${r.result}`);
    return r;
  };
  try {
    const token = await accessToken(deps.fetch, client, "tasks", grant.refresh, now);
    const state = await readTasksState(blob);
    const list = await findList(deps.fetch, token, state.list);
    if (!list) return finish(none("no-list"));
    const open = await openTasks(deps.fetch, token, list);
    if (!open.length) return finish({ result: "synced", imported: 0, skipped: 0 });
    const { added } = await new KitchenList(blob).add(
      open.map((t) => t.title),
      now,
      "tasks",
    );
    // Every task taken is marked completed, the ones already on the list too, so none comes back next run.
    for (const t of open) await complete(deps.fetch, token, list, t.id);
    return finish({ result: "synced", imported: added.length, skipped: open.length - added.length });
  } catch (e) {
    if (e instanceof GrantRefusedError) {
      await vault.write("google-tasks", { ...grant, refused: true }).catch(() => undefined);
      return finish(none("refused"));
    }
    if (e instanceof VendorError && e.status === 401) return finish(none("refused"));
    return finish(none("failed"));
  }
}
