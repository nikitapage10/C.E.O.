import { Conversation } from "@elevenlabs/client";

/**
 * The call itself (#434): ElevenLabs' own client (@elevenlabs/client), joined over WebRTC with the one-session token
 * our function minted. Loaded only when a call is first started (talk.ts), so none of it is in the Desk's first load.
 * The agent's rules and voice are set on the server; what is passed in is the Desk's state, as `desk`, and (#479) the
 * call's own key for its lookups, as the secret variable `secret__ceo_tool`: ElevenLabs puts it only in the tools'
 * header and never shows it to the model.
 */
export interface CallHandlers {
  token: string;
  desk: string;
  /** The call's tool token (#479), when Skippy's crew is up. */
  tool?: string;
  onMessage: (who: "nikita" | "skippy", text: string) => void;
  onMode: (mode: "listening" | "speaking") => void;
  /** A tool the agent called came back (#479): its name only. */
  onTool?: (name: string) => void;
  onEnd: () => void;
  onError: () => void;
}

/** The secret dynamic variable the lookups' header carries (api/_skippy/voicetoken.ts, TOOL_VAR). */
export const TOOL_VAR = "secret__ceo_tool";

export async function openCall(h: CallHandlers) {
  let speaking = false;
  const call = await Conversation.startSession({
    conversationToken: h.token,
    connectionType: "webrtc",
    textOnly: false,
    dynamicVariables: { desk: h.desk, ...(h.tool && { [TOOL_VAR]: h.tool }) },
    onMessage: ({ message, role }) => h.onMessage(role === "user" ? "nikita" : "skippy", message),
    onModeChange: ({ mode }) => {
      speaking = mode === "speaking";
      h.onMode(speaking ? "speaking" : "listening");
    },
    onAgentToolResponse: (r) => {
      if (r && typeof r.tool_name === "string") h.onTool?.(r.tool_name);
    },
    onDisconnect: () => h.onEnd(),
    onError: () => h.onError(),
  });
  return {
    level: () => Math.min(1, Math.max(0, speaking ? call.getOutputVolume() : call.getInputVolume())),
    /** A note for the agent that it doesn't speak by itself (ElevenLabs' contextual update): an answer that landed. */
    tell: (text: string) => call.sendContextualUpdate(text),
    end: () => call.endSession(),
  };
}
