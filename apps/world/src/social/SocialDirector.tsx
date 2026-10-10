import { useEffect } from "react";
import { useCast } from "../cast/castStore.ts";
import { agentPositions, clock } from "../clock.ts";
import { readingTime, useWorld } from "../store.ts";
import { EMOTE, EXCHANGES } from "./lines.ts";

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const CLOSE = 7.5;

function settled(id: string) {
  const rt = useWorld.getState().lattice.agents[id];
  if (!rt) return null;
  if (rt.motion && clock.sim < rt.motion.startTs + rt.motion.duration) return null;
  return rt;
}

/**
 * The Lattice's social life. Every so often, two agents with history who happen to be near each other turn,
 * face each other and have a moment: friends chat, rivals needle, partners flirt, exes are awkward.
 * Agents also say their catchphrases now and then. Renders nothing.
 */
export function SocialDirector() {
  useEffect(() => {
    const encounter = () => {
      const { cast } = useCast.getState();
      const world = useWorld.getState();
      const busy = (id: string) => {
        const o = world.overrides[id];
        return o && o.until > performance.now();
      };
      const candidates = cast.relationships.filter((r) => {
        const a = settled(r.a);
        const b = settled(r.b);
        if (!a || !b || a.place.room !== b.place.room || busy(r.a) || busy(r.b)) return false;
        const pa = agentPositions.get(r.a);
        const pb = agentPositions.get(r.b);
        return !!pa && !!pb && pa.distanceTo(pb) < CLOSE;
      });
      if (!candidates.length) return false;
      // Prefer the room you're looking at.
      const inFocus = candidates.filter((r) => world.lattice.agents[r.a]?.place.room === world.focus);
      const r = pick(inFocus.length ? inFocus : candidates);
      const nameA = cast.profiles[r.a]?.name ?? r.a;
      const nameB = cast.profiles[r.b]?.name ?? r.b;
      const [opener, reply] = pick(EXCHANGES[r.kind]);
      world.emote(r.a, EMOTE[r.kind], 6000);
      world.emote(r.b, EMOTE[r.kind], 6000);
      world.say(r.a, opener.replaceAll("{other}", nameB));
      const total = readingTime(opener) + readingTime(reply) + 1500;
      world.override(r.a, "face", total, r.b);
      world.override(r.b, "face", total, r.a);
      // The reply waits until the opener has been read.
      const opening = opener.replaceAll("{other}", nameB);
      setTimeout(() => useWorld.getState().say(r.b, reply.replaceAll("{other}", nameA)), readingTime(opening) * 0.8);
      return true;
    };
    const catchphrase = () => {
      const { cast } = useCast.getState();
      const world = useWorld.getState();
      const ids = Object.keys(world.lattice.agents).filter((id) => {
        const rt = settled(id);
        return rt && (!world.focus || rt.place.room === world.focus) && cast.profiles[id]?.personality.catchphrase;
      });
      if (!ids.length) return;
      const id = pick(ids);
      world.say(id, cast.profiles[id]!.personality.catchphrase);
    };
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(
        () => {
          if (document.visibilityState === "visible" && !encounter() && Math.random() < 0.5) catchphrase();
          loop();
        },
        9000 + Math.random() * 12000,
      );
    };
    loop();
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.encounter = encounter;
    return () => clearTimeout(timer);
  }, []);
  return null;
}
