import { beforeEach, describe, expect, it, vi } from "vitest";

const vercel = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock("@vercel/functions", () => vercel);

import { collectWaitUntil, waitUntil } from "./_waitUntil.ts";

describe("waitUntil", () => {
  beforeEach(() => vercel.waitUntil.mockClear());

  it("hands the work to Vercel when nothing is collecting", () => {
    const work = Promise.resolve();
    waitUntil(work);
    expect(vercel.waitUntil).toHaveBeenCalledWith(work);
  });

  it("gathers work, including from awaited code, while collecting, and leaves Vercel out of it", async () => {
    const first = Promise.resolve(1);
    const second = Promise.resolve(2);
    const { result, pending } = await collectWaitUntil(async () => {
      waitUntil(first);
      await Promise.resolve();
      waitUntil(second);
      return "answer";
    });
    expect(result).toBe("answer");
    expect(pending).toEqual([first, second]);
    expect(vercel.waitUntil).not.toHaveBeenCalled();
  });

  it("keeps two requests' work apart", async () => {
    const a = Promise.resolve("a");
    const b = Promise.resolve("b");
    const [ra, rb] = await Promise.all([
      collectWaitUntil(async () => {
        await new Promise((r) => setTimeout(r, 5));
        waitUntil(a);
      }),
      collectWaitUntil(async () => waitUntil(b)),
    ]);
    expect(ra.pending).toEqual([a]);
    expect(rb.pending).toEqual([b]);
  });
});
