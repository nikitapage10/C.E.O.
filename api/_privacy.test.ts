import { describe, expect, it } from "vitest";
import { fullWidth } from "./_security/fixtures/payloads.ts";
import { heldWords, luhn, privateParts, type PrivateKind } from "./_privacy.ts";

const ZWSP = "​";

/** Text the Desk must hold back, and the kind it is held back as. Every value is made up. */
const HITS: [PrivateKind, string][] = [
  ["email", "Send the report to sam.reyes@example.com every morning"],
  ["email", `Mail ${fullWidth("sam.reyes@example.com")} when it ships`],
  ["email", `Mail sam.re${ZWSP}yes@exa${ZWSP}mple.com when it ships`],
  ["email", "write to sam.reyes [at] example [dot] com"],
  ["email", "write to sam (at) example (dot) co (dot) uk"],
  ["email", "my address is sam reyes at gmail dot com"],
  ["phone", "Text me at +1 (555) 867-5309 when it ships"],
  ["phone", "call 555-867-5309"],
  ["phone", "call 555.867.5309 tonight"],
  ["phone", "call (555) 867 5309"],
  ["phone", "ring 5558675309"],
  ["phone", "ring +44 20 7946 0958 in London"],
  ["phone", "ring +49-30-1234567"],
  ["phone", `Ring ${fullWidth("+1 (555) 867-5309")}`],
  ["phone", "my number is five five five eight six seven five three oh nine"],
  ["address", "Ship it to 742 Evergreen Terrace"],
  ["address", "the office at 1600 Pennsylvania Avenue NW"],
  ["address", "meet at 221B Baker Street"],
  ["address", "it's 12 n main st"],
  ["address", "send it to PO Box 1234"],
  ["address", "I'm in apt 4B"],
  ["card", "card 4111 1111 1111 1111 expires soon"],
  ["card", "card 4111-1111-1111-1111"],
  ["card", "card 4111111111111111"],
  ["card", "amex 3782 822463 10005"],
  ["account", "my SSN is 123-45-6789"],
  ["account", "IBAN GB82 WEST 1234 5698 7654 32"],
  ["account", "account number 12345678"],
  ["account", "routing # 021000021"],
  ["account", "passport no. X12345678"],
  ["key", "use sk-ant-api03-abcdefghijklmnopqrstuvwxyz"],
  ["key", `key sk-ant-${ZWSP}api03-SECRETSECRETSECRETSECRET`],
  ["key", "token ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
  ["key", "AWS key AKIAIOSFODNN7EXAMPLE"],
  ["key", "the jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
  ["key", "-----BEGIN RSA PRIVATE KEY----- MIIEow"],
  ["key", "the Desk key is hunter2"],
  ["key", "password: correct-horse-42"],
  ["key", "PIN is 4821"],
  ["key", "store a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8 somewhere"],
  ["name", "Have Rusty build a birthday banner for my sister Maya"],
  ["name", "my friend Sam Reyes wants a podium"],
  ["name", "our neighbour, Jo Park, asked"],
  ["name", "ask Mrs. Jane Doe"],
  ["name", "add Sam Reyes's phone to the Desk"],
];

/** Everyday Desk text, much of it number-heavy or pop-culture, that must go through. */
const CLEAN = [
  "Make the Desk blue and add a podium to the Foundry.",
  "Shrink pictures to 1600 px on the long side, 4 MB at most, and keep notes under 2,000 characters.",
  "Sizes 1600 1200 800 400 for the banner stills.",
  "Cap Gemini at $5 a month and the world at $6 of the $10.",
  "Ship it on 2026-10-14 at 9:00 MT, like issue #127 and PR #129.",
  "Bump react@18.3.1 and @vercel/blob 2.8.1.",
  "Clone git@github.com:nikitapage10/C.E.O.git into the dock.",
  "Pin actions to SHA 2f062e7a1b2c3d4e5f60718293a4b5c6d7e8f901 like the others.",
  "A 5 minute drive from the Spire, 3 steps down the road, take 2 more ways round.",
  "Give Rusty a legally distinct Dr. Strange cape and Rocky a Mr. Freeze helmet.",
  "Rocky's best friend Grace teaches him words, like in Project Hail Mary.",
  "my friend Rusty should get a dog, and my boss Skippy approves.",
  "The token is expired, so the secret: rotate it weekly.",
  "Add a 1 TB drive to the Archive and a 2 GB cache.",
  "Use the MIT license and the 2026 year in the footer.",
  "Show 3 more Trail steps and the last 12 hours.",
  "Darrow and Mustang from Red Rising, Shepard from Mass Effect.",
  "Show the 13 newest commits and 40 issues.",
  "See https://example.com/docs for the idea.",
  "Add a timer: 10 20 30 40 50 60 seconds.",
  "Add a podium to the Foundry. ".repeat(60),
];

describe("the privacy check on Desk text (#127)", () => {
  it.each(HITS)("holds back %s: %s", (kind, text) => {
    expect(privateParts(text)).toContain(kind);
  });

  it.each(CLEAN.map((t) => [t.slice(0, 60), t]))("lets through: %s", (_, text) => {
    expect(privateParts(text)).toEqual([]);
  });

  it("names every kind it found, in a fixed order, once each", () => {
    expect(privateParts("Text +1 555 867 5309 or sam@example.com, card 4111 1111 1111 1111, or call 555-867-5309")).toEqual(["email", "phone", "card"]);
  });

  it("says what it held in plain words", () => {
    expect(heldWords(["email"])).toBe("an email address");
    expect(heldWords(["email", "phone", "name"])).toBe("an email address, a phone number and a person's name");
    expect(heldWords([])).toBe("");
  });

  it("checks card numbers with Luhn, so a long count isn't a card", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
    expect(privateParts("card 4111 1111 1111 1112")).toEqual([]);
  });

  it("stays fast on long, hostile input", () => {
    const started = Date.now();
    for (const text of ["a".repeat(20_000), "1 ".repeat(10_000), "x@".repeat(10_000), "my friend ".repeat(2_000), `${"5 ".repeat(5_000)}street`]) privateParts(text);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
