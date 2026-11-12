import { readMeals, type MealsFile } from "./mealShape.ts";

/**
 * A made-up meal planner file (#678) for the tests and the browser tests: ten generic dinners, three quick lunches and a week. Never
 * Nikita's catalog or taste profile, which live only in the Haven's private store.
 */

const ing = (item: string, qty: number, unit: string) => ({ item, qty, unit });
const meal = (id: string, cuisine: string, protein: number, parts: Array<[string, string]>, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.replace(/-/g, " "),
  cuisine,
  minutes: 30,
  blurb: "",
  // Every recipe here is written to the bar in api/_haven/cookSteps.ts (#1036); a meal without its own steps has none.
  steps: [] as string[],
  ingredients: [ing("Garlic", 2, "clove"), ing("Salt", 1, "tsp"), { item: "Olive oil", qty: 1, unit: "tbsp", pantry: true }],
  parts: parts.map(([role, option]) => ({ role, option })),
  macros: { protein, carbs: 80, fat: 30, kcal: 900 },
  photo: id,
  ...extra,
});
const lunch = (leftoverOf: number | null) => ({ text: leftoverOf === null ? "Salad" : "Leftovers", protein: 50, leftoverOf, shop: [] });
/** A quick lunch from the catalog (#719), with its two backups. */
const quick = (meal: string, backups: string[]) => ({ text: meal, protein: 0, leftoverOf: null, shop: [], meal, backups });

