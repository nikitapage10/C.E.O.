import { HttpRequest } from "@azure/functions";
import { describe, expect, it, vi } from "vitest";
import { waitUntil } from "../../api/_waitUntil.ts";
import { adapt, clientIp, parseSetCookie, publicUrl, settle, stripPort, toAzureResponse, toWebRequest } from "./adapter.ts";

const ctx = () => ({ error: vi.fn(), warn: vi.fn() });

describe("the Azure adapter: requests", () => {
  it("passes method, headers, query and body through", async () => {
    const req = new HttpRequest({
      method: "POST",
      url: "https://func-ceo.azurewebsites.net/api/desk-auth?step=begin",
      headers: { "content-type": "application/json", cookie: "a=1" },
      body: { string: '{"x":1}' },
    });
    const web = await toWebRequest(req);
    expect(web.method).toBe("POST");
    expect(new URL(web.url).searchParams.get("step")).toBe("begin");
    expect(web.headers.get("content-type")).toBe("application/json");
    expect(web.headers.get("cookie")).toBe("a=1");
    expect(await web.json()).toEqual({ x: 1 });
  });

  it("sends no body on a GET", async () => {
    const web = await toWebRequest(new HttpRequest({ method: "GET", url: "https://f.example/api/world" }));
    expect(web.body).toBeNull();
  });

  it("puts back the address the browser used, behind the Static Web App", () => {
    const own = "https://func-ceo.azurewebsites.net/api/foundry?x=1";
    expect(publicUrl(own, new Headers({ "x-ms-original-url": "https://swa-ceo.azurestaticapps.net/api/foundry?x=1" }))).toBe("https://swa-ceo.azurestaticapps.net/api/foundry?x=1");
    expect(publicUrl(own, new Headers({ "x-forwarded-host": "ceo.example.com" }))).toBe("https://ceo.example.com/api/foundry?x=1");
    expect(publicUrl(own, new Headers({ "x-forwarded-host": "bad host/" }))).toBe(own);
    expect(publicUrl(own, new Headers({ "x-ms-original-url": "javascript:alert(1)" }))).toBe(own);
    expect(publicUrl(own, new Headers())).toBe(own);
  });

  it("replaces a caller's own x-real-ip with the address Azure saw", async () => {
    const req = new HttpRequest({
      method: "GET",
      url: "https://f.example/api/world",
      headers: { "x-real-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6, 203.0.113.9:51234" },
    });
    expect((await toWebRequest(req)).headers.get("x-real-ip")).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-azure-clientip": "198.51.100.4", "x-forwarded-for": "1.1.1.1" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBe("");
    const none = await toWebRequest(new HttpRequest({ method: "GET", url: "https://f.example/api/world", headers: { "x-real-ip": "6.6.6.6" } }));
    expect(none.headers.get("x-real-ip")).toBeNull();
  });

  it("strips ports from addresses", () => {
    expect(stripPort("1.2.3.4:5678")).toBe("1.2.3.4");
    expect(stripPort("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(stripPort("2001:db8::1")).toBe("2001:db8::1");
  });
});

describe("the Azure adapter: responses", () => {
  it("keeps status, headers and body, and turns each Set-Cookie into a cookie", async () => {
    const res = new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    res.headers.append("Set-Cookie", "__Host-desk=abc; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=600");
    res.headers.append("Set-Cookie", "__Host-desk-ch=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0");
    const out = await toAzureResponse(res);
    expect(out.status).toBe(201);
    expect(out.headers).toMatchObject({ "content-type": "application/json", "cache-control": "no-store" });
    expect(Object.keys(out.headers as object)).not.toContain("set-cookie");
    expect(out.cookies).toEqual([
      { name: "__Host-desk", value: "abc", path: "/", httpOnly: true, secure: true, sameSite: "Strict", maxAge: 600 },
      { name: "__Host-desk-ch", value: "", path: "/", httpOnly: true, secure: true, sameSite: "Strict", maxAge: 0 },
    ]);
    expect(new TextDecoder().decode(out.body as Uint8Array)).toBe('{"ok":true}');
  });

  it("keeps binary bodies byte for byte", async () => {
    const bytes = new Uint8Array([0, 255, 1, 128]);
    const out = await toAzureResponse(new Response(bytes, { status: 206, headers: { "Content-Type": "audio/wav" } }));
    expect(Array.from(out.body as Uint8Array)).toEqual([0, 255, 1, 128]);
    expect(out.status).toBe(206);
  });

  it("parses a cookie's other attributes and refuses a nameless one", () => {
    expect(parseSetCookie("a=b=c; Domain=x.test; Expires=Wed, 21 Oct 2026 07:28:00 GMT; SameSite=Lax")).toEqual({
      name: "a",
      value: "b=c",
      domain: "x.test",
      expires: new Date("Wed, 21 Oct 2026 07:28:00 GMT"),
      sameSite: "Lax",
    });
    expect(parseSetCookie("=nope")).toBeNull();
  });
});

describe("the Azure adapter: waitUntil", () => {
  it("waits for waitUntil work before answering", async () => {
    const order: string[] = [];
    const handler = async () => {
      waitUntil(new Promise<void>((r) => setTimeout(() => (order.push("background"), r()), 20)));
      order.push("handler");
      return new Response("ok");
    };
    const out = await adapt(handler)(new HttpRequest({ method: "POST", url: "https://f.example/api/foundry" }), ctx());
    order.push("answered");
    expect(order).toEqual(["handler", "background", "answered"]);
    expect(out.status).toBe(200);
  });

  it("answers after settleMs while slow work carries on, and a failure in it doesn't fail the answer", async () => {
    const c = ctx();
    let finished = false;
    const handler = async () => {
      waitUntil(new Promise<void>((r) => setTimeout(() => ((finished = true), r()), 200)));
      waitUntil(Promise.reject(new Error("boom")));
      return new Response("ok");
    };
    const out = await adapt(handler, { settleMs: 10 })(new HttpRequest({ method: "GET", url: "https://f.example/api/x" }), c);
    expect(out.status).toBe(200);
    expect(finished).toBe(false);
    expect(c.warn).toHaveBeenCalledOnce();
    expect(await settle([new Promise((r) => setTimeout(r, 5))], 1000)).toBe(true);
  });

  it("keeps each request's work apart", async () => {
    const seen: number[] = [];
    const handler = (n: number) => async () => {
      await new Promise((r) => setTimeout(r, 5 * n));
      waitUntil(Promise.resolve().then(() => seen.push(n)));
      return new Response(String(n));
    };
    const req = () => new HttpRequest({ method: "GET", url: "https://f.example/api/x" });
    await Promise.all([adapt(handler(2))(req(), ctx()), adapt(handler(1))(req(), ctx())]);
    expect(seen.sort()).toEqual([1, 2]);
  });

  it("answers 500 without details when a handler throws", async () => {
    const c = ctx();
    const out = await adapt(async () => {
      throw new Error("secret detail");
    })(new HttpRequest({ method: "GET", url: "https://f.example/api/x" }), c);
    expect(out.status).toBe(500);
    expect(String(out.body)).not.toContain("secret");
    expect(c.error).toHaveBeenCalled();
  });
});

describe("the Azure adapter with a real handler", () => {
  it("serves api/world.ts from the memory store", async () => {
    vi.stubEnv("WORLD_STORE", "memory");
    const { GET } = await import("../../api/world.ts");
    const out = await adapt(GET)(new HttpRequest({ method: "GET", url: "https://f.example/api/world?day=2026-10-13" }), ctx());
    expect(out.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(out.body as Uint8Array))).toEqual({ day: "2026-10-13", entries: [], recap: null });
    vi.unstubAllEnvs();
  });
});
