import { Conversation } from "@elevenlabs/client";
import { agentOfEvent, roomOfAgent } from "../hologram/crew.ts";
import { holoEvents, setSpeaker } from "../hologram/signal.ts";

/**
 * The call itself (#434): ElevenLabs' own client (@elevenlabs/client), joined over WebRTC with the one-session token
 * our function minted. Loaded only when a call is first started (talk.ts), so none of it is in the Desk's first load.
 * The agent's rules and voice are set on the server; what is passed in is the Desk's state, as `desk`, and (#479) the
 * call's own key for its lookups, as the secret variable `secret__ceo_tool`: ElevenLabs puts it only in the tools'
 * header and never shows it to the model.
 *
 * Who has the mic (#491): every agent change puts that submind's can on the hologram (setSpeaker(room)), and Skippy's
 * own agent puts him back (setSpeaker(null)). ElevenLabs' agent lines carry no agent id over the socket (its agent
 * transfer docs: "individual messages do not carry an agent_id field"), so the change is read from the transfer
 * itself: the `transfer_to_agent` tool's result in `agent_tool_response_full_payload`, `{ to_agent, from_agent, ... }`,
 * which every agent sends since #491 (api/_skippy/voicecrew.ts, CLIENT_EVENTS). An `agent_metadata.agent_id` on any
 * event is read too, should ElevenLabs ever send one. `crew` is the call's start answer's map of agent id → submind id.
 */
export interface CallHandlers {
  token: string;
  desk: string;
  /** The call's tool token (#479), when Skippy's crew is up. */
  tool?: string;
  onMessage: (who: "nikita" | "skippy", text: string) => void;
  onMode: (mode: "listening" | "speaking") => void;
  /** ElevenLabs agent id → submind id, from /api/skippy-voice's start answer (#481). */
  crew?: Record<string, string>;
  /** The ElevenLabs agent that just took the mic (#481): Skippy's, or a submind's after a transfer. */
  onAgent?: (agentId: string) => void;
  /** A tool the agent called came back (#479): its name only. */
  onTool?: (name: string) => void;
  onEnd: () => void;
  onError: () => void;
}

/** The secret dynamic variable the lookups' header carries (api/_skippy/voicetoken.ts, TOOL_VAR). */
export const TOOL_VAR = "secret__ceo_tool";

/**
 * The agent a tool's result hands the mic to: the `to_agent` of a successful `transfer_to_agent` result (as the SDK's
 * onAgentToolResponse passes it, or wrapped as the raw socket event), else null.
 */
export function transferTarget(r: unknown): string | null {
  if (!r || typeof r !== "object") return null;
  return "agent_tool_response_full_payload" in r || "agent_tool_response" in r ? agentOfEvent(r) : agentOfEvent({ agent_tool_response_full_payload: r });
}

/** Follows who has the mic: each change of agent swaps the hologram's speaker (null is Skippy) and tells `onAgent`. */
export function speakerTracker(crew: Record<string, string>, onAgent?: (agentId: string) => void) {
  let current: string | null = null;
  return (agent: string | null) => {
    if (!agent || agent === current) return;
    current = agent;
    setSpeaker(roomOfAgent(agent, crew));
    onAgent?.(agent);
  };
}

export async function openCall(h: CallHandlers) {
  let speaking = false;
  const switchTo = speakerTracker(h.crew ?? {}, h.onAgent);
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
    // The hologram (#481): thinking while a lookup runs, annoyed when he's cut off, and who has the mic.
    onAgentToolRequest: () => holoEvents.toolStart(),
    onAgentToolResponse: (r) => {
      holoEvents.toolEnd();
      switchTo(transferTarget(r));
      if (r && typeof r.tool_name === "string") h.onTool?.(r.tool_name);
    },
    onInterruption: () => holoEvents.interrupted(),
    onIncomingEvent: (ev: unknown) => switchTo(agentOfEvent(ev)),
    onDisconnect: () => h.onEnd(),
    onError: () => h.onError(),
  });
  return {
    level: () => Math.min(1, Math.max(0, speaking ? call.getOutputVolume() : call.getInputVolume())),
    mute: (muted: boolean) => call.setMicMuted(muted),
    /** A note for the agent that it doesn't speak by itself (ElevenLabs' contextual update): an answer that landed. */
    tell: (text: string) => call.sendContextualUpdate(text),
    end: () => call.endSession(),
  };
}
