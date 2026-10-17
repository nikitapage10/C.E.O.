import type { Route } from "../route.ts";

/**
 * The setup list on Today (#164): the few things only Nikita can do, gathered from docs/SECURITY.md and
 * docs/DELIVERY.md into one card, each with a link straight to the right settings page and the steps. Every step
 * works in a browser on the PC (Vercel's and GitHub's own pages, or the browser's console), never from a repo folder.
 *
 * Whether each is done comes from GET /api/foundry?setup (api/_desk/setup.ts): "done", "todo" or "unknown", never a
 * value. An item the site can't check can be ticked by hand; that tick lives only in this browser.
 */

export type SetupState = "done" | "todo" | "unknown";
export type SetupItemId = "pings" | "app" | "devices" | "ruleset" | "automerge";

export interface SetupStatus {
  items: Record<SetupItemId, SetupState>;
  pings: { vercel: SetupState; actions: SetupState };
}

export interface SetupLink {
  label: string;
  href: string;
  /** A Desk page: opened in place rather than in a new tab. */
  route?: Route;
}

export interface SetupItem {
  id: SetupItemId;
  title: string;
  /** Why it matters, in one line. */
  why: string;
  /** How the item ticks itself off. */
  ticks: string;
  links: SetupLink[];
  /** The steps, in order. `**words**` are the names of buttons and pages, shown in bold. */
  steps: string[];
  /** A paste for the browser's console, with a Copy button. */
  paste?: string;
}

const REPO = "https://github.com/nikitapage10/C.E.O.";
/** Vercel's own "pick the project" link to its Environment Variables page. */
export const VERCEL_ENV = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fsettings%2Fenvironment-variables&title=Environment+Variables";
const VERCEL_DEPLOYMENTS = "https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fdeployments&title=Deployments";
const SITE = "command-everything-obviously.vercel.app";

/** Makes the push key pair and the shared secret with the browser's own crypto (docs/SECURITY.md, "Setting up pings"). */
export const PINGS_PASTE =
  'const k=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign"]);const b=a=>btoa(String.fromCharCode(...a)).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");console.log("DESK_VAPID_PUBLIC_KEY",b(new Uint8Array(await crypto.subtle.exportKey("raw",k.publicKey))));console.log("DESK_VAPID_PRIVATE_KEY",(await crypto.subtle.exportKey("jwk",k.privateKey)).d);console.log("DESK_PINGS_SECRET",b(crypto.getRandomValues(new Uint8Array(32))));';

export const SETUP_LIST: SetupItem[] = [
  {
    id: "devices",
    title: "Add your phone for sign-in",
    why: "Sign in from the phone too, and a lost device never locks you out of the Desk.",
    ticks: "Ticks itself once two devices can sign in.",
    links: [{ label: "Open the Foundry tab", href: "/foundry", route: "foundry" }],
    steps: [
      `On the phone, open ${SITE} and go to the **Foundry** tab.`,
      "Press **Add this device** and give it a name, like “Phone”.",
      "Type the Desk key once, then confirm with the phone's fingerprint, face or PIN.",
      "That's it: from now on the phone signs in with the passkey alone.",
    ],
  },
  {
    id: "pings",
    title: "Turn on phone pings",
    why: "The Desk pings your phone when an idea, a question or a blocker needs your call, or the live site stops loading.",
    ticks: "Ticks itself once the keys are in Vercel and the hourly ping check gets through with the secret.",
    links: [
      { label: "Vercel: Environment Variables", href: VERCEL_ENV },
      { label: "GitHub: new Actions secret", href: `${REPO}/settings/secrets/actions/new` },
      { label: "Vercel: Deployments", href: VERCEL_DEPLOYMENTS },
    ],
    steps: [
      "On the PC, in Chrome, open any page and press **F12**, then **Console** (type `allow pasting` if Chrome asks).",
      "Paste the line below and press **Enter**. It prints three lines: two keys and a secret.",
      "In Vercel, **Settings** > **Environment Variables**: add `DESK_VAPID_PUBLIC_KEY`, `DESK_VAPID_PRIVATE_KEY` and `DESK_PINGS_SECRET` with the printed values, **Production** only. **Save**.",
      "In GitHub, **Settings** > **Secrets and variables** > **Actions** > **New repository secret**: `DESK_PINGS_SECRET`, the same value.",
      "In Vercel, **Deployments** > the top Production one > **⋯** > **Redeploy**. Close the console.",
      "Then on the phone: **Foundry** tab > **Pings on this device**.",
    ],
    paste: PINGS_PASTE,
  },
  {
    id: "app",
    title: "Give the crew its own GitHub App",
    why: "The Desk and the crew write as ceo-foundry[bot] with hour-long tokens, instead of as you.",
    ticks: "Ticks itself once the App's ID and key are in Vercel.",
    links: [
      { label: "GitHub: new GitHub App", href: "https://github.com/settings/apps/new" },
      { label: "GitHub: Actions secrets", href: `${REPO}/settings/secrets/actions` },
      { label: "Vercel: Environment Variables", href: VERCEL_ENV },
      { label: "Vercel: Deployments", href: VERCEL_DEPLOYMENTS },
    ],
    steps: [
      "Open **New GitHub App**. Name: `ceo-foundry`, exactly. Homepage URL: `" + REPO + "`. Untick **Webhook > Active**.",
      "**Repository permissions**: Actions, Checks, Code scanning alerts and Dependabot alerts **Read-only**; Contents, Issues and Pull requests **Read and write**. Everything else **No access**, Administration and Workflows above all.",
      "**Only on this account**, then **Create GitHub App**. Note the **App ID** at the top.",
      "**Private keys** > **Generate a private key**. A `.pem` file lands in Downloads.",
      "Left sidebar: **Install App** > **Install** > **Only select repositories** > `C.E.O.` > **Install**.",
      "Open the `.pem` in Notepad and copy all of it. In GitHub, C.E.O. > **Settings** > **Secrets and variables** > **Actions**: add `FOUNDRY_APP_ID` and `FOUNDRY_APP_PRIVATE_KEY`.",
      "In Vercel, **Environment Variables**: the same two, **Production** only. **Save**, then **Redeploy** the top Production deployment.",
      "Once a Desk button's comment shows as ceo-foundry[bot], remove `FOUNDRY_GITHUB_TOKEN` in Vercel, revoke it on GitHub, and delete the `.pem`.",
    ],
  },
  {
    id: "ruleset",
    title: "Protect the main branch",
    why: "GitHub refuses force pushes, deleting main and unsigned commits, for every account, agents included.",
    ticks: "Ticks itself once main has the ruleset.",
    links: [
      { label: "GitHub: the ruleset file", href: `${REPO}/blob/main/.github/rulesets/main-now.json` },
      { label: "GitHub: Rulesets", href: `${REPO}/settings/rules` },
    ],
    steps: [
      "Open the ruleset file and press **Download raw file** (the arrow at the top right of the file).",
      "Open **Rulesets** > **New ruleset** > **Import a ruleset**, and pick the downloaded `main-now.json`.",
      "Check it says **Active** with an empty bypass list, then **Create**.",
    ],
  },
  {
    id: "automerge",
    title: "Allow auto-merge",
    why: "Pull requests merge themselves the moment their checks go green, so nothing waits on a click.",
    ticks: "Ticks itself when GitHub shows the setting; if it can't, tick it here once it's on.",
    links: [{ label: "GitHub: repo settings", href: `${REPO}/settings` }],
    steps: [
      "Open **Settings** > **General** and scroll to **Pull Requests**.",
      "Tick **Allow auto-merge**.",
      "While there: tick **Automatically delete head branches**, and leave **Allow squash merging** on.",
    ],
  },
];

