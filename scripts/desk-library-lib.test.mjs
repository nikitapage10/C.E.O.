/* global URL */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allowed, deskSections, markdownSections, parts, PART_MAX, renderDeskIndex, tsText } from "./desk-library-lib.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("the Desk's library index (#1141)", () => {
  const sections = deskSections(root);

  it("reads the docs, the lore, every room's manifest and the cast's dossiers, by section", () => {
    const sources = new Set(sections.map((s) => s.source));
    for (const f of ["docs/SKIPPY.md", "docs/FOUNDRY.md", "docs/ROOMS.md", "lore/syntherion.md", "CLAUDE.md", "rooms/green/room.ts", "rooms/foundry/room.ts", "packages/simulator/src/lore.ts"]) expect(sources, f).toContain(f);
    expect(sections.length).toBeGreaterThan(200);
    const titles = sections.map((s) => s.title).join("\n");
    expect(titles).toMatch(/Room: Green \(green\)/);
    expect(titles).toMatch(/Dossier: Rocky \(caret\)/);
    expect(titles).toMatch(/Dossier: Skippy, the Magnificent/);
    expect(titles).toMatch(/The Syntherion › The Kernel, and who sits in it/);
  });

  it("gives every section a unique short id, a title and at most one part's text", () => {
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of sections) {
      expect(s.id).toMatch(/^[a-z0-9-]{1,56}$/);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.text.length).toBeLessThanOrEqual(PART_MAX);
    }
  });

  it("carries a room's purpose and tools, and a dossier's bio, history and relationships", () => {
    const green = sections.find((s) => s.id === "room-green");
    expect(green?.text).toMatch(/goal: Runs Nikita's Sleeper league/);
    expect(green?.text).toMatch(/live_scores/);
    const rocky = sections.filter((s) => s.id.startsWith("dossier-caret")).map((s) => s.text).join("\n");
    expect(rocky).toMatch(/catchphrase: Fist my bump\./);
    expect(rocky).toMatch(/Relationships: .*rival of Rusty \(tessellate\)/);
  });

  it("never reads kb/, /mnt or outside the repo", () => {
    expect(allowed(root, "docs/SKIPPY.md")).toBe(true);
    expect(allowed(root, "kb/notes.md")).toBe(false);
    expect(allowed(root, "mnt/x.md")).toBe(false);
    expect(allowed(root, "../outside.md")).toBe(false);
    expect(sections.some((s) => /^(?:kb|mnt)\//.test(s.source))).toBe(false);
  });

  it("splits markdown by heading, leaves code blocks out, and cuts a long section into parts", () => {
    const md = "# Doc\nIntro line.\n## One\nFirst **bold** [link](https://x.test).\n```\nsecret-looking code\n```\n### Two\nSecond.";
    expect(markdownSections(md, "d.md")).toEqual([
      { title: "Doc", source: "d.md", text: "Intro line." },
      { title: "Doc › One", source: "d.md", text: "First bold link." },
      { title: "Doc › Two", source: "d.md", text: "Second." },
    ]);
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ${"word ".repeat(30)}`).join("\n\n");
    const cut = parts(long, 500);
    expect(cut.length).toBeGreaterThan(1);
    for (const c of cut) expect(c.length).toBeLessThanOrEqual(500);
  });

  it("reads TypeScript data as plain lines, without paths or colours", () => {
    expect(tsText(`title: "The Kernel",\n  look: "#ff0000",\n  quirks: [\n "Sings.",\n "Sulks."\n ],\n path: "./x.ts"`)).toBe("title: The Kernel\nquirks: Sings.; Sulks.");
  });

  it("renders one module of rows, the same every time", () => {
    const a = renderDeskIndex(root);
    expect(a).toBe(renderDeskIndex(root));
    expect(a).toMatch(/export const DESK_SECTIONS/);
    expect(a).toContain('"room-green"');
  });
});
