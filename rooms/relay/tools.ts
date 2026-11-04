import type { RoomTool } from "@ceo/engine/tools";

/**
 * Relay's tools for Skippy (#646): its counts (never a message, sender or contact) and a text for Blasto to draft.
 * The draft shows as Relay's own card on the Desk, which sends nothing until Nikita taps Send (docs/RELAY-PRIVACY.md).
 * Data only.
 */
export const TOOLS: readonly RoomTool[] = [
  {
    name: "relay_counts",
    room: "relay",
    title: "Read Relay's counts",
    description: "Read Relay's inbox counts and states: how many are waiting, sorted, or need Nikita. Counts only; you never see a message's words, sender or contact.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
  {
    name: "draft_text",
    room: "relay",
    title: "Have a text drafted",
    description:
      "When Nikita asks for a text message to be sent to someone: Relay's Blasto drafts it and the Desk shows a card with the contact's name, the last digits of the number and the exact text. Nothing is sent until Nikita taps Send on that card; never say it was sent.",
    input: {
      type: "object",
      properties: {
        who: { type: "string", maxLength: 60, description: "Who it goes to, exactly as Nikita named them; never a number or address." },
        text: { type: "string", maxLength: 300, description: "What he wants to say, in his words." },
      },
      required: ["who", "text"],
      additionalProperties: false,
    },
    effect: "send",
  },
];
