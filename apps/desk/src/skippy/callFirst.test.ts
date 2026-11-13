import { afterEach, describe, expect, it, vi } from "vitest";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { useSkippy } from "./chat.ts";
import { useTalk } from "./talk.ts";
import { askSkippy } from "./callFirst.ts";

/** Skippy's button starts a call, and the chat is there once it ends (#1120). */
describe("Skippy's button calls first (#1120)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useSkippy.getState().setOpen(false);
  });

  it("opens the chat and starts a call when signed in", () => {
    const start = vi.fn(async () => {});
    useTalk.setState({ phase: "idle", ready: true, start });
    useDeskAuth.setState({ auth: { status: "in", until: 0, hardUntil: 0, device: "", devices: [] } } as never);
    askSkippy();
    expect(useSkippy.getState().open).toBe(true);
    expect(start).toHaveBeenCalledOnce();
  });

  it("only opens the chat when signed out, a call is already up, or calls aren't set up", () => {
    const start = vi.fn(async () => {});
    useTalk.setState({ phase: "idle", ready: true, start });
    useDeskAuth.setState({ auth: { status: "off" } } as never);
    askSkippy();
    useDeskAuth.setState({ auth: { status: "in", until: 0, hardUntil: 0, device: "", devices: [] } } as never);
    useTalk.setState({ phase: "live" });
    askSkippy();
    useTalk.setState({ phase: "idle", ready: false });
    askSkippy();
    expect(useSkippy.getState().open).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });
});
