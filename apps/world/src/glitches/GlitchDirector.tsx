import { ROOM_IDS, type RoomId } from "@ceo/core";
import { useCallback, useEffect, useRef } from "react";
import { clock } from "../clock.ts";
import { PARAMS } from "../params.ts";
import { useWorld, type ActiveGlitch } from "../store.ts";
import { COUNSEL_MEMOS, HUD_PEEKS, IDLE, LEGAL_SWEEP, NOTICED, STARES, WELCOME_BACK } from "./lines.ts";
import { GLITCHES, GLITCH_BY_ID, type GlitchDef } from "./registry.ts";
import { legalFollowUp, nextDelay, pickGlitch } from "./scheduler.ts";
import { playBlip, playChime, playHandshake } from "./sound.ts";

const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const IDLE_MS = 45_000;
const NOTICE_MS = 1500;

function agentsIn(room: RoomId | null): string[] {
  const agents = Object.values(useWorld.getState().lattice.agents);
  if (!room) return agents.map((a) => a.agent.id);
  const inRoom = agents.filter((a) => a.place.room === room);
  // Motion records linger after arrival; an agent is settled once its walk has finished.
  const settled = inRoom.filter((a) => !a.motion || clock.sim >= a.motion.startTs + a.motion.duration);
  return (settled.length ? settled : inRoom.length ? inRoom : agents).map((a) => a.agent.id);
}

/** Decides when the Lattice glitches, and what happens around it. Renders nothing. */
export function GlitchDirector() {
  const level = useWorld((s) => s.glitchLevel);
  const lastFired = useRef<Record<string, number>>({});
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fire = useCallback((def: GlitchDef) => {
    const store = useWorld.getState();
    if (endTimer.current) clearTimeout(endTimer.current);
    const focus = store.focus;
    const room: RoomId | null =
      def.where === "hud" ? focus : focus ?? (def.where === "sky" ? null : def.where === "anywhere" ? pick(ROOM_IDS) : def.where);
    const candidates = agentsIn(room);
    const agentId = candidates.length ? pick(candidates) : null;
    const legal = legalFollowUp(def, Math.random);
    const line =
      def.id === "stare" ? pick(STARES) : def.id === "hud-peek" ? pick(HUD_PEEKS) : def.id === "counsel-memo" ? pick(COUNSEL_MEMOS) : "";
    const g: ActiveGlitch = { id: def.id, startedAt: performance.now(), durationMs: def.durationMs, room, legal, agentId, line };
    lastFired.current[def.id] = g.startedAt;
    store.startGlitch(g);

    // Side effects that make the rest of the Lattice react.
    if (agentId) {
      if (def.id === "stare") {
        store.override(agentId, "stare", def.durationMs);
        store.say(agentId, line);
      } else if (def.id === "tamagotchi") {
        store.override(agentId, "staring", def.durationMs);
        store.say(agentId, "Not now, Tamago— I mean, generic chest pet.");
      } else if (def.id === "legal-sweep") {
        for (const id of agentsIn(room).slice(0, 6)) store.override(id, "stare", def.durationMs * 0.8);
        store.say(agentId, pick(LEGAL_SWEEP));
      } else if (def.kind === "intrusion" && Math.random() < 0.35) {
        // Someone stops working to look. Nobody says anything. Then they do.
        setTimeout(() => {
          useWorld.getState().override(agentId, "staring", 2500);
        }, def.durationMs * 0.3);
      }
    }
    if (store.sound) {
      if (def.id === "dial-up") playHandshake();
      else if (def.id === "youve-got-mail") playChime();
      else playBlip();
    }

    const length = legal === "yank" ? def.durationMs * 0.8 : def.durationMs;
    endTimer.current = setTimeout(() => {
      if (useWorld.getState().activeGlitch?.startedAt === g.startedAt) useWorld.getState().endGlitch();
    }, length);
  }, []);

  // The schedule.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = nextDelay(level, Math.random);
      if (delay === null) return;
      timer = setTimeout(() => {
        const s = useWorld.getState();
        if (!s.activeGlitch && document.visibilityState === "visible") {
          const def = pickGlitch(GLITCHES, Math.random, performance.now(), lastFired.current);
          if (def) fire(def);
        }
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [level, fire]);

  // Debug hooks: ?glitch=<id>, and window.__ceo.fireGlitch(id).
  useEffect(() => {
    const api = ((window as unknown as { __ceo?: Record<string, unknown> }).__ceo ??= {});
    api.fireGlitch = (id: string) => {
      const def = GLITCH_BY_ID[id];
      if (!def) throw new Error(`Unknown glitch "${id}". Try: ${Object.keys(GLITCH_BY_ID).join(", ")}`);
      fire(def);
    };
    api.glitchIds = Object.keys(GLITCH_BY_ID);
    if (PARAMS.glitch && GLITCH_BY_ID[PARAMS.glitch]) {
      const t = setTimeout(() => fire(GLITCH_BY_ID[PARAMS.glitch!]!), 2500);
      return () => clearTimeout(t);
    }
  }, [fire]);

  // Reactive fourth wall: linger on an agent and it notices you.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const noticedAt: Record<string, number> = {};
    const unsub = useWorld.subscribe((s, prev) => {
      if (s.hoveredAgent === prev.hoveredAgent) return;
      if (timer) clearTimeout(timer);
      const id = s.hoveredAgent;
      if (!id || s.glitchLevel === "off") return;
      timer = setTimeout(() => {
        const st = useWorld.getState();
        if (st.hoveredAgent !== id || performance.now() - (noticedAt[id] ?? -Infinity) < 20_000) return;
        noticedAt[id] = performance.now();
        st.override(id, "stare", 3500);
        st.say(id, pick(NOTICED));
      }, NOTICE_MS);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Reactive fourth wall: leave them alone and they notice that too.
  useEffect(() => {
    let lastInput = performance.now();
    let slacking = false;
    const onInput = () => {
      lastInput = performance.now();
      if (!slacking) return;
      slacking = false;
      const s = useWorld.getState();
      if (s.glitchLevel === "off") return;
      const ids = agentsIn(s.focus);
      if (ids.length) s.say(pick(ids), pick(WELCOME_BACK));
      for (const id of ids.slice(0, 5)) s.override(id, "typing", 4000);
    };
    const check = setInterval(() => {
      const s = useWorld.getState();
      if (slacking || s.glitchLevel === "off" || performance.now() - lastInput < IDLE_MS) return;
      slacking = true;
      const ids = agentsIn(s.focus);
      if (ids.length) s.say(pick(ids), pick(IDLE));
      for (const id of ids.slice(0, 4)) s.override(id, "celebrating", 5000);
    }, 3000);
    window.addEventListener("pointermove", onInput);
    window.addEventListener("keydown", onInput);
    return () => {
      clearInterval(check);
      window.removeEventListener("pointermove", onInput);
      window.removeEventListener("keydown", onInput);
    };
  }, []);

  return null;
}
