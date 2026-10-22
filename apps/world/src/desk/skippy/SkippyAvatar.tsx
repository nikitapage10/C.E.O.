import { forwardRef } from "react";
import { useSkippy } from "./chat.ts";
import "./skippy.css";

/** Skippy's portrait: his own model, photographed in the portrait studio (scripts/portraits.mjs, `--only=skippy`). */
export const SKIPPY_PORTRAIT = "/desk/skippy.webp";

export interface SkippyAvatarProps {
  /** sm 40px, md 64px, lg 96px. */
  size?: "sm" | "md" | "lg";
  /** What a click does; opens the chat by default. */
  onOpen?: () => void;
  /** Shows the "Ask me" tag beside him. */
  tag?: boolean;
  className?: string;
}

/**
 * Skippy, the Magnificent, hovering in his admiral's can: click (or Enter, or Space) and the chat opens. He bobs
 * gently and his glow breathes while he's thinking; with reduced motion he holds still. Placement is the caller's:
 * this is only the button.
 */
export const SkippyAvatar = forwardRef<HTMLButtonElement, SkippyAvatarProps>(function SkippyAvatar({ size = "md", onOpen, tag = false, className = "" }, ref) {
  const busy = useSkippy((s) => s.busy);
  const open = useSkippy((s) => s.open);
  const setOpen = useSkippy((s) => s.setOpen);
  return (
    <button
      ref={ref}
      type="button"
      className={`skp-avatar skp-avatar--${size}${busy ? " skp-avatar--busy" : ""} ${className}`}
      onClick={onOpen ?? (() => setOpen(!open))}
      aria-expanded={open}
      aria-controls="skippy-chat"
      aria-label={open ? "Close the chat with Skippy" : "Talk to Skippy, the Magnificent"}
      title="Talk to Skippy"
    >
      <span className="skp-avatar__glow" aria-hidden="true" />
      <img className="skp-avatar__can" src={SKIPPY_PORTRAIT} alt="" width={192} height={192} decoding="async" />
      {tag && (
        <span className="skp-avatar__tag" aria-hidden="true">
          {busy ? "Thinking…" : "Ask me"}
        </span>
      )}
    </button>
  );
});
