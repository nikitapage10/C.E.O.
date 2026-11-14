import { expect, type Page } from "@playwright/test";
import { SENATE_WAIT_MS } from "@ceo/desk/keptRooms.ts";

/**
 * Waits for the kept rooms behind the room on screen to finish warming (#934, #973): the Senate's chamber builds
 * while hidden, then the Haven and Relay mount behind it. On the software renderer that holds the main thread for
 * seconds at a time, which lands anything timed (a held send, a fresh read a few seconds after a scene, a tap right
 * after a fling) late or not at all (#967, #1186). A spec with a timed step waits for this first.
 */
export async function keptRoomsWarm(page: Page): Promise<void> {
  await expect(page.locator('main.desk__main[data-room="relay"]')).toHaveCount(1, { timeout: SENATE_WAIT_MS + 30_000 });
  await expect(page.locator(".rt-stage")).toHaveAttribute("data-gl", /^(on|off)$/, { timeout: 60_000 });
}