/** Ten made-up dinners, three quick lunches and a week of seven, a fresh copy each call. */
export function fakeMeals(): MealsFile {
  const catalog = [
    meal("beef-bowl", "Korean", 80, [
      ["protein", "ground-beef"],
      ["carb", "jasmine-rice"],
      ["side", "kimchi"],
    ], { steps: [
      "Rinse the jasmine rice, bring it to a boil with 1¼ times its volume of water and a pinch of salt, then cover and simmer on low until the water is gone, 15 min; rest 5 min off the heat.",
      "Mince the garlic while the rice cooks.",
      "Brown the ground beef in a wide skillet over medium-high heat, breaking it up, until no pink remains and the edges crisp, 6–8 min; spoon off the excess fat.",
      "Stir in the garlic and cook until fragrant, about 30 s, then season with salt.",
      "Fluff the jasmine rice, spoon the ground beef over it and serve the kimchi cold on the side.",
    ] }),
    meal("steak-bowl", "Korean", 78, [
      ["protein", "sirloin"],
      ["carb", "jasmine-rice"],
    ], { steps: [
      "Rinse the jasmine rice, bring it to a boil with 1¼ times its volume of water and a pinch of salt, then cover and simmer on low until the water is gone, 15 min; rest 5 min off the heat.",
      "Pat the sirloin steak dry, season it with salt and let it sit while the pan heats.",
      "Sear the sirloin steak in a smoking-hot oiled skillet over high heat until deeply browned, 3–4 min a side for medium-rare (130°F inside).",
      "Rest the steak 5 min, then slice it thin against the grain.",
      "Lower the heat to medium, cook the minced garlic in the steak fat until golden, about 30 s, and spoon it over the steak and the fluffed jasmine rice.",
    ] }),
    meal("chicken-plate", "Greek", 85, [
      ["protein", "chicken-thigh"],
      ["carb", "pita"],
    ], { steps: [
      "Season the chicken thighs with salt, the grated garlic and the olive oil; let them sit 10 min.",
      "Cook the chicken thighs in a hot skillet over medium-high heat until browned and 175°F inside, 5–6 min a side.",
      "Rest the chicken 5 min, then slice it.",
      "Warm the pita bread in the same skillet over medium heat until soft and puffed, about 1 min a side.",
      "Pile the sliced chicken thighs into the warm pita and serve.",
    ] }),
    meal("kofta", "Greek", 70, [
      ["protein", "ground-beef"],
      ["carb", "pita"],
    ], { steps: [
      "Mash the ground beef with the grated garlic and salt, then shape it into 4 long kofta around your fingers.",
      "Cook the ground beef kofta in an oiled skillet over medium-high heat, turning, until browned all over and 160°F inside, 8–10 min.",
      "Rest the kofta 2 min off the heat so they stay juicy.",
      "Warm the pita bread in the same skillet over medium heat until soft and puffed, about 1 min a side.",
      "Tuck the kofta into the warm pita and serve.",
    ] }),
    meal(
      "sausage-pasta",
      "Italian",
      62,
      [
        ["protein", "italian-sausage"],
        ["carb", "rigatoni"],
      ],
      {
        ingredients: [ing("Greek yogurt", 0.25, "cup")],
        steps: [
          "Fill a large pot with water, salt it well and set it over high heat to come to a boil.",
          "Brown the Italian sausage in a wide pan over medium-high heat, breaking it up, until crisp at the edges and no pink remains, 6–8 min.",
          "Drop the rigatoni into the boiling water and cook two minutes short of the box, about 10 min, until just al dente; save a cup of the pasta water, then drain.",
          "Toss the rigatoni into the pan with a splash of the pasta water over medium heat until glossy and coated, 1–2 min.",
          "Off the heat, stir in the Greek yogurt and finish with black pepper; loosen it with more pasta water if it's thick.",
        ],
      },
    ),
    meal("tacos", "Mexican", 84, [
      ["protein", "skirt-steak"],
      ["carb", "corn-tortillas"],
      ["side", "chips-guac"],
    ], { steps: [
      "Rub the skirt steak with salt and the grated garlic and let it sit 15 min.",
      "Mash the avocado with the juice of the lime and a pinch of salt for the guac.",
      "Sear the skirt steak in a smoking-hot skillet over high heat until charred, 3–4 min a side for medium; rest it 5 min.",
      "Warm the corn tortillas in the dry skillet over medium-high heat until soft and spotted, about 30 s a side; keep them wrapped in a towel.",
      "Slice the steak thin against the grain and pile it into the warm tortillas.",
      "Serve with the tortilla chips and guac on the side.",
    ] }),
    meal("katsu", "Japanese", 80, [
      ["protein", "chicken-breast"],
      ["carb", "jasmine-rice"],
    ], { steps: [
      "Rinse the jasmine rice, bring it to a boil with 1¼ times its volume of water and a pinch of salt, then cover and simmer on low until the water is gone, 15 min; rest 5 min off the heat.",
      "Pound the chicken breast to an even ½ inch and season it with salt.",
      "Cook the chicken breast in an oiled skillet over medium-high heat until golden and 165°F inside, 5–6 min a side.",
      "Rest the chicken 5 min, then slice it into strips.",
      "Fluff the jasmine rice and lay the sliced chicken breast over it.",
    ] }),
    meal("surf-turf", "Steakhouse", 90, [
      ["protein", "ribeye"],
      ["carb", "no-carb"],
    ], { steps: [
      "Take the ribeye out 30 min ahead, pat it dry and salt it well.",
      "Sear the ribeye in a smoking-hot cast-iron skillet over high heat until a deep crust forms and it reads 130°F for medium-rare, 4–5 min a side.",
      "In the last minute, add the smashed garlic and the olive oil and spoon it over the steak.",
      "Rest the ribeye 8 min on a board, then slice it against the grain and pour the pan juices over.",
    ] }),
    meal("scampi", "Italian", 58, [
      ["protein", "shrimp"],
      ["carb", "linguine"],
    ], { steps: [
      "Fill a large pot with water, salt it well and set it over high heat to come to a boil.",
      "Pat the shrimp dry, season them with salt and thinly slice the garlic while the water heats.",
      "Drop the linguine into the boiling water and cook 1 minute short of the box time, about 9 min, until just al dente; save 1 cup of the pasta water, then drain.",
      "While it cooks, sear the shrimp in the olive oil in a wide pan over medium-high heat until pink, 1–2 min a side; set aside.",
      "Lower the heat to medium and cook the sliced garlic in the pan until pale gold, about 1 min.",
      "Toss the linguine and the shrimp in the pan with a splash of the pasta water until glossy, 1–2 min, and serve.",
    ] }),
    meal("new-thing", "Thai", 75, [
      ["protein", "ground-beef"],
      ["carb", "jasmine-rice"],
    ], { steps: [
      "Rinse the jasmine rice, bring it to a boil with 1¼ times its volume of water and a pinch of salt, then cover and simmer on low until the water is gone, 15 min; rest 5 min off the heat.",
      "Mince the garlic while the rice cooks.",
      "Brown the ground beef in a wok over high heat, breaking it up, until crisp and no pink remains, 6–8 min.",
      "Add the garlic and stir-fry until fragrant, about 30 s; season with salt.",
      "Spoon the ground beef over the fluffed jasmine rice.",
    ] }),
    // Three made-up quick lunches (#719).
    meal(
      "chicken-salad",
      "Salad",
      82,
      [
        ["protein", "chicken-breast"],
        ["side", "romaine"],
      ],
      {
        course: "lunch",
        minutes: 15,
        steps: [
          "Season the chicken breast with salt and cook it in an oiled skillet over medium-high heat until golden and 165°F inside, 5–6 min a side.",
          "Rest it 5 min, then slice it.",
          "Chop the romaine hearts, lay the sliced chicken breast over them and squeeze the lemon over everything.",
        ],
        ingredients: [ing("Lemon", 0.5, "each")],
      },
    ),
    meal(
      "steak-salad",
      "Salad",
      80,
      [
        ["protein", "sirloin"],
        ["side", "snow-peas"],
      ],
      {
        course: "lunch",
        minutes: 15,
        steps: [
          "Season the sirloin steak with salt and sear it in a smoking-hot skillet over high heat, 3–4 min a side for medium-rare (130°F inside).",
          "Rest the steak 5 min, then slice it thin against the grain.",
          "Lay the sliced steak over the raw snow peas.",
        ],
        ingredients: [],
      },
    ),
    meal(
      "chicken-wrap",
      "Wrap",
      78,
      [
        ["protein", "chicken-thigh"],
        ["carb", "flour-tortillas"],
      ],
      {
        course: "lunch",
        minutes: 20,
        steps: [
          "Season the chicken thighs with salt and the grated garlic and cook in an oiled skillet over medium-high heat until browned and 175°F inside, 5–6 min a side.",
          "Rest the chicken 5 min, then slice it.",
          "Warm the flour tortillas in the dry skillet over medium heat until soft, about 30 s a side.",
          "Roll the sliced chicken thighs into the warm flour tortillas.",
        ],
      },
    ),
  ];
  const mains = ["beef-bowl", "chicken-plate", "sausage-pasta", "tacos", "katsu", "surf-turf", "scampi"];
  const backups: Record<string, string[]> = { "beef-bowl": ["steak-bowl"], "chicken-plate": ["kofta"], "sausage-pasta": ["scampi"] };
  return readMeals({
    profile: { proteinGoal: 200, topUp: { text: "A shake", protein: 75, shop: [] }, avoid: [{ term: "avocado", unless: "tortilla chips" }], forTwo: ["sat"], lunchDays: ["fri"] },
    catalog,
    week: { start: "2026-11-09", slots: mains.map((m, i) => ({ meal: m, backups: backups[m] ?? [], lunch: i === 0 ? quick("chicken-salad", ["steak-salad", "chicken-wrap"]) : i === 4 ? quick("steak-salad", ["chicken-salad", "chicken-wrap"]) : lunch(i - 1), forTwo: i === 5 })), picks: ["new-thing"] },
  })!;
}
