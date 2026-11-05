/**
 * @ceo/desk (#617, docs/ROOMS.md, "The Desk's package"): the Desk's shell, which apps/world/src/main.tsx mounts from
 * here. Code outside the package reaches the Desk only through `@ceo/desk` (this entry) or `@ceo/desk/<file>`, never
 * by a relative path into apps/desk (lint: ceo/desk-entry).
 * One build and one deploy: @ceo/world's Vite build bundles it, and Deploy to Azure ships that same artifact.
 */
export { Desk } from "./Desk.tsx";
export { RoomGuard } from "./RoomGuard.tsx";
