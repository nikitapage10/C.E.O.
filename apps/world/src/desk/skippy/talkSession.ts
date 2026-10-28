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

/**
 * A reconnect must not replay the greeting (#537). The first `conversation_initiation_metadata` of a call is the start;
 * any later one is the link coming back, and the opener the agent may speak again then is dropped from the chat (the
 * first agent line of a call is its opener, so a repeat of it after a reconnect is the replay). Pure, for the tests.
 */
export function greetingGuard() {
  let starts = 0;
  let opener: string | null = null;
  let replay = false;
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  return {
    /** A raw event of the call: true when it marks a reconnect. */
    event(ev: unknown): boolean {
      if (!ev || typeof ev !== "object" || (ev as { type?: unknown }).type !== "conversation_initiation_metadata") return false;
      starts += 1;
      if (starts > 1) replay = true;
      return starts > 1;
    },
    /** An agent line: false when it is the opener coming back after a reconnect. */
    keep(text: string): boolean {
      if (opener === null) {
        opener = norm(text);
        return true;
      }
      if (replay && norm(text) === opener) {
        replay = false;
        return false;
      }
      if (replay) replay = false;
      return true;
    },
  };
}

export async function openCall(h: CallHandlers) {
  let speaking = false;
  const guard = greetingGuard();
  const call = await Conversation.startSession({
    conversationToken: h.token,
    connectionType: "webrtc",
    textOnly: false,
    dynamicVariables: { desk: h.desk, ...(h.tool && { [TOOL_VAR]: h.tool }) },
    onMessage: ({ message, role }) => {
      if (role === "user" && message.trim() === SPEAK_NOW) return;
      if (role !== "user" && !guard.keep(message)) return;
      h.onMessage(role === "user" ? "nikita" : "skippy", message);
    },
    onModeChange: ({ mode }) => {
      speaking = mode === "speaking";
      h.onMode(speaking ? "speaking" : "listening");
    },
    // The hologram (#481): thinking while a lookup runs, annoyed when he's cut off, and who has the mic.
    onAgentToolRequest: () => holoEvents.toolStart(),
    onAgentToolResponse: (r) => {
      holoEvents.toolEnd();
      if (r && typeof r.tool_name === "string") h.onTool?.(r.tool_name);
    },
    onInterruption: () => holoEvents.interrupted(),
    onIncomingEvent: (ev: unknown) => {
      guard.event(ev);
      holoEvents.event(ev);
    },
    onDisconnect: () => h.onEnd(),
    onError: () => h.onError(),
  });
  return {
    level: () => Math.min(1, Math.max(0, speaking ? call.getOutputVolume() : call.getInputVolume())),
    mute: (muted: boolean) => call.setMicMuted(muted),
    /** A note for the agent that it doesn't speak by itself (ElevenLabs' contextual update): an answer that landed. */
    tell: (text: string) => call.sendContextualUpdate(text),
    /**
     * An answer that landed (#506, #537): the note, then a turn asked for now. It goes in at once, even while an agent
     * is mid-sentence: the user turn cuts the agent off, so the answer is heard first and a stale line never finishes.
     */
    speakNow: (note: string) => {
      call.sendContextualUpdate(note);
      call.sendUserMessage(SPEAK_NOW);
    },
    end: () => call.endSession(),
  };
}
