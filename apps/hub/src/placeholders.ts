import { PRIVACY_PATTERNS } from "../../../api/_privacy.ts";

/**
 * Names and numbers become placeholders before any model call (docs/RELAY-PRIVACY.md, "Mac to the model API"). The
 * contact's own name and handle become "Contact" (or "Member 1"… in a group), every name from Nikita's contacts that
 * appears in the text becomes "Person 1"…, and phone numbers, email addresses, street addresses, card and account
 * numbers, keys and one-time codes become `[phone]`, `[email]`, `[address]`, `[card]`, `[account]`, `[key]`, `[code]`,
 * using the Desk privacy check's own patterns (api/_privacy.ts). The map back lives in this object for one call only,
 * and `restore` puts names back only into the draft Nikita sees. A name the hub doesn't know can still go through as
 * written: that is the residual risk, as the privacy page says.
 */

const KIND_ORDER = ["key", "email", "card", "account", "address", "phone"] as const;
/** One-time codes: 4 to 8 digits standing alone, or G-123456 style. */
const CODE = /\b(?:[A-Z]-)?\d{4,8}\b/g;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const global = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);

export interface Known {
  /** Who the thread is with: their display name parts and their handle (number or address). */
  contact?: { names: string[]; handle: string };
  /** Group members, in order, as "Member 1"…: their names and handles. */
  members?: { names: string[]; handle: string }[];
  /** Every other name in Nikita's contacts (first, last and full), for "Person N". */
  others: string[];
}

export class Placeholders {
  private readonly back = new Map<string, string>();
  private readonly people = new Map<string, string>();
  private readonly rules: [RegExp, string][] = [];

  constructor(known: Known) {
    const add = (value: string, label: string) => {
      const v = value.trim();
      if (v.length < 2) return;
      this.rules.push([new RegExp(`(?<![\\p{L}\\p{N}])${escape(v)}(?![\\p{L}\\p{N}])`, "giu"), label]);
    };
    // Each name whole, then each part of it (first, last), longest first: "Riley" alone is caught as well as "Riley Test".
    const withParts = (names: string[]) => [...new Set(names.flatMap((n) => [n.trim(), ...n.trim().split(/\s+/)]).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length);
    if (known.contact) {
      for (const name of withParts(known.contact.names)) add(name, "Contact");
      add(known.contact.handle, "Contact");
      const first = known.contact.names.find((x) => x.trim().length >= 2);
      if (first) this.back.set("Contact", first.trim().split(/\s+/)[0]!);
    }
    known.members?.forEach((m, i) => {
      for (const name of withParts(m.names)) add(name, `Member ${i + 1}`);
      add(m.handle, `Member ${i + 1}`);
    });
    // Longer names first, so "Sam Reyes" goes before "Sam".
    const others = withParts(known.others);
    for (const name of others) {
      if (this.rules.some(([re]) => re.test(name))) continue;
      this.rules.push([new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, "giu"), "\u0000person"]);
    }
    // Rules are tested against names above; reset their lastIndex.
    for (const [re] of this.rules) re.lastIndex = 0;
  }

  /** The text with every known name, handle and number swapped for its placeholder. */
  swap(raw: string): string {
    let text = raw.normalize("NFKC").replace(/\p{Cf}/gu, "");
    for (const [re, label] of this.rules) {
      text = text.replace(re, (m) => {
        if (label !== "\u0000person") return label;
        const key = m.toLowerCase();
        let p = this.people.get(key);
        if (!p) {
          p = `Person ${this.people.size + 1}`;
          this.people.set(key, p);
          this.back.set(p, m);
        }
        return p;
      });
    }
    for (const kind of KIND_ORDER) for (const re of PRIVACY_PATTERNS[kind]) text = text.replace(global(re), `[${kind}]`);
    return text.replace(CODE, "[code]");
  }

  /** A model's draft with the names put back, for Nikita's eyes only. Numbers stay as placeholders. */
  restore(draft: string): string {
    let out = draft;
    for (const [label, name] of this.back) out = out.replace(new RegExp(`\\b${escape(label)}\\b`, "g"), name);
    return out;
  }
}
