import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RESULT_LINE, SignInPanel, type SignInProps } from "./SignIn.tsx";
import { creationOptions, fromB64url, guessDevice, requestOptions, toB64url, waitLine, type AuthView } from "./signin.ts";

const NOW = Date.parse("2026-10-14T09:00:00Z");
const noop = () => {};

function render(auth: AuthView, extra: Partial<SignInProps> = {}): string {
  return renderToStaticMarkup(
    createElement(SignInPanel, { auth, now: NOW, onSignIn: noop, onAdd: noop, onEnrol: noop, onSignOut: noop, onRemove: noop, defaultLabel: "Windows PC", ...extra }),
  );
}

describe("the Desk's sign-in step (#132)", () => {
  it("shows nothing while checking, or when sign-in isn't set up", () => {
    expect(render({ status: "checking" })).toBe("");
    expect(render({ status: "off" })).toBe("");
  });

  it("signed out: a passkey button and Add this device, in the Desk's own look, never asking for the key up front", () => {
    const html = render({ status: "out" });
    expect(html).toContain('class="desk-auth"');
    expect(html).toContain("Sign in with a passkey");
    expect(html).toContain("Add this device");
    expect(html).toContain("btn btn--go btn--sm");
    expect(html).not.toContain('type="password"');
  });

  it("adding a device asks for its name and the Desk key, once", () => {
    const html = render({ status: "out" }, { adding: true });
    expect(html).toContain('value="Windows PC"');
    expect(html).toContain('type="password"');
    expect(html).toContain("asked once to enrol this device");
    expect(html).toMatch(/autocomplete="current-password"/i);
  });

  it("locked out: a plain line with the time left, and the buttons off", () => {
    const html = render({ status: "out", lockedUntil: NOW + 14 * 60_000 });
    expect(html).toContain("Locked for now after too many wrong tries. Try again in 14 min.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Sign in with a passkey/);
  });

  it("says what went wrong after a try", () => {
    expect(render({ status: "out" }, { note: RESULT_LINE["wrong-key"] })).toContain("That Desk key didn&#x27;t match.");
  });

  it("signed in: the device, until when at the latest, the devices and a sign-out", () => {
    const html = render({
      status: "in",
      device: "iPhone",
      until: NOW + 30 * 60_000,
      hardUntil: NOW + 12 * 3_600_000,
      devices: [
        { id: "a", label: "iPhone", added: "2026-10-14T08:00:00Z", used: null, current: true },
        { id: "b", label: "Windows PC", added: "2026-10-13T08:00:00Z", used: null, current: false },
      ],
    });
    // The device names wear the Hide veil's marker (hide.ts).
    expect(html).toContain('Signed in on <b class="wv-private" data-private="">iPhone</b>');
    expect(html).toContain("at the latest");
    expect(html).toContain("Devices (2)");
    expect(html).toContain('<span class="wv-private" data-private="">iPhone</span> (this one)');
    expect(html.match(/>Remove</g)).toHaveLength(2);
    expect(html).toContain("Sign out");
  });

  it("inside a card: only the step, with a Cancel, and nothing once signed in", () => {
    expect(render({ status: "out" }, { compact: true, onCancel: noop })).toContain("Cancel");
    expect(render({ status: "out" }, { compact: true })).toContain("desk-auth--compact");
    expect(render({ status: "in", device: "iPhone" }, { compact: true })).toBe("");
  });
});

describe("the browser side of WebAuthn (#132)", () => {
  it("turns base64url into bytes and back", () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(toB64url(bytes)).toBe("AAH6-_z9_v8");
    expect(new Uint8Array(fromB64url(toB64url(bytes)))).toEqual(bytes);
  });

  it("turns the server's options into what the browser takes", () => {
    const create = creationOptions({ challenge: "AAE", rp: { id: "ceo.test", name: "C.E.O. Desk" }, user: { id: "Y2VvLWRlc2s", name: "Desk", displayName: "C.E.O. Desk" }, pubKeyCredParams: [], excludeCredentials: [{ id: "AQI", type: "public-key" }] });
    expect(new Uint8Array(create.challenge as ArrayBuffer)).toEqual(new Uint8Array([0, 1]));
    expect(new TextDecoder().decode(create.user.id as ArrayBuffer)).toBe("ceo-desk");
    expect(new Uint8Array(create.excludeCredentials![0]!.id as ArrayBuffer)).toEqual(new Uint8Array([1, 2]));
    const get = requestOptions({ challenge: "AAE", rpId: "ceo.test" });
    expect(get.allowCredentials).toEqual([]);
  });

  it("names a device by what it is, never who owns it", () => {
    expect(guessDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
    expect(guessDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows PC");
    expect(guessDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile")).toBe("Android phone");
    expect(guessDevice("")).toBe("This device");
  });

  it("says how long a lockout has left", () => {
    expect(waitLine(30_000)).toBe("30 s");
    expect(waitLine(14 * 60_000)).toBe("14 min");
  });
});
