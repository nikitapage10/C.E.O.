/**
 * Skippy, the Magnificent on the Desk (#224): his avatar, the dialogue, and the compact "Ask Skippy" box. Each piece
 * is self-contained (its own styles in skippy.css, its own store in chat.ts), so a page only places them.
 */
export { SkippyAvatar, SKIPPY_PORTRAIT, type SkippyAvatarProps } from "./SkippyAvatar.tsx";
export { SkippyChat, SkippyComposer, type SkippyChatProps } from "./SkippyChat.tsx";
export { SkippyAsk } from "./SkippyAsk.tsx";
export { useSkippy } from "./chat.ts";
