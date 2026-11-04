import type { RoomTool } from "@ceo/engine/tools";

/**
 * Skippy's own tools on Today (#646): his private memory of Nikita, behind the passkey (api/_skippy/agent/memory.ts).
 * Looking things up changes nothing; saving or forgetting a fact waits for Nikita's Yes tap. Data only.
 */
export const TOOLS: readonly RoomTool[] = [
  {
    name: "memory_lookup",
    room: "today",
    title: "Looked in my memory",
    description:
      "Search your private memory of Nikita (knowledge pages by topic and facts he confirmed) when an answer depends on who he is, what he likes, what he told you before or what was decided. Returns matching titles and summaries with their ids; call memory_read with an id for the whole page. Never needed for live room data.",
    input: { type: "object", properties: { query: { type: "string", maxLength: 120, description: "A few words: the topic or the thing to find." } }, required: ["query"], additionalProperties: false },
    effect: "read",
  },
  {
    name: "memory_read",
    room: "today",
    title: "Read a memory page",
    description: "Read one whole knowledge page or fact from your memory, by the id memory_lookup gave.",
    input: { type: "object", properties: { id: { type: "string", maxLength: 24 } }, required: ["id"], additionalProperties: false },
    effect: "read",
  },
  {
    name: "remember",
    room: "today",
    title: "Remember a fact",
    description:
      "Propose a fact about Nikita to keep in memory, when he says \"remember that…\" or tells you something lasting about himself. One plain sentence in his words. It is saved only after he taps Yes. Never money, legal matters, IDs, account numbers, contacts or anyone's private details.",
    input: {
      type: "object",
      properties: {
        fact: { type: "string", maxLength: 300, description: "The fact, one plain sentence." },
        topic: { type: "string", maxLength: 40, description: "One or two words: the topic it files under." },
      },
      required: ["fact", "topic"],
      additionalProperties: false,
    },
    effect: "write",
    confirm: true,
  },
  {
    name: "forget",
    room: "today",
    title: "Forget a fact",
    description: "Propose deleting one fact from your memory, by the id memory_lookup gave, when Nikita asks you to forget it. It is deleted only after he taps Yes.",
    input: { type: "object", properties: { id: { type: "string", maxLength: 24 } }, required: ["id"], additionalProperties: false },
    effect: "delete",
  },
];
