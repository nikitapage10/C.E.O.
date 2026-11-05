/**
 * Whether a Talk call is live (#506). While it is, the chat looks for answers to hand-offs every few seconds instead of
 * every fifteen, so an answer is put into the call the moment it lands rather than when Skippy happens to poll. Tiny
 * on purpose: talk.ts (the Desk's first load) and handoff.ts (loaded with the round trip) both read it.
 */
let live = false;
export const callIsLive = (): boolean => live;
export const setCallLive = (on: boolean): void => {
  live = on;
};
