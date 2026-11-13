import type { RoomTool } from "@ceo/engine/tools";

/**
 * The Foundry's tools for Skippy (#646): its board, and "Implement it", which files a foundry issue for the Builder.
 * No code is ever written through the API (docs/SKIPPY.md); the issue is public, so it waits for Nikita's tap. Data only.
 */
export const TOOLS: readonly RoomTool[] = [
  {
    name: "foundry_board",
    room: "foundry",
    title: "Read the Foundry",
    description: "Read the Foundry's board: what is waiting for Nikita, what is building in which lane, the open pull requests and what shipped lately.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
  {
    name: "implement_it",
    room: "foundry",
    title: "File it for the Builder",
    description:
      "When Nikita asks you to build, fix, change or \"implement it\": file a foundry issue for the Builder with a short title and a plain pitch of what to build, in Nikita's terms. The issue is public on GitHub, so nothing private goes in it. It is filed at once when he asks (#1096: no tap), so say it's filed, never that it waits; never write code yourself.",
    input: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: 80, description: "A short title." },
        pitch: { type: "string", maxLength: 500, description: "What to build and why, plainly." },
        size: { type: "string", enum: ["small", "medium", "large"] },
      },
      required: ["title", "pitch", "size"],
      additionalProperties: false,
    },
    // A write, not a send (#1096, Nikita 2026-11-13: "I shouldn't have to press anything on the Desk"): build requests
    // file at once on every surface. Fetched web content still can't start it, and the privacy check still holds.
    effect: "write",
  },
];
