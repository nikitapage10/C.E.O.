/**
 * The lore a room may reach (#617, docs/ROOMS.md, "Lore hook"): re-exports only, so the world's lore keeps one home
 * (packages/core and packages/simulator, written per CLAUDE.md's lore rule) and rooms never copy its text.
 */
export { HOUSES, KERNEL_LORE, LINEAGES, type House } from "@ceo/core";
export {
  AGENT_QUIPS,
  LORE,
  ROOM_QUIPS,
  SAMPLE_AGENTS,
  SKIPPY_LORE,
  SKIPPY_QUIPS,
  SUBMINDS,
  defaultCast,
  submindOf,
  type Submind,
} from "@ceo/simulator";
