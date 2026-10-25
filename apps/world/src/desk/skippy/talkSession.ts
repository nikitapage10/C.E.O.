import { Conversation } from "@elevenlabs/client";

/**
 * The call itself (#434): ElevenLabs' own client (@elevenlabs/client), joined over WebRTC with the one-session token
 * our function minted. Loaded only when a call is first started (talk.ts), so none of it is in the Desk's first load.
 * The agent's rules and voice are set on the server; the only thing passed in is the Desk's state, as `desk`.
 */
export interface CallHandlers {
  token: string;
  desk: string;
  onMessage: (who: "nikita" | "skippy", text: string) => void;
  onMode: (mode: "listening" | "speaking") => void;
  onEnd: () => void;
  onError: () => void;
}

export async function openCall(h: CallHandlers) {
  let speaking = false;
  const call = await Conversation.startSession({
    conversationToken: h.token,
    connectionType: "webrtc",
    textOnly: false,
    dynamicVariables: { desk: h.desk },
    onMessage: ({ message, role }) => h.onMessage(role === "user" ? "nikita" : "skippy", message),
    onModeChange: ({ mode }) => {
      speaking = mode === "speaking";
      h.onMode(speaking ? "speaking" : "listening");
    },
    onDisconnect: () => h.onEnd(),
    onError: () => h.onError(),
  });
  return {
    level: () => Math.min(1, Math.max(0, speaking ? call.getOutputVolume() : call.getInputVolume())),
    end: () => call.endSession(),
  };
}
