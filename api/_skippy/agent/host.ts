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
    lists: blob
      ? async () => {
          const { allLists } = await import("../../_haven/list.js");
          return (await allLists(blob, Date.now())).map((l) => ({ name: l.name, items: l.items.filter((i) => !i.done).map((i) => i.name) }));
        }
      : null,
    buyAdd: blob
      ? async (items) => {
          const { listOf } = await import("../../_haven/list.js");
          return listOf(blob, "buy").add(items, Date.now());
        }
      : null,
    meals: blob
      ? {
          read: async () => new (await import("../../_haven/meals.js")).MealsStore(blob).read(),
          edit: async (edit) => new (await import("../../_haven/meals.js")).MealsStore(blob).edit(edit, Date.now()),
          send: async () => (await import("../../_haven/meals.js")).sendWeek(blob, Date.now()),
          // A changed step's picture (#1027), queued like finalize's (#1016) under the library's cap; never made on open.
          stepPhotos: async (file) => {
            const [{ queueStepPhotos, livePhotoDeps }, { weekStepShots }] = await Promise.all([import("../../_haven/photos.js"), import("../../_haven/stepShots.js")]);
            return queueStepPhotos(weekStepShots(file), livePhotoDeps(env));
          },
        }
      : null,
    cart: {
      now: async () => {
        const [{ cartNow }, { krogerDeps }] = await Promise.all([import("../../_haven/kroger/route.js"), import("../../_haven/kroger/live.js")]);
        return cartNow(krogerDeps(env));
      },
      send: async (picks) => {
        const [{ sendPicks }, { krogerDeps }] = await Promise.all([import("../../_haven/kroger/route.js"), import("../../_haven/kroger/live.js")]);
        return sendPicks(krogerDeps(env), picks);
      },
    },
    homeAct: async (req) => {
      const { homeFromEnv } = await import("../../_haven/devices/live.js");
      const home = homeFromEnv(env);
      if (!home) return { ok: false, say: "The home devices aren't set up on this copy yet." };
      return home.act({
        action: req.action as ActionId,
        via: req.via ?? "desk",
        ...(req.said && { said: req.said }),
        ...(req.rooms && { rooms: req.rooms }),
        ...(req.portions !== undefined && { portions: req.portions }),
        ...(req.plate !== undefined && { plate: req.plate }),
        ...(req.suction && { suction: req.suction }),
        ...(req.water && { water: req.water }),
      });
    },
    lights: {
      view: async () => (await lightsOf(env)).view(),
      byName: async (words) => (await lightsOf(env)).byName(words),
      set: async (id, on) => (await lightsOf(env)).set(id, on),
      scene: async (id) => (await lightsOf(env)).scene(id),
    },
    placeLight: blob
      ? async (name, at) => {
          const { PlanStore, spotIn } = await import("../../_haven/plan.js");
          const store = new PlanStore(blob);
          let spot: { x: number; y: number } | null = null;
          if (at && "room" in at) {
            const plan = await store.read();
            if (!plan) return { ok: false, say: "There's no floor plan saved yet." };
            spot = spotIn(plan, at.room, at.where);
            if (!spot) return { ok: false, say: `No room on the plan is called ${at.room.slice(0, 40)}. Use a room's name as the Haven shows it.` };
          } else if (at) spot = at;
          const got = await store.placeLight(name, spot);
          if (got === "no-plan") return { ok: false, say: "There's no floor plan saved yet." };
          if (got === "bad") return { ok: false, say: "That spot didn't take: the map holds as many lights as it can." };
          const words = at && "room" in at ? ` in ${at.room.slice(0, 40)}${at.where === "middle" ? "" : ` (${WHERE_WORDS[at.where]})`}` : "";
          return { ok: true, say: spot ? `${name} is on the map${words}.` : `${name} is off the map.` };
        }
      : null,
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
    // The Desk library's plans (#1141): the Foundry's open issues, read with the read token and kept ten minutes.
    plans: async () => (await import("../desk.js")).livePlans(),
    skipTerms,
    now,
  };
}

const WHERE_WORDS: Record<string, string> = { n: "north wall", s: "south wall", e: "east wall", w: "west wall", ne: "north-east corner", nw: "north-west corner", se: "south-east corner", sw: "south-west corner" };

/** The lights (#931), loaded only when a lights tool runs; a stand-in that says so when their keys aren't set. */
async function lightsOf(env: Env) {
  const { lightsFromEnv } = await import("../../_haven/lights/live.js");
  const got = lightsFromEnv(env);
  if (got) return got;
  const no = { ok: false as const, code: "not-set-up" as const, say: "The lights aren't set up on this copy yet." };
  return {
    view: async () => ({ vendors: { switchbot: "waiting" as const, govee: "waiting" as const }, lights: [], scenes: [], remotes: [] }),
    byName: async () => null,
    set: async () => no,
    scene: async () => no,
  };
}

/** The pending taps' store, or null without the private store. */
export const livePending = (env: Env = process.env) => {
  const blob = pickBlob(env);
  return blob ? new BlobPending(blob) : null;
};
