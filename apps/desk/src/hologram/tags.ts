/**
 * Audio tags (#481, #490): Skippy's and his subminds' lines carry ElevenLabs v3 tags such as "[smug]", "[fast]" or
 * "[laughs]" for the voice. They stay in what goes to the voice and come out of every place the call's text is shown:
 * the hologram's caption, the chat's transcript and the Desk's lists of what was said. A leaf, so any of those can
 * import it without pulling in the call.
 */
const TAG = /\[[a-z][a-z0-9 ,.\-'’]{0,40}\]/gi;

/** A line as it reads on screen: every [tag] gone, the spaces it leaves tidied. */
export const stripTags = (text: string) =>
  text
    .replace(TAG, "")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