/** Whether an item counts as done: the site sees it, or the site can't check and it was ticked by hand here. */
export function isDone(state: SetupState | undefined, ticked: boolean): boolean {
  return state === "done" || (state === "unknown" && ticked);
}

/** The items still to do, in the list's order. Empty means the card hides. */
export function remaining(status: SetupStatus, ticked: ReadonlySet<SetupItemId>): SetupItem[] {
  return SETUP_LIST.filter((i) => !isDone(status.items[i.id], ticked.has(i.id)));
}

/** Reads the answer from api/foundry?setup, keeping only the states it knows; null when it isn't one. */
export function readSetupStatus(given: unknown): SetupStatus | null {
  if (!given || typeof given !== "object") return null;
  const g = given as { items?: Record<string, unknown>; pings?: Record<string, unknown> };
  const state = (v: unknown): SetupState => (v === "done" || v === "todo" ? v : "unknown");
  if (!g.items || typeof g.items !== "object") return null;
  const items = Object.fromEntries(SETUP_LIST.map((i) => [i.id, state(g.items![i.id])])) as Record<SetupItemId, SetupState>;
  return { items, pings: { vercel: state(g.pings?.vercel), actions: state(g.pings?.actions) } };
}

/** Splits a step into plain words, `**bold**` names and `code`. */
export function stepParts(step: string): { text: string; kind: "plain" | "bold" | "code" }[] {
  const out: { text: string; kind: "plain" | "bold" | "code" }[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(step); m; m = re.exec(step)) {
    if (m.index > at) out.push({ text: step.slice(at, m.index), kind: "plain" });
    out.push(m[1] !== undefined ? { text: m[1], kind: "bold" } : { text: m[2]!, kind: "code" });
    at = m.index + m[0].length;
  }
  if (at < step.length) out.push({ text: step.slice(at), kind: "plain" });
  return out;
}

const TICKED_KEY = "desk.setupTicked";

/** The items ticked by hand in this browser (only ones the site can't check count). */
export function readTicked(): Set<SetupItemId> {
  try {
    const got = JSON.parse(window.localStorage.getItem(TICKED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(got) ? got.filter((x): x is SetupItemId => SETUP_LIST.some((i) => i.id === x)) : []);
  } catch {
    return new Set();
  }
}

export function writeTicked(ticked: ReadonlySet<SetupItemId>): void {
  try {
    window.localStorage.setItem(TICKED_KEY, JSON.stringify([...ticked]));
  } catch {
    /* storage blocked: the tick lasts for this visit */
  }
}
