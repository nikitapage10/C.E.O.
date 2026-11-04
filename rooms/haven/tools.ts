import type { RoomTool } from "@ceo/engine/tools";

const DAY = { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], description: "The night, Monday to Sunday." } as const;

/**
 * The Haven's tools for Skippy (#646): the Kitchen list, the meal planner's edits (#678: the same closed set of edits
 * the Kitchen's buttons make, api/_haven/mealShape.ts; Talk to edit drives these), and the home devices through their own rails (the feed cap,
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
    name: "meals_week",
    room: "haven",
    title: "Read the week's meal plan",
    description: "This week's dinners night by night (with how each is customized, HelloFresh nights and nights for two), each day's protein against the goal, the backups and what Nikita avoids. Read it before changing the plan.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
  {
    name: "meals_swap",
    room: "haven",
    title: "Swap a night's dinner",
    description: "Put a different meal on a night: one of that night's backups or any meal in the catalog, by its name. With not_for_me true instead, Nikita passes on the night's meal and its first backup takes its place. Undo is on the Kitchen page.",
    input: { type: "object", properties: { day: DAY, meal: { type: "string", maxLength: 80, description: "The meal's name, for a swap." }, not_for_me: { type: "boolean" } }, required: ["day"], additionalProperties: false },
    effect: "write",
  },
  {
    name: "meals_customize",
    room: "haven",
    title: "Customize a night's dinner",
    description:
      "Change a part of a night's meal: its protein, carb or side to another component (\"quinoa\", \"potatoes\", \"no carb\", \"chicken breast\", \"shrimp\", \"black beans\"), the portion (0.75, 1, 1.25 or 1.5) or the spice (mild, medium, hot). Protein, macros and the shopping list follow. reset true puts the meal back as written.",
    input: {
      type: "object",
      properties: {
        day: DAY,
        role: { type: "string", enum: ["protein", "carb", "side"] },
        option: { type: "string", maxLength: 40, description: "The new component, by name." },
        portion: { type: "string", enum: ["0.75", "1", "1.25", "1.5"] },
        spice: { type: "string", enum: ["mild", "medium", "hot"] },
        reset: { type: "boolean" },
      },
      required: ["day"],
      additionalProperties: false,
    },
    effect: "write",
  },
  {
    name: "meals_night",
    room: "haven",
    title: "Set a night: HelloFresh, for two",
    description: "Mark a night as a HelloFresh night (nothing to cook or buy for it), cook it for two, or leave it out of the cart.",
    input: { type: "object", properties: { day: DAY, hellofresh: { type: "boolean" }, for_two: { type: "boolean" }, in_cart: { type: "boolean" } }, required: ["day"], additionalProperties: false },
    effect: "write",
  },
  {
    name: "meals_avoid",
    room: "haven",
    title: "Avoid an ingredient",
    description: "Nikita doesn't want an ingredient (\"greek yogurt\"): it goes in the taste profile, and every night this week whose meal has it is swapped for a backup without it. unless names an ingredient that makes it fine (avocado unless tortilla chips). allow true takes the rule back off.",
    input: { type: "object", properties: { ingredient: { type: "string", maxLength: 40 }, unless: { type: "string", maxLength: 40 }, allow: { type: "boolean" } }, required: ["ingredient"], additionalProperties: false },
    effect: "write",
  },
  {
    name: "meals_send",
    room: "haven",
    title: "Send the week to the Kitchen list",
    description: "Put what the week's cooked nights need (HelloFresh and left-out nights skipped, staples left out) on the Kitchen list, where the King Soopers picks are matched. Nothing is bought.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "write",
  },
  {
    name: "meals_next_week",
    room: "haven",
    title: "Plan next week's meals",
    description: "Count this week's cooked meals as had and plan the next week from the catalog: seven dinners, no cuisine twice running, nothing avoided or passed on, the least-had first, two backups a night. Undo is on the Kitchen page.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
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
