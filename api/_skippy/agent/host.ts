/**
 * The rooms' tools, wired to the live site (#646): the reads, the memory, the Kitchen list, the home devices and the
 * GitHub issue "Implement it" files, from the server's own settings. Each piece loads only when a tool runs, so a
 * chat turn that calls no tool pays for none of it.
 *
 * Underscore folder: Vercel never serves it as a function.
 */

import { pickBlob } from "../../_blob.js";
import { skipTermsFrom } from "../../_email/filter.js";
import { githubToken } from "../../_github.js";
import { BlobMemory } from "./memory.js";
import { BlobPending } from "./pending.js";
import type { ToolHost } from "./tools.js";
import type { ActionId } from "../../_haven/devices/types.js";

type Env = Record<string, string | undefined>;

const GH = "https://api.github.com/repos/nikitapage10/C.E.O.";

export function liveHost(env: Env = process.env, now = Date.now()): ToolHost {
  const blob = pickBlob(env);
  const skipTerms = skipTermsFrom(env.EMAIL_SKIP_TERMS);
  return {
    read: async (name) => {
      const route = await import("../toolroute.js");
      return route.readText(name, route.liveSources(env), Date.now());
    },
    memory: blob ? new BlobMemory(blob, skipTerms) : null,
    kitchenAdd: blob
      ? async (items) => {
          const { KitchenList } = await import("../../_haven/list.js");
          return new KitchenList(blob).add(items, Date.now());
        }
      : null,
    homeAct: async (req) => {
      const { homeFromEnv } = await import("../../_haven/devices/live.js");
      const home = homeFromEnv(env);
      if (!home) return { ok: false, say: "The home devices aren't set up on this copy yet." };
      return home.act({ action: req.action as ActionId, via: "desk", ...(req.rooms && { rooms: req.rooms }), ...(req.portions !== undefined && { portions: req.portions }) });
    },
    fileIssue: async (title, body) => {
      const token = await githubToken("issues");
      if (!token) return null;
      const res = await fetch(`${GH}/issues`, {
        method: "POST",
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, labels: ["foundry", "foundry:chat"] }),
      });
      return res.ok ? ((await res.json()) as { number: number }).number : null;
    },
    skipTerms,
    now,
  };
}

/** The pending taps' store, or null without the private store. */
export const livePending = (env: Env = process.env) => {
  const blob = pickBlob(env);
  return blob ? new BlobPending(blob) : null;
};
