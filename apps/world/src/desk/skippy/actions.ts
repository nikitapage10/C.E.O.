import { navigateTo } from "../../route.ts";
import { expectChange } from "../../foundry.ts";
import { fileIdea, post, type Sent } from "../IdeaCard.tsx";
import { ensureSignedIn } from "../signin.ts";
import { actionPath, type ActionState, type SkippyAction } from "./chat.ts";

/**
 * What a tap on one of Skippy's buttons does. Every write goes through the Desk's own buttons, never anything new:
 * an idea is filed exactly as the Suggest box files it (`fileIdea`, so Rivet shapes it and the labels and the
 * auto-approval rules are unchanged), and an answer to Rivet goes as the idea card's own "answer" click. Skippy can't
 * approve or build anything; there is no button for it.
 */
export interface ActionDeps {
  signIn: () => Promise<string>;
  fileIdea: (text: string, onHeld: (message: string) => void) => Promise<Sent>;
  answer: (issue: number, text: string, onHeld: (message: string) => void) => Promise<Sent>;
  go: (path: string) => void;
}

const defaults: ActionDeps = {
  signIn: ensureSignedIn,
  fileIdea: (text, onHeld) => fileIdea(text, [], onHeld),
  answer: async (issue, text, onHeld) => {
    const r = (await post(issue, "answer", text, onHeld)).r;
    if (r === "ok" || r === "shaping") expectChange();
    return r;
  },
  go: navigateTo,
};

const stateOf = (r: Sent): ActionState => (r === "ok" || r === "shaping" ? "done" : r === "held" ? "held" : r === "signed-out" ? "signed-out" : "failed");

/** Runs a tapped action; `onHeld` gets the Desk's own held-back message when the privacy check stops it. */
export async function runAction(a: SkippyAction, onHeld: (message: string) => void = () => {}, deps: ActionDeps = defaults): Promise<ActionState> {
  const path = actionPath(a);
  if (path) {
    deps.go(path);
    return "done";
  }
  if ((await deps.signIn()) !== "ok") return "signed-out";
  if (a.kind === "idea") return stateOf(await deps.fileIdea(a.text, onHeld));
  if (a.kind === "answer") return stateOf(await deps.answer(a.issue, a.text, onHeld));
  return "failed";
}
