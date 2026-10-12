import { describe, expect, it } from "vitest";
import { byWait, demoDesk, EMPTY_DESK, useDesk } from "./deskData.ts";

describe("the Desk's data", () => {
  it("is empty without ?demo, so nothing is invented", () => {
    expect(useDesk.getState().data).toBe(EMPTY_DESK);
    expect(EMPTY_DESK.owed).toHaveLength(0);
  });

  it("sorts sooner first, then the longest wait, with replies pushed to later last", () => {
    const owed = demoDesk(Date.now()).owed;
    const order = byWait(owed.map((o) => (o.id === "mom" ? { ...o, later: true } : o))).map((o) => o.id);
    expect(order[0]).toBe("priya");
    expect(order.at(-1)).toBe("mom");
  });

  it("sending a reply clears it and counts it", () => {
    useDesk.setState({ data: demoDesk() });
    const before = useDesk.getState().data;
    useDesk.getState().send("sam");
    const after = useDesk.getState().data;
    expect(after.owed.map((o) => o.id)).not.toContain("sam");
    expect(after.sentToday).toBe(before.sentToday + 1);
    useDesk.setState({ data: EMPTY_DESK, picked: null });
  });
});
