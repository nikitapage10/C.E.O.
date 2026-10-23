import { describe, expect, it } from "vitest";
import { cookie } from "../_desk/session.ts";
import { CALLBACK_PATH, DEFAULT_REDIRECT, makeState, redirectFor } from "../_email/route.ts";
import { AZURE_HOST, CUSTOM_HOST, SITE_HOSTS, isSiteHost, siteUrl } from "./hosts.ts";
import { clearSiteCookie } from "./session.ts";

// The move to ceo.nikita.page (#314): both hosts work during the switch.
describe("the site's hosts", () => {
  it("knows both addresses, and nothing else", () => {
    expect(SITE_HOSTS).toEqual([CUSTOM_HOST, AZURE_HOST]);
    expect(isSiteHost("ceo.nikita.page")).toBe(true);
    expect(isSiteHost("CEO.nikita.page")).toBe(true);
    expect(isSiteHost(AZURE_HOST)).toBe(true);
    for (const h of ["nikita.page", "www.nikita.page", "tide.nikita.page", "evil.ceo.nikita.page", "ceo.nikita.page.evil.example", "attacker.example"]) expect(isSiteHost(h)).toBe(false);
  });

  it("calls the azurestaticapps.net address home until CEO_SITE_URL names the custom domain", () => {
    expect(siteUrl({})).toBe(`https://${AZURE_HOST}`);
    expect(siteUrl({ CEO_SITE_URL: "https://ceo.nikita.page" })).toBe("https://ceo.nikita.page");
    expect(siteUrl({ CEO_SITE_URL: " https://ceo.nikita.page/ " })).toBe("https://ceo.nikita.page");
    for (const bad of ["http://ceo.nikita.page", "https://attacker.example", "https://ceo.nikita.page:8443", "https://ceo.nikita.page/x", "not a url"]) {
      expect(siteUrl({ CEO_SITE_URL: bad })).toBe(`https://${AZURE_HOST}`);
    }
  });

  it("keeps every cookie host-only, so each host keeps its own", async () => {
    const lines = [cookie("__Host-ceo-desk", "v", 60), clearSiteCookie(), (await makeState("k".repeat(32), "p", 0)).cookie];
    for (const line of lines) {
      expect(line).not.toMatch(/;\s*domain=/i);
      expect(line).toContain("Secure");
      expect(line).toContain("Path=/");
    }
  });
});

describe("the Gmail callback on both hosts", () => {
  const client = { clientId: "cid", clientSecret: "s", redirectUri: DEFAULT_REDIRECT };
  const at = (origin: string) => new Request(`${origin}${CALLBACK_PATH}`);

  it("goes back to the host that started the connect", () => {
    expect(redirectFor(client, at("https://ceo.nikita.page")).redirectUri).toBe(`https://ceo.nikita.page${CALLBACK_PATH}`);
    expect(redirectFor(client, at(`https://${AZURE_HOST}`)).redirectUri).toBe(`https://${AZURE_HOST}${CALLBACK_PATH}`);
  });

  it("keeps the configured redirect for any other host", () => {
    for (const origin of ["https://attacker.example", "http://ceo.nikita.page", "https://ceo.nikita.page:444", "http://localhost:5173"]) {
      expect(redirectFor(client, at(origin)).redirectUri).toBe(DEFAULT_REDIRECT);
    }
  });
});
