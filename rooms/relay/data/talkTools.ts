import { spokenMask, talkCard, useCompose, type Compose } from "./compose.ts";
import { useTexts } from "./texts.ts";

/**
 * Skippy's texting tools on a Talk call (#536): ElevenLabs client tools, run here in Nikita's browser, so a send goes
 * through this device's own passkey unlock and the texts line's ordinary send request (#535), never from a server.
 *
 *   draft_text    who and the gist → the card (as in the typed chat), then the name, the last 4 digits or masked
 *                 address and the full text for Skippy to read aloud, word for word, and ask "send?"
 *   pick_contact  the number of one of the choices, when the name fits several
 *   edit_text     Nikita's change, as the whole new text: the card refreshes and Skippy reads it again and asks again
 *   send_text     asks to send: refused unless Nikita's own transcript said "send" after this very version was read
 *                 to him (compose.ts, `heard`), or he tapped Send on the card; and unless this device is unlocked
 *   cancel_text   drops the card
 *
 * What a tool answers is for the agent: the card's name, mask and text go to the call so Skippy can read them out
 * (docs/RELAY-PRIVACY.md, "Texts Skippy writes"). Nothing here is logged.
 */

/** The most a tool waits on the Mac before it answers (ElevenLabs' client tool timeout is set to 60 s). */
export const TOOL_WAIT_MS = 50_000;
const STEP_MS = 3_000;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for the card to leave drafting or sending, looking every few seconds; the card as it is when it does (or at the limit). */
export async function settle(key: string, until: (c: Compose) => boolean, wait = TOOL_WAIT_MS): Promise<Compose | null> {
  const end = Date.now() + wait;
  for (;;) {
    const c = useCompose.getState().items[key];
    if (!c || until(c) || Date.now() >= end) return c ?? null;
    await pause(STEP_MS);
    await useTexts.getState().refresh();
    useCompose.getState().sync();
  }
}

/** What Skippy reads out, and the rule for what comes next. Marks this version as read. */
export function readAloud(c: Compose): string {
  useCompose.getState().readOut(c.key);
  const card = useTexts.getState().view?.cards.find((x) => x.id === c.card);
  const to = `${card?.name ?? c.who}, ${spokenMask(card?.mask ?? null)}${card ? `, by ${card.channel}` : ""}`;
  return `Draft ready. Read Nikita both, word for word, nothing added: it goes to ${to}, and it says: "${c.text}". Then ask whether to send it. Call send_text only after he says "send". If he wants it changed, call edit_text with the whole new text. If he says no, call cancel_text.`;
}

function describe(c: Compose | null): string {
  if (!c) return "The text card is gone. Ask Nikita what he wants to send.";
  switch (c.phase) {
    case "ready":
      return readAloud(c);
    case "choices": {
      const card = useTexts.getState().view?.cards.find((x) => x.id === c.card);
      const list = (card?.choices ?? []).map((x, i) => `${i + 1}: ${x.name}, ${spokenMask(x.mask)}`).join("; ");
      return `"${c.who}" fits more than one contact: ${list}. Ask Nikita which one, then call pick_contact with its number.`;
    }
    case "none":
      return `There's no contact called "${c.who}" on the Mac. Ask Nikita who he means, then call draft_text again.`;
    case "off":
      return "Relay keeps that one away from Blasto (money, legal, a code or someone on the skip list). Tell Nikita to text it himself.";
    case "nochat":
      return "That contact's number has no country code and Messages has no chat with them, so Relay won't guess one. Tell Nikita to text this one himself.";
    case "moved":
      return "Not sent: Nikita has texted them since the card was written. Tell him to check Messages and ask again if he still wants it.";
    case "error":
      return `${c.note || "That didn't work."} Tell Nikita in one line.`;
    case "drafting":
    case "asking":
      return "Blasto is still writing it. Tell Nikita the card will show in the chat in a moment; he can tap Send there, or ask you to read it when it lands.";
    case "sending":
      return "It's on its way to the Mac. Say so in a few words.";
    case "sent":
      return "Sent. Say so in a few words.";
    case "unsent":
      return `${c.note || "It didn't go through."} The card in the chat has Resend; tell Nikita in one line.`;
    default:
      return "There's no text waiting.";
  }
}

const done = (c: Compose) => c.phase !== "asking" && c.phase !== "drafting" && c.phase !== "sending";
const drafted = (c: Compose) => c.phase !== "asking" && c.phase !== "drafting";

/** The client tools, by name, for @elevenlabs/client's `clientTools`. `onCard` puts the card in the chat. */
export function talkTools(onCard: (key: string) => void) {
  return {
    draft_text: async (p: { who?: unknown; gist?: unknown }) => {
      const who = typeof p?.who === "string" ? p.who : "";
      const gist = typeof p?.gist === "string" ? p.gist : "";
      if (!who.trim() || !gist.trim()) return "Ask Nikita who it's for and what it should say.";
      const key = useCompose.getState().start(who, gist, "talk");
      onCard(key);
      return describe(await settle(key, drafted));
    },
    pick_contact: async (p: { choice?: unknown }) => {
      const c = talkCard();
      const card = c ? useTexts.getState().view?.cards.find((x) => x.id === c.card) : undefined;
      const n = Number(p?.choice);
      const choice = card && Number.isInteger(n) ? card.choices[n - 1] : undefined;
      if (!c || !choice) return "That isn't one of the choices. Ask again.";
      await useCompose.getState().pick(c.key, choice.pick);
      return describe(await settle(c.key, drafted));
    },
    edit_text: async (p: { text?: unknown }) => {
      const c = talkCard();
      if (!c || (c.phase !== "ready" && c.phase !== "unsent")) return describe(c);
      if (typeof p?.text !== "string" || !p.text.trim()) return "Ask Nikita what it should say instead.";
      useCompose.getState().edit(c.key, p.text);
      const now = useCompose.getState().items[c.key]!;
      return `Card updated. ${readAloud(now)}`;
    },
    send_text: async () => {
      const c = talkCard();
      if (!c) return describe(c);
      const got = await useCompose.getState().send(c.key, { said: true });
      if (got === "unconfirmed") return "Not sent. Nikita hasn't said send for this exact text since you read it to him. Read it again, word for word, and ask.";
      if (got === "locked") return "Not sent: sending is locked on this device. Nikita taps Unlock sending on the card (his passkey), then says send again or taps Send.";
      if (got === "not-ready") return describe(c);
      if (got === "error") return describe(useCompose.getState().items[c.key] ?? null);
      return describe(await settle(c.key, done, 30_000));
    },
    cancel_text: async () => {
      const c = talkCard();
      if (c) await useCompose.getState().cancel(c.key);
      return "Dropped. Nothing was sent.";
    },
  };
}

/** One of Nikita's own lines on the call, as transcribed: the only way a spoken "send" counts (compose.ts, `heard`). */
export const heard = (words: string) => useCompose.getState().heard(words);
