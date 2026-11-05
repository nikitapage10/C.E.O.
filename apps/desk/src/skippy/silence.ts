/**
 * The one safety on a Talk call (#532): the site holds a call to no length, no minutes and no budget (the ElevenLabs
 * plan's credits are the only limit), but a call where nobody speaks for two minutes ends, so a forgotten open
 * microphone doesn't burn credits. Silence means no speech from Nikita and none from Skippy; any of either starts the
 * count again. The agent hangs up on its own side after the same two minutes (api/_skippy/voice.ts, VOICE_SILENCE_SECS).
 */
export const SILENCE_MS = 120_000;

/** How loud counts as speech (0 to 1, talkSession's level): a room's hum is well under it. */
export const SPEECH_LEVEL = 0.05;

/** How often the call looks at the level. */
export const SILENCE_CHECK_MS = 5_000;

export interface SilenceGuard {
  /** Somebody spoke (or the level says so): the silence starts over. */
  heard: () => void;
  /** The level just read, 0 to 1: loud enough counts as speech. */
  level: (v: number) => void;
  /** How long it has been quiet, in ms. */
  quietMs: () => number;
  /** Whether it has been quiet for the whole limit. */
  over: () => boolean;
}

export function silenceGuard(now: () => number = Date.now, limitMs: number = SILENCE_MS): SilenceGuard {
  let last = now();
  const heard = () => {
    last = now();
  };
  return {
    heard,
    level: (v) => {
      if (Number.isFinite(v) && v >= SPEECH_LEVEL) heard();
    },
    quietMs: () => Math.max(0, now() - last),
    over: () => now() - last >= limitMs,
  };
}
