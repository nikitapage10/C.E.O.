import type { RoomTool } from "@ceo/engine/tools";

/**
 * The Haven's tools for Skippy (#646): the Kitchen list, and the home devices through their own rails (the feed cap,
 * the litter gate, named rooms; api/_haven/devices/home.ts). A device acts only after Nikita's Yes tap. Data only.
 */
export const TOOLS: readonly RoomTool[] = [
  {
    name: "kitchen_add",
    room: "haven",
    title: "Add to the Kitchen list",
    description: "Put groceries or household things on the Kitchen list, one item per entry, in plain words (\"garlic\", \"oat milk\").",
    input: { type: "object", properties: { items: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 12 } }, required: ["items"], additionalProperties: false },
    effect: "write",
  },
  {
    name: "home_device",
    room: "haven",
    title: "Run a home device",
    description:
      "Ask a home device to do something: vacuum.start, vacuum.rooms (with rooms by name), vacuum.pause, vacuum.dock, feeder.feed (portions, under the daily cap), wet.open, wet.rotate, wet.close, litter.clean. It runs only after Nikita taps Yes, through the device's own rails.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["vacuum.start", "vacuum.rooms", "vacuum.pause", "vacuum.dock", "feeder.feed", "wet.open", "wet.rotate", "wet.close", "litter.clean"] },
        rooms: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 8, description: "For vacuum.rooms: the rooms by name." },
        portions: { type: "integer", minimum: 1, maximum: 4, description: "For feeder.feed: dry portions." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    confirm: true,
  },
];
