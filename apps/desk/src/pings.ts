// The device pings live in the engine (#617, step 2; docs/ROOMS.md). The Desk imports them from here, not the engine,
// because this file hands the engine the Desk's router so a tapped ping moves the open Desk to its tab without a reload.
import { setPingOpener } from "@ceo/engine/web/pings.ts";
import { navigateTo } from "../../world/src/route.ts";

setPingOpener(navigateTo);

export * from "@ceo/engine/web/pings.ts";
