import type { RoomTool } from "@ceo/engine/tools";

/** The Boiler Room's tools for Skippy (#646): its pipes, read-only. Data only. */
export const TOOLS: readonly RoomTool[] = [
  {
    name: "boiler_pipes",
    room: "boiler",
    title: "Read the Boiler Room",
    description: "Read the Boiler Room's pipes: which of C.E.O.'s reads are answering, main's last checks and deploys, and how old the world step is.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
];
