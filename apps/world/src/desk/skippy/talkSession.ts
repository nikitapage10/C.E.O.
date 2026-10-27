import { Conversation } from "@elevenlabs/client";
import { holoEvents } from "../hologram/signal.ts";

/**
 * The call itself (#434): ElevenLabs' own client (@elevenlabs/client), joined over WebRTC with the one-session token
 * our function minted. Loaded only when a call is first started (talk.ts), so none of it is in the Desk's first load.
 * The agent's rules and voice are set on the server; what is passed in is the Desk's state, as `desk`, and (#479) the
 * call's own key for its lookups, as the secret variable `secret__ceo_tool`: ElevenLabs puts it only in the tools'
 * header and never shows it to the model.
 *
 * Who has the mic (#491, #490): every raw event of the call goes to the hologram's `holoEvents.event`
 * (hologram/signal.ts), which swaps the speaker on a transfer and puts Skippy back when the mic returns. Every agent
 * sends `agent_tool_response_full_payload` since #491 (api/_skippy/voicecrew.ts, CLIENT_EVENTS), whose transfer result
 * names the agent taking the mic; without it, signal.ts works the target out from the lines. talk.ts gives it the
 * call's crew (`setCrew`) so agent ids resolve to rooms.
 */
export interface CallHandlers {
  token: string;
  desk: string;
  /** The call's tool token (#479), when Skippy's crew is up. */
  tool?: string;
  onMessage: (who: "nikita" | "skippy", text: string) => void;
  onMode: (mode: "listening" | "speaking") => void;
  /** The ElevenLabs agent that just took the mic: only a stand-in call (the browser tests) reports it; the real one goes through holoEvents. */
  onAgent?: (agentId: string) => void;
  /** A tool the agent called came back (#479): its name only. */
  onTool?: (name: string) => void;
  onEnd: () => void;
  onError: () => void;
}

/**
 * What makes the agent speak an answer the moment it lands (#506). A contextual update alone waits for Nikita's next
 * turn, which is how a landed answer sat unspoken while Skippy said "still nothing"; this user message after it asks
 * for the turn now. Never shown in the chat.
 */
export const SPEAK_NOW = "(The answer I was waiting on just landed. Tell me now.)";

/** The secret dynamic variable the lookups' header carries (api/_skippy/voicetoken.ts, TOOL_VAR). */
export const TOOL_VAR = "secret__ceo_tool";

export async function openCall(h: CallHandlers) {
  let speaking = false;
  // An answer that lands while an agent is mid-sentence waits for the end of it (#521): a user turn sent now would cut
  // the agent off.
  let waiting: (() => void) | null = null;
  const call = await Conversation.startSession({
    conversationToken: h.token,
    connectionType: "webrtc",
    textOnly: false,
    dynamicVariables: { desk: h.desk, ...(h.tool && { [TOOL_VAR]: h.tool }) },
    onMessage: ({ message, role }) => {
      if (role === "user" && message.trim() === SPEAK_NOW) return;
      h.onMessage(role === "user" ? "nikita" : "skippy", message);
    },
    onModeChange: ({ mode }) => {
      speaking = mode === "speaking";
      if (!speaking && waiting) {
        const go = waiting;
        waiting = null;
        go();
      }
      h.onMode(speaking ? "speaking" : "listening");
    },
    // The hologram (#481): thinking while a lookup runs, annoyed when he's cut off, and who has the mic.
    onAgentToolRequest: () => holoEvents.toolStart(),
    onAgentToolResponse: (r) => {
      holoEvents.toolEnd();
      if (r && typeof r.tool_name === "string") h.onTool?.(r.tool_name);
    },
    onInterruption: () => holoEvents.interrupted(),
    onIncomingEvent: (ev: unknown) => holoEvents.event(ev),
    onDisconnect: () => h.onEnd(),
    onError: () => h.onError(),
  });
  return {
    level: () => Math.min(1, Math.max(0, speaking ? call.getOutputVolume() : call.getInputVolume())),
    mute: (muted: boolean) => call.setMicMuted(muted),
    /** A note for the agent that it doesn't speak by itself (ElevenLabs' contextual update): an answer that landed. */
    tell: (text: string) => call.sendContextualUpdate(text),
    /** An answer that landed (#506): the note, then a turn asked for now, so he says it straight away. */
    speakNow: (note: string) => {
      const go = () => {
        call.sendContextualUpdate(note);
        call.sendUserMessage(SPEAK_NOW);
      };
      if (speaking) waiting = go;
      else go();
    },
    end: () => call.endSession(),
  };
}
