// The room contract's import boundaries (#617, docs/ROOMS.md), as a small local ESLint plugin.
//
// ceo/room-boundary (error, in rooms/** and packages/engine/**):
//   - a room never imports another room (rooms/<a>/ reaching into rooms/<b>/);
//   - the engine imports no rooms (packages/engine/ reaching into rooms/);
//   - a room's web code reaches lore only through @ceo/engine/lore (not @ceo/simulator, the lore modules or lore/).
// ceo/desk-boundary (warn, in apps/world/src/desk/**): the same idea for the Desk's old layout, so the baseline is
//   counted while the rooms move out: a room's folder importing another room's, or a shared kit importing a room.
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
      if (room && other && other !== room) context.report({ node, messageId: "room", data: { other } });
      if (engine && to && (to === "rooms" || to.startsWith("rooms/"))) context.report({ node, messageId: "engine" });
      if (!web) return;
      const viaPackage = spec === "@ceo/simulator" || spec.startsWith("@ceo/simulator/");
      const viaCore = spec === "@ceo/core" && node.type === "ImportDeclaration" && node.specifiers.some((s) => s.type === "ImportSpecifier" && LORE_NAMES.has(s.imported.name));
      if (viaPackage || viaCore || (to && LORE_PATHS.some((p) => p.test(to)))) context.report({ node, messageId: "lore" });
    });
  },
};

// The Desk's rooms and shared kits in today's layout (apps/world/src/desk), until each room moves to rooms/<id>/.
const DESK = "apps/world/src/desk/";
const DESK_ROOMS = {
  foundry: [/^foundry\//, /^FoundryPage\.tsx$/],
  relay: [/^relay\//, /^email\//, /^texts\//, /^Relay\.tsx$/],
  boiler: [/^boiler\//],
  archive: [/^Archive\.tsx$/],
  spire: [/^spire\//, /^rooms\/Spire\.tsx$/],
  exchange: [/^exchange\//, /^rooms\/Exchange\.tsx$/],
  green: [/^green\//, /^rooms\/Green\.tsx$/],
};
const DESK_KITS = [/^flow\//, /^skippy\//, /^confluence\//, /^hologram\//, /^hero\//];

function deskGroup(path) {
  if (!path.startsWith(DESK)) return null;
  const inner = path.slice(DESK.length);
  for (const [room, pats] of Object.entries(DESK_ROOMS)) if (pats.some((p) => p.test(inner) || p.test(inner + ".tsx"))) return room;
  if (DESK_KITS.some((p) => p.test(inner))) return "kit";
  return null;
}

const deskBoundary = {
  meta: { type: "suggestion", schema: [], messages: {
    room: "The {{from}} room imports the {{to}} room. Rooms stay apart in the engine layout (#617, docs/ROOMS.md).",
    kit: "A shared kit imports the {{to}} room. Kits move into @ceo/engine, which imports no rooms (#617, docs/ROOMS.md).",
  } },
  create(context) {
    const from = deskGroup(rel(context.filename));
    if (!from) return {};
    return sources(context, (node, _file, _spec, to) => {
      const room = to ? deskGroup(to) : null;
      if (!room || room === "kit" || room === from) return;
      context.report({ node, messageId: from === "kit" ? "kit" : "room", data: { from, to: room } });
    });
  },
};

export default { rules: { "room-boundary": roomBoundary, "desk-boundary": deskBoundary } };
