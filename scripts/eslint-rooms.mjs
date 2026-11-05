// The room contract's import boundaries (#617, docs/ROOMS.md), as a small local ESLint plugin.
//
// ceo/room-boundary (error, in rooms/** and packages/engine/**):
//   - a room never imports another room (rooms/<a>/ reaching into rooms/<b>/), apart from the reads listed in
//     KNOWN_CROSSINGS below, which only shrinks;
//   - the engine imports no rooms (packages/engine/ reaching into rooms/);
//   - a room's web code reaches lore only through @ceo/engine/lore (not @ceo/simulator, the lore modules or lore/).
// ceo/desk-boundary (error, in apps/world/src/desk/**): a shared kit of the Desk (flow, skippy, confluence, hologram,
//   hero) never imports a room; the rooms plug into the kits instead (desk/roomHooks.ts).
// ceo/desk-package (error, in apps/desk/**): the Desk's package reaches into another app only for the files in
//   WORLD_SHARED below, which only shrinks.
//
// Imports are resolved against the importing file, so `../green/x` and `../../rooms/green/x` are judged by where they
// land, not how they are spelled.
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rel = (abs) => relative(ROOT, abs).split(sep).join("/");

/** Where an import lands, as a repo path, or null for a package import. */
function target(file, spec) {
  if (!spec.startsWith(".")) return null;
  return rel(resolve(dirname(file), spec));
}

function sources(context, check) {
  const file = context.filename;
  const visit = (node) => {
    const src = node.source;
    if (src && src.type === "Literal" && typeof src.value === "string") check(node, file, src.value, target(file, src.value));
  };
  return { ImportDeclaration: visit, ExportNamedDeclaration: visit, ExportAllDeclaration: visit, ImportExpression: visit };
}

