import { afterEach, describe, expect, it } from "vitest";
import { duckSite, duckable, duckableContext, forgetSiteSound, onSiteDuck, siteDucked } from "./siteSound.ts";

/** A stand-in Web Audio context: just its state and the two calls. */
function fakeContext(state: AudioContextState = "running") {
  const c = {
    state,
    suspend: async () => void (c.state = "suspended"),
    resume: async () => void (c.state = "running"),
  };
  return c as unknown as AudioContext & { state: AudioContextState };
}
const fakeElement = () => ({ muted: false }) as HTMLMediaElement;

describe("the site's sound during a Skippy call (#952)", () => {
  afterEach(() => forgetSiteSound());

  it("mutes every registered element and suspends running contexts, then brings them back", async () => {
    const voice = duckable(fakeElement());
    const music = duckableContext(fakeContext());
    const heard: boolean[] = [];
    onSiteDuck((d) => heard.push(d));
    duckSite(true);
    await Promise.resolve();
    expect(siteDucked()).toBe(true);
    expect(voice.muted).toBe(true);
    expect(music.state).toBe("suspended");
    duckSite(false);
    await Promise.resolve();
    expect(voice.muted).toBe(false);
    expect(music.state).toBe("running");
    expect(heard).toEqual([true, false]);
  });

  it("leaves a context suspended for its own reasons suspended after the call", async () => {
    const held = duckableContext(fakeContext("suspended"));
    duckSite(true);
    duckSite(false);
    await Promise.resolve();
    expect(held.state).toBe("suspended");
  });

  it("mutes a source that starts during the call at once", async () => {
    duckSite(true);
    const late = duckable(fakeElement());
    const ctx = duckableContext(fakeContext());
    await Promise.resolve();
    expect(late.muted).toBe(true);
    expect(ctx.state).toBe("suspended");
    duckSite(false);
    await Promise.resolve();
    expect(late.muted).toBe(false);
    expect(ctx.state).toBe("running");
  });
});
