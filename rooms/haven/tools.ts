import type { RoomTool } from "@ceo/engine/tools";

const DAY = { type: "string", enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], description: "The night, Monday to Sunday." } as const;

/**
 * The Haven's tools for Skippy (#646): the Kitchen list, the meal planner's edits (#678: the same closed set of edits
 * the Kitchen's buttons make, api/_haven/mealShape.ts; Talk to edit drives these), the home's read (#926: the thermostat
 * first, api/_haven/devices/homeread.ts) and the home devices through their own rails (the feed cap, the litter gate,
 * named rooms; api/_haven/devices/home.ts). Typed, a device acts only after Nikita's Yes tap; spoken, when his own words
 * asked for it (api/_skippy/agent/tools.ts). Data only.
 */
export const TOOLS: readonly RoomTool[] = [
  {
    name: "kitchen_add",
    room: "haven",
    title: "Add to the Kitchen list",
    description: "Put groceries and kitchen things on the Kitchen list, one item per entry, in plain words (\"garlic\", \"oat milk\", \"dish soap\"). Anything that isn't groceries, or that he says is for Amazon, goes on buy_add instead.",
    input: { type: "object", properties: { items: { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 12 } }, required: ["items"], additionalProperties: false },
    effect: "write",
  },
  {
    name: "meals_week",
    room: "haven",
    title: "Read the week's meal plan",
    description: "This week's dinners and lunches day by day (with how each is customized, HelloFresh nights and nights for two), each day's protein against the goal, the backups and what Nikita avoids. Read it before changing the plan.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
  {
    name: "meals_swap",
    room: "haven",
    title: "Swap a night's dinner or a day's lunch",
    description: "Put a different meal on a night: one of that night's backups or any meal in the catalog, by its name. With not_for_me true instead, Nikita passes on the night's meal and its first backup takes its place. With lunch true it's the day's lunch instead: a quick lunch from the catalog by its name, or meal \"leftovers\" for last night's leftovers (not on Monday). Undo is on the Kitchen page.",
    input: { type: "object", properties: { day: DAY, meal: { type: "string", maxLength: 80, description: "The meal's name, for a swap." }, not_for_me: { type: "boolean" }, lunch: { type: "boolean", description: "The day's lunch, not the dinner." } }, required: ["day"], additionalProperties: false },
    effect: "write",
  },
  {
    name: "meals_customize",
    room: "haven",
    title: "Customize a night's dinner",
    description:
      "Change one night's meal: a part to another component by name (option: \"quinoa\", \"brown rice\", \"potatoes\", \"no carb\", \"no rice\", \"chicken breast\", \"shrimp\", \"black beans\"; role only when the name could be either), the portion (0.75, 1, 1.25 or 1.5; \"a bigger portion\" is 1.25) or that night's spice (mild, medium, hot). Protein, macros and the shopping list follow. reset true puts the meal back as written. For heat in general (\"I like it spicier\"), use meals_taste.",
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
    title: "Set a night: HelloFresh, for two, skip",
    description:
      "Mark a night as a HelloFresh night (nothing to cook or buy for it), cook it for two, or leave it out of the cart. skip skips that day's dinner, its lunch, or the whole day (\"skip dinner Friday\", \"I'm eating out Saturday\"): it stays planned but nothing is cooked or bought for it. reason is why, only when he says it (out: eating out; leftovers). unskip true has the skipped meal (or the day, with skip \"day\") again.",
    input: {
      type: "object",
      properties: {
        day: DAY,
        hellofresh: { type: "boolean" },
        for_two: { type: "boolean" },
        in_cart: { type: "boolean" },
        skip: { type: "string", enum: ["dinner", "lunch", "day"] },
        reason: { type: "string", enum: ["out", "leftovers"] },
        unskip: { type: "boolean" },
      },
      required: ["day"],
      additionalProperties: false,
    },
    effect: "write",
  },
  {
    name: "meals_avoid",
    room: "haven",
    title: "Avoid an ingredient",
    description: "Nikita doesn't like or doesn't want an ingredient (\"I don't like mushrooms\", \"no more greek yogurt\", \"I'm off shrimp\"): it goes in the taste profile's avoid list, and every night this week whose meal has it is swapped for a backup without it. unless names an ingredient that makes it fine (avocado unless tortilla chips). allow true takes the rule back off (\"mushrooms are fine again\").",
    input: { type: "object", properties: { ingredient: { type: "string", maxLength: 40 }, unless: { type: "string", maxLength: 40 }, allow: { type: "boolean" } }, required: ["ingredient"], additionalProperties: false },
    effect: "write",
  },
  {
    name: "meals_taste",
    room: "haven",
    title: "Note a taste",
    description:
      "The taste profile beyond avoids: like is something Nikita likes or wants more of (\"I love salmon\", \"more chicken\", \"spicy food\"), planned first when a week is made; unlike takes one back off. heat is how hot every night is cooked from now on (\"more spicy\", \"I like it spicier\" is hot; \"milder\" is mild; as-written goes back to each recipe's own); a night's own spice still wins. protein_goal is the daily protein goal in grams. Give only what he said.",
    input: {
      type: "object",
      properties: {
        like: { type: "string", maxLength: 40 },
        unlike: { type: "string", maxLength: 40 },
        heat: { type: "string", enum: ["mild", "medium", "hot", "as-written"] },
        protein_goal: { type: "integer", minimum: 40, maximum: 400 },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "write",
  },
  {
    name: "meals_undo",
    room: "haven",
    title: "Undo the last meal change",
    description: "Takes back the last change to the meal plan or the taste profile (the Kitchen page's Undo), when Nikita says undo that or put it back.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
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
    name: "meals_cart",
    room: "haven",
    title: "Send the picks to King Soopers",
    description: "Add the Kitchen list's matched King Soopers picks (as the Kitchen page shows them) to Nikita's King Soopers cart, when he asks to send the groceries or the week to King Soopers or his cart. Run meals_send first if the week's shopping isn't on the list yet. Nothing is bought: he checks out in the King Soopers app.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "send",
    confirm: true,
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
    name: "home_status",
    room: "haven",
    title: "Read the home",
    description:
      "The home right now: the thermostat's inside temperature, humidity, mode and set point (the apartment's temperature), then the vacuum (and its next scheduled clean), the dry and wet food feeders (the lid, the bowl in front, the next meal), the fountain and the Litter-Robot. about \"climate\" for the temperature alone; \"wet-feeder\" for the next wet meal, the bowls and the wet schedule; \"dry-feeder\" for the next dry meal; \"feeders\" for both; \"vacuum\" for the vacuum and its schedule from the Roborock app. Any question about when a feeder or the vacuum runs next: call this, never ask Nikita to rephrase. Instant: the last good reading answers when the devices' clouds are slow.",
    input: { type: "object", properties: { about: { type: "string", enum: ["all", "climate", "wet-feeder", "dry-feeder", "feeders", "vacuum"] } }, required: [], additionalProperties: false },
    effect: "read",
  },
  {
    name: "home_device",
    room: "haven",
    title: "Run a home device",
    description:
      "Ask a home device to do something: vacuum.start, vacuum.rooms (with rooms by name), vacuum.pause, vacuum.dock, feeder.feed (portions, under the daily cap), wet.open ('open the wet food tray': opens the bowl in front for two hours, then it closes itself; asked again while open, the two hours start over; a scheduled meal inside the window takes over the closing), wet.rotate, wet.close (closes it now and cancels the auto-close), litter.clean. Typed on the Desk it runs after Nikita taps Yes; spoken (a room's mic, hold Space, the phone, a call) it runs when his own words asked for that device, as the phone always has. Either way the device's own rails apply (the feed cap, the litter gate). Tell Nikita the time it closes from the reply.",
    input: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["vacuum.start", "vacuum.rooms", "vacuum.pause", "vacuum.dock", "feeder.feed", "wet.open", "wet.rotate", "wet.close", "litter.clean"] },
        rooms: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 8, description: "For vacuum.rooms: the rooms by name." },
        portions: { type: "integer", minimum: 1, maximum: 4, description: "For feeder.feed: dry portions." },
        plate: { type: "integer", minimum: 1, maximum: 3, description: "For wet.rotate: the bowl to bring to the front." },
        suction: { type: "string", enum: ["quiet", "max"], description: "For the vacuum: quiet or max suction, only when he says." },
        water: { type: "string", enum: ["off", "on"], description: "For the vacuum: mop off (vacuum only) or on, only when he says." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    confirm: true,
  },
  // The lights (#931): SwitchBot and Govee, through api/_haven/lights. Reading is free; a switch or a scene changes
  // the home, so it waits for Nikita's Yes like the other devices.
  {
    name: "lights_list",
    room: "haven",
    title: "Read the lights",
    description: "The home's lights with each one's on or off, the SwitchBot scenes (such as 'Turn off lights'), and the infrared remotes (the projector), by the names the apps give them. Read it before lights_set or lights_scene to get a name right.",
    input: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
  },
  {
    name: "lights_set",
    room: "haven",
    title: "Switch a light",
    description: "Turn one light, or an infrared remote such as the projector, on or off, by its name from lights_list. For every light at once, run the scene instead (lights_scene). It runs only after Nikita taps Yes.",
    input: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 60, description: "The light's or remote's name, as lights_list gives it." },
        on: { type: "boolean", description: "true for on, false for off." },
      },
      required: ["name", "on"],
      additionalProperties: false,
    },
    effect: "write",
    confirm: true,
  },
  {
    name: "lights_scene",
    room: "haven",
    title: "Run a lights scene",
    description: "Run one of the SwitchBot app's manual scenes by its name from lights_list (e.g. 'Turn off lights'). It runs only after Nikita taps Yes.",
    input: {
      type: "object",
      properties: { name: { type: "string", maxLength: 60, description: "The scene's name, as lights_list gives it." } },
      required: ["name"],
      additionalProperties: false,
    },
    effect: "write",
    confirm: true,
  },
];