const roomOf = (path) => path.match(/^rooms\/([^/]+)\//)?.[1] ?? null;
const LORE_PATHS = [/^packages\/simulator\//, /^packages\/core\/src\/(houses|cast|lineages)(\.ts)?$/, /^lore\//];
const LORE_NAMES = new Set(["HOUSES", "KERNEL_LORE", "LINEAGES"]);

// The reads one room still makes of another's code (#617, step 14). Until step 14 they went through the Desk's
// re-export stubs, which hid them from this rule; now each is listed here by file, so they stay in sight. Each is a
// gap to close by plugging the room in through the Desk (desk/roomHooks.ts) or sharing it through @ceo/engine; the
// list only shrinks (scripts/eslint-rooms.test.mjs fails on an entry whose import is gone). docs/ROOMS.md, "Lint".
export const KNOWN_CROSSINGS = {
  "rooms/boiler/data/controls.ts": ["rooms/today/data/todaySchedule.ts"],
  "rooms/boiler/web/ControlsPage.tsx": [
    "rooms/relay/data/email.ts",
    "rooms/exchange/data/polymarket.ts",
    "rooms/green/data/league.ts",
    "rooms/spire/data/invoices.ts",
    "rooms/relay/data/texts.ts",
    "rooms/today/data/todaySchedule.ts",
  ],
  "rooms/boiler/web/HouseSetup.tsx": ["rooms/haven/web/groceries.ts"],
  "rooms/boiler/web/PipeBoard.tsx": ["rooms/relay/data/email.ts", "rooms/haven/web/groceries.ts"],
  "rooms/boiler/web/SettingsPanel.tsx": ["rooms/today/web/TodayRail.tsx"],
  "rooms/boiler/web/Systems.tsx": ["rooms/relay/data/email.ts", "rooms/spire/data/invoices.ts", "rooms/exchange/data/polymarket.ts", "rooms/green/data/league.ts"],
  "rooms/exchange/data/asides.ts": ["rooms/green/data/league.ts"],
  "rooms/today/web/Today.tsx": ["rooms/relay/data/email.ts"],
  "rooms/today/web/TodayNow.tsx": ["rooms/relay/web/EmailAct.tsx"],
  "rooms/today/web/TodayWeave.tsx": ["rooms/archive/web/DayStory.tsx"],
};

const roomBoundary = {
  meta: { type: "problem", schema: [], messages: {
    room: "A room never imports another room ({{other}}). Share it through @ceo/engine instead (docs/ROOMS.md).",
    engine: "The engine imports no rooms (docs/ROOMS.md): rooms plug into it, never the other way round.",
    lore: "A room's web code reaches lore only through @ceo/engine/lore (docs/ROOMS.md, \"Lore hook\").",
  } },
  create(context) {
    const here = rel(context.filename);
    const room = roomOf(here);
    const web = room !== null && here.startsWith(`rooms/${room}/web/`);
    const engine = here.startsWith("packages/engine/");
    return sources(context, (node, _file, spec, to) => {
      const other = to ? roomOf(to + "/") : null;
      if (room && other && other !== room && !KNOWN_CROSSINGS[here]?.includes(to)) context.report({ node, messageId: "room", data: { other } });
      if (engine && to && (to === "rooms" || to.startsWith("rooms/"))) context.report({ node, messageId: "engine" });
      if (!web) return;
      const viaPackage = spec === "@ceo/simulator" || spec.startsWith("@ceo/simulator/");
      const viaCore = spec === "@ceo/core" && node.type === "ImportDeclaration" && node.specifiers.some((s) => s.type === "ImportSpecifier" && LORE_NAMES.has(s.imported.name));
      if (viaPackage || viaCore || (to && LORE_PATHS.some((p) => p.test(to)))) context.report({ node, messageId: "lore" });
    });
  },
};

// The Desk's shared kits (apps/world/src/desk). Every room now lives in rooms/<id>/ (#617, step 14), so a kit reaching
// into rooms/ is what this rule catches; the Desk's shell (Desk.tsx, roomHooks.ts, the council) may load rooms.
const DESK = "apps/world/src/desk/";
const DESK_KITS = [/^flow\//, /^skippy\//, /^confluence\//, /^hologram\//, /^hero\//];
const isKit = (path) => path.startsWith(DESK) && DESK_KITS.some((p) => p.test(path.slice(DESK.length)));

const deskBoundary = {
  meta: { type: "problem", schema: [], messages: {
    kit: "A shared kit imports the {{to}} room. Kits import no rooms; the room plugs in instead (desk/roomHooks.ts, docs/ROOMS.md).",
  } },
  create(context) {
    if (!isKit(rel(context.filename))) return {};
    return sources(context, (node, _file, _spec, to) => {
      const room = to ? roomOf(to + "/") : null;
      if (room) context.report({ node, messageId: "kit", data: { to: room } });
    });
  },
};

// The Desk's package, @ceo/desk (apps/desk, #617). It may import @ceo/engine, the rooms, the other packages and api/,
// but it reaches into another app only for the files listed in WORLD_SHARED: the ones the Desk shares with the Lattice
// (the route, the systems and Foundry stores, the chronicle and the rest), which stay in apps/world/src until each moves
// into a package of its own. Like KNOWN_CROSSINGS the list only shrinks (scripts/eslint-rooms.test.mjs fails on an
// entry no Desk file imports). @ceo/world's package name is no way round it: it is an error too.
export const WORLD_SHARED = [];

const DESK_PACKAGE = "apps/desk/";

const deskPackage = {
  meta: { type: "problem", schema: [], messages: {
    app: "The Desk imports {{to}} from another app. It reaches apps/world only for the files in WORLD_SHARED (scripts/eslint-rooms.mjs, docs/ROOMS.md).",
    world: "The Desk imports apps/world only by the relative path of a file in WORLD_SHARED, never through @ceo/world (docs/ROOMS.md).",
  } },
  create(context) {
    if (!rel(context.filename).startsWith(DESK_PACKAGE)) return {};
    return sources(context, (node, _file, spec, to) => {
      if (spec === "@ceo/world" || spec.startsWith("@ceo/world/")) context.report({ node, messageId: "world" });
      if (!to || !to.startsWith("apps/") || to.startsWith(DESK_PACKAGE)) return;
      if (!WORLD_SHARED.includes(to)) context.report({ node, messageId: "app", data: { to } });
    });
  },
};

export default { rules: { "room-boundary": roomBoundary, "desk-boundary": deskBoundary, "desk-package": deskPackage } };
