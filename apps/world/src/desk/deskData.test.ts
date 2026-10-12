import { describe, expect, it } from "vitest";
import { byWait, demoDesk, EMPTY_DESK, useDesk } from "./deskData.ts";

describe("the Desk's data", () => {
  it("is empty with ?real, so nothing is invented", () => {
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

describe("Today's actions", () => {
  it("answering one clears it and counts it as done", () => {
    useDesk.setState({ data: demoDesk() });
    const before = useDesk.getState().data;
    useDesk.getState().act("spire-invoice");
    const after = useDesk.getState().data;
    expect(after.actions.find((a) => a.id === "spire-invoice")).toBeUndefined();
    expect(after.doneToday).toBe(before.doneToday + 1);
    useDesk.setState({ data: EMPTY_DESK, picked: null });
  });

  it("the sample day covers every room but the Break Room", () => {
    const d = demoDesk();
    const rooms = new Set([...d.actions.map((a) => a.room), ...d.notes.map((n) => n.room)]);
    expect([...rooms].sort()).toEqual(["archive", "boiler", "exchange", "foundry", "green", "relay", "spire"]);
  });
});
