import { describe, expect, it } from "vitest";
import { motionLine, readRecord, whenArgued } from "./senateRecord.ts";

describe("the Senate Record as the Archive reads it (#1181)", () => {
  it("keeps entries with the record's shape and drops the rest", () => {
    expect(readRecord(null)).toBeNull();
    expect(readRecord({ entries: "no" })).toBeNull();
    expect(
      readRecord({
        entries: [
          { motion: "that the disc is a lamp", close: "Carried.", at: "2026-11-14T12:05:00.000Z" },
          { motion: "that an old motion stands" },
          { motion: "" },
          { close: "no motion" },
          { motion: "that a bad time is dropped", at: "soon" },
          7,
        ],
      }),
    ).toEqual([
      { motion: "that the disc is a lamp", close: "Carried.", at: "2026-11-14T12:05:00.000Z" },
      { motion: "that an old motion stands" },
      { motion: "that a bad time is dropped" },
    ]);
  });

  it("reads a motion with its capital, and its time short", () => {
    expect(motionLine("that the disc is a lamp")).toBe("That the disc is a lamp");
    const now = Date.parse("2026-11-14T18:00:00Z");
    expect(whenArgued("2026-11-14T12:05:00.000Z", now, "UTC")).toBe("14 Nov · 12:05");
    expect(whenArgued("2025-03-02T12:05:00.000Z", now, "UTC")).toBe("2 Mar 2025");
  });
});
