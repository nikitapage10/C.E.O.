// Moved into the engine (#617, step 2; docs/ROOMS.md). This re-export keeps the old path working until step 14, and
// hands the engine the Desk's router so a tapped ping moves the open Desk to its tab without a reload.
import { setPingOpener } from "@ceo/engine/web/pings.ts";
import { navigateTo } from "../route.ts";

setPingOpener(navigateTo);

export * from "@ceo/engine/web/pings.ts";
