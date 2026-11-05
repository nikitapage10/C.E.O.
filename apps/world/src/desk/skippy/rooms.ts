import type { ComponentType } from "react";

/**
 * What the rooms hand Desk Skippy (#617). The kit reads no room's data and imports no room: the Desk plugs each room's
 * part in once, as it starts (desk/roomHooks.ts), and every part loads lazily, so none of it lands in the first load.
 */

/** A room's lines for the page block (page.ts), read from what that room already loaded. */
export interface PageSource {
  room: string;
  /** Leads every block, wherever Nikita is (the Green's start/sit calls). */
  first?: boolean;
  lines: () => Promise<string[]>;
}

/** Texting from the chat and calls (#536), the Relay's part: Blasto drafts the text, its card sends it on a tap. */
export interface Texting {
  /** Starts a text's card from the chat and resolves to its key, with `Card` loaded by then. */
  start: (who: string, gist: string) => Promise<string>;
  /** The call's texting tools and its ear for what Nikita says (a spoken "send"), with `Card` loaded by then. */
  talkTools: () => Promise<{ talkTools: (onCard: (key: string) => void) => unknown; heard: (words: string) => void }>;
  /** The text's card in the chat, once a text has started (null before: no turn can carry one yet). */
  Card: ComponentType<{ id: string }> | null;
}

const parts: { pages: PageSource[]; texting: Texting | null } = { pages: [], texting: null };

/** Plugs a room's page lines into Skippy's page block (one source per room; plugging again replaces it). */
export function addPageSource(source: PageSource): void {
  parts.pages = [...parts.pages.filter((s) => s.room !== source.room), source];
}

/** Plugs in texting (the Relay's). */
export function setTexting(t: Texting): void {
  parts.texting = t;
}

export const pageSources = (): readonly PageSource[] => parts.pages;
export const texting = (): Texting | null => parts.texting;
