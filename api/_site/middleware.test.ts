import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", async () => (await import("../_desk/fakeBlob.ts")).fakeBlob);

import middleware from "../../middleware.ts";
import { blobFiles } from "../_desk/fakeBlob.ts";
import { signToken } from "../_desk/session.ts";
import { hashPassword } from "./password.ts";
import { SITE_COOKIE, newSiteSession } from "./session.ts";
import { RECORD_PATH, forgetCachedState, siteKeys } from "./state.ts";

/**
 * Vercel's Routing Middleware itself (middleware.ts, #236), with the blob store faked: off until a password is
 * stored, then the login page or a 401 for anyone without a session, and Vercel's "carry on" for everyone else.
 */

const ORIGIN = "https://ceo.test";
const DESK = "a test desk key, not a real one";
const BYPASS = "a-test-bypass-token-that-is-long-enough-0123456789";
const saved = { ...process.env };

beforeEach(() => {
  process.env.BLOB_STORE_ID = "store_test";
  process.env.FOUNDRY_DESK_KEY = DESK;
  process.env.SITE_BYPASS_TOKEN = BYPASS;
  delete process.env.SITE_GATE;
  delete process.env.SITE_PASSWORD_HASH;
  blobFiles.clear();
  forgetCachedState();
});
afterEach(() => {
  process.env = { ...saved };
  forgetCachedState();
});

const store = async (sv = "version-one") =>
  blobFiles.set(RECORD_PATH, { body: new TextEncoder().encode(JSON.stringify({ v: 1, sv, hash: await hashPassword("correct horse battery staple") })), type: "application/json" });

const carriesOn = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("the Vercel middleware (#236)", () => {
  it("carries every request on while no password is stored", async () => {
    for (const path of ["/", "/lattice", "/api/world"]) expect(carriesOn(await middleware(new Request(`${ORIGIN}${path}`)))).toBe(true);
  });

  it("locks pages and the API once one is, and lets a session, the bypass and the public files through", async () => {
    await store();
    const page = await middleware(new Request(`${ORIGIN}/lattice`));
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('action="/api/site-login"');
    expect((await middleware(new Request(`${ORIGIN}/api/world`))).status).toBe(401);
    expect(carriesOn(await middleware(new Request(`${ORIGIN}/assets/index.js`)))).toBe(true);
    expect(carriesOn(await middleware(new Request(`${ORIGIN}/api/world`, { headers: { "x-ceo-site-bypass": BYPASS } })))).toBe(true);
    const k = (await siteKeys(process.env))!;
    const cookie = `${SITE_COOKIE}=${signToken(k.session, newSiteSession("version-one", Date.now()))}`;
    expect(carriesOn(await middleware(new Request(`${ORIGIN}/`, { headers: { cookie } })))).toBe(true);
  });

  it("is off with SITE_GATE=off whatever is stored (break glass)", async () => {
    await store();
    process.env.SITE_GATE = "off";
    expect(carriesOn(await middleware(new Request(`${ORIGIN}/`)))).toBe(true);
  });
});
