import type { RoomTool } from "@ceo/engine/tools";

/**
 * Skippy's own tools on Today (#646): his private memory of Nikita, behind the passkey (api/_skippy/agent/memory.ts).
 * Looking things up (and at the screen, #1027) changes nothing; saving or forgetting a fact waits for Nikita's Yes tap. And the Things to buy list
 * (#735, api/_haven/list.ts), shown with every list on Today. Data only.
 */
export const TOOLS: readonly RoomTool[] = [
  {
    name: "buy_add",
    room: "today",
    title: "Add to Things to buy",
    description:
      "Put things that aren't groceries on the Things to buy list (his Amazon list: a phone charger, batteries, a desk lamp), one item per entry, in plain words. Use it when he says Amazon, \"things to buy\" or \"I need to buy\" something that isn't food. Groceries go on kitchen_add. Nothing is bought.",
    input: { type: "object", properties: { items: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 12 } }, required: ["items"], additionalProperties: false },
    effect: "write",
  },
  {
    name: "look_at_screen",
    room: "today",
    title: "Looked at the screen",
    description:
      "See the page Nikita is looking at, as a picture. <screen> already says the room, the tab and the open item: use it first, and call this only when that isn't enough: he points at something visual (\"this glitch\", \"that weird box\", \"what's wrong here\", \"why does this look off\"), or \"this\" can't be worked out from <screen>. Always call it before filing a fix for something on his screen with implement_it, so the Builder gets the picture. The page is captured in his browser without asking him and kept privately; never on the phone shortcut or a call.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
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
