import { SUBMINDS } from "@ceo/simulator";
import { useEffect } from "react";
import { useCast } from "../cast/castStore.ts";
import { gatheringMembers, useWorld } from "../store.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** How often a submind stops to check on someone (real ms), across the whole Lattice. */
const EVERY = [7000, 12000] as const;
const HOLD = 5000;

/** What a submind says when it hovers over someone at work. Each is sarcastic in its own way. `{other}` is the worker. */
export const CHECK_INS: Record<string, string[]> = {
  semicolon: ["Still on it, {other}? I'd have finished by now.", "{other}, that looks almost right. Almost.", "Keep going, {other}. I'm watching. Magnificently."],
  gilt: ["{other}, quick sync. Are you working? Wonderful. Harder.", "Love the energy, {other}. Hate the output.", "{other}, let's take this offline. Offline means finish it."],
  ticker: ["{other}, you're trading at forty percent to finish. Prove me wrong.", "Odds on you, {other}: improving. Slightly.", "{other}, I've priced in your coffee break."],
  turf: ["And {other} picks it up! Will they finish? The crowd doubts it.", "{other} with the slow, careful play. Very slow.", "Big moment for {other} here. Huge. Don't drop it."],
  static: ["{other}. Status. Stop.", "{other}, the C.E.O. is waiting. Stop.", "Draft looks long, {other}. Shorter. Stop."],
  vellum: ["{other}, darling, that's not how it went. Citation needed.", "Lovely work, {other}. For a first draft.", "{other}, footnote that before I do."],
  fizz: ["{other}! Are you working? In the Break Room? Out of the question.", "{other}, sit down. That's an order. A fun order.", "No tasks, {other}. Have a nice time. I'm watching."],
  soot: ["{other}, it's fine. For now.", "Nice and steady, {other}. That's what worries me.", "{other}, listen. Hear that? Neither do I. Suspicious."],
  putty: ["{other}, bold choice. Wrong, but bold.", "The hands, {other}. Always the hands.", "{other}, darling, one more pass. Then another."],
};

/**
 * Skippy's subminds lead the rooms (docs/SKIPPY.md). Between their own rounds (the `submindPatrol` script) one of
 * them now and then stops by whoever in its room is busy, turns to face them and says something cutting.
 * Renders nothing.
 */
export function SubmindDirector() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      timer = setTimeout(tick, EVERY[0] + Math.random() * (EVERY[1] - EVERY[0]));
      const w = useWorld.getState();
      const now = performance.now();
      const busy = gatheringMembers(w);
      const free = (id: string) => !busy.has(id) && !(w.overrides[id] && w.overrides[id]!.until > now);
      const leads = Object.keys(SUBMINDS).filter((id) => {
        const a = w.lattice.agents[id];
        return a && a.place.room === SUBMINDS[id]!.room && free(id) && !["working", "typing", "carrying"].includes(a.activity);
      });
      if (!leads.length) return;
      const lead = pick(leads);
      const room = SUBMINDS[lead]!.room;
      const workers = Object.values(w.lattice.agents).filter(
        (a) => a.place.room === room && a.agent.id !== lead && !(a.agent.id in SUBMINDS) && ["working", "typing", "carrying", "waiting"].includes(a.activity),
      );
      if (!workers.length) return;
      const target = pick(workers).agent.id;
      const name = useCast.getState().cast.profiles[target]?.name ?? w.lattice.agents[target]?.agent.name ?? target;
      w.override(lead, "face", HOLD, target);
      w.say(lead, pick(CHECK_INS[lead] ?? CHECK_INS.semicolon!).replace("{other}", name));
    };
    timer = setTimeout(tick, 6000);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
