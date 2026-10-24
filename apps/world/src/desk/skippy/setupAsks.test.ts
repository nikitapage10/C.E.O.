import { afterEach, describe, expect, it } from "vitest";
import { useDeskAuth } from "../signin.ts";
import { readSetupAsks, useSetupAsks } from "./setupAsks.ts";

/** Setup asks in the browser (#324): read only signed in, checked again, and Approve sent in the passkey session. */

const AT = "2026-10-23T16:00:00.000Z";
const ask = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  at: AT,
  room: "foundry",
  title: "Create the C.E.O. GitHub App on github.com",
  where: "github.com",
  service: "GitHub Apps",
  changes: "Adds one app with read access to checks.",
  why: "So the Builder reads checks without a token.",
  cost: "Free",
  reversible: true,
  route: "key-vault-flow",
  state: "open",
  ...over,
});

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  useSetupAsks.setState({ status: "idle", asks: [], busy: null });
  useDeskAuth.setState({ auth: { status: "checking" } });
});

describe("reading the asks", () => {
  it("keeps only good asks, in the function's order", () => {
    const got = readSetupAsks({ asks: [ask("setup-0001"), ask("setup-0002", { room: "relay" }), ask("setup-0003", { route: "paste" }), ask("x"), ask("setup-0004", { why: "" }), null, ask("setup-0005", { state: "done", trail: "Made it." })] });
    expect(got?.map((a) => a.id)).toEqual(["setup-0001", "setup-0005"]);
    expect(readSetupAsks({})).toBeNull();
  });

  it("never asks while signed out, and forgets what it showed", async () => {
    useDeskAuth.setState({ auth: { status: "out" } });
    useSetupAsks.setState({ status: "live", asks: readSetupAsks({ asks: [ask("setup-0001")] })! });
    let called = 0;
    await useSetupAsks.getState().refresh(async () => (called++, reply(200, { asks: [] })));
    expect(called).toBe(0);
    expect(useSetupAsks.getState()).toMatchObject({ status: "signed-out", asks: [] });
  });

  it("reads them signed in, and is off where the route doesn't exist", async () => {
    useDeskAuth.setState({ auth: { status: "in", until: Date.now() + 60_000, device: "Test" } });
    await useSetupAsks.getState().refresh(async () => reply(200, { asks: [ask("setup-0001")] }));
    expect(useSetupAsks.getState().status).toBe("live");
    expect(useSetupAsks.getState().asks).toHaveLength(1);
    await useSetupAsks.getState().refresh(async () => new Response("<html>", { status: 404, headers: { "Content-Type": "text/html" } }));
    expect(useSetupAsks.getState().status).toBe("off");
  });
});

describe("Approve and Decline", () => {
  it("sends the decision and shows the ask as it came back", async () => {
    useDeskAuth.setState({ auth: { status: "in", until: Date.now() + 60_000, device: "Test" } });
    useSetupAsks.setState({ status: "live", asks: readSetupAsks({ asks: [ask("setup-0001")] })! });
    let sent: unknown;
    const r = await useSetupAsks.getState().decide("setup-0001", "approve", async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return reply(200, { ok: true, ask: ask("setup-0001", { state: "approved", decidedAt: AT }) });
    });
    expect(r).toBe("ok");
    expect(sent).toEqual({ id: "setup-0001", decision: "approve" });
    expect(useSetupAsks.getState().asks[0]!.state).toBe("approved");
  });

  it("says when the session ended", async () => {
    useDeskAuth.setState({ auth: { status: "in", until: Date.now() + 60_000, device: "Test" } });
    useSetupAsks.setState({ status: "live", asks: readSetupAsks({ asks: [ask("setup-0001")] })! });
    expect(await useSetupAsks.getState().decide("setup-0001", "decline", async () => reply(401, { error: "signed-out" }))).toBe("signed-out");
    expect(useSetupAsks.getState().asks).toEqual([]);
  });
});
