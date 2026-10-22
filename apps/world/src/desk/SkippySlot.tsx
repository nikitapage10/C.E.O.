import { useId, useRef, useState } from "react";

/**
 * Where Skippy, the Magnificent sits on the Desk: a glowing can you can click, and an "Ask Skippy" box. A placeholder
 * (Nikita, 2026-10-22): the chat itself, typed and spoken, is being built on its own branch (chat/224-skippy-chat,
 * `SkippyAvatar` and `SkippyChat` in ./skippy/), and replaces what is inside these two components when it lands. Until
 * then the box says plainly that his line isn't open yet; nothing is sent anywhere.
 */

/** Skippy as a small glowing can in an admiral's hat, drawn rather than photographed: he has no portrait. */
export function SkippyCan({ size = 44, className = "" }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={`skippy-can ${className}`} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}b`} x1="0" x2="1">
          <stop offset="0" stopColor="#5b6478" />
          <stop offset="0.35" stopColor="#dfe6f2" />
          <stop offset="0.55" stopColor="#f8fbff" />
          <stop offset="1" stopColor="#6f7a90" />
        </linearGradient>
        <linearGradient id={`${id}g`} x1="0" x2="1">
          <stop offset="0" stopColor="#8a6a2c" />
          <stop offset="0.5" stopColor="#f6d58c" />
          <stop offset="1" stopColor="#8a6a2c" />
        </linearGradient>
        <radialGradient id={`${id}h`}>
          <stop offset="0" stopColor="#bfe3ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#bfe3ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="27" r="22" fill={`url(#${id}h)`} className="skippy-can__halo" />
      {/* the hat */}
      <path d="M12 13.5c3-4.5 7.5-6.5 12-6.5s9 2 12 6.5c-3.5 1.2-7.5 1.8-12 1.8s-8.5-.6-12-1.8z" fill="#141a28" stroke={`url(#${id}g)`} strokeWidth="1.1" />
      <circle cx="24" cy="10.6" r="1.5" fill="#f6d58c" />
      {/* the can */}
      <rect x="15" y="15.5" width="18" height="25" rx="3.2" fill={`url(#${id}b)`} />
      <ellipse cx="24" cy="16" rx="9" ry="1.8" fill="#c9d2e2" />
      <rect x="15" y="25" width="18" height="5.5" fill={`url(#${id}g)`} opacity="0.95" />
      <circle cx="20.5" cy="21" r="1.2" fill="#0d1a2e" />
      <circle cx="27.5" cy="21" r="1.2" fill="#0d1a2e" />
      <path d="M20.5 34.5c2 1.3 5 1.3 7 0" stroke="#0d1a2e" strokeWidth="1.1" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** The can, as a button: opens Skippy's line once it exists; for now it takes you to the Ask box. */
export function SkippyAvatarSlot({ size = 44, onOpen, label = "Talk to Skippy" }: { size?: number; onOpen?: () => void; label?: string }) {
  return (
    <button type="button" className="skippy-slot__avatar" onClick={onOpen} aria-label={label} title={label}>
      <SkippyCan size={size} />
    </button>
  );
}

/** "Ask Skippy": typed now, spoken once the chat lands. Says honestly that the line isn't open yet. */
export function AskSkippySlot({ inputRef }: { inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState("");
  const [said, setSaid] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  return (
    <form
      className="ask-skippy"
      role="search"
      aria-label="Ask Skippy"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) setSaid(true);
      }}
    >
      <span className="ask-skippy__spark" aria-hidden="true" />
      <input
        ref={ref}
        className="ask-skippy__input"
        type="text"
        value={text}
        placeholder="Ask Skippy anything…"
        aria-label="Ask Skippy"
        onChange={(e) => {
          setText(e.target.value);
          setSaid(false);
        }}
      />
      <button type="submit" className="ask-skippy__go" aria-label="Ask" disabled={!text.trim()}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 10h11M11 5.5 15.5 10 11 14.5" />
        </svg>
      </button>
      {said && (
        <p className="ask-skippy__note" role="status">
          Skippy's line opens here very soon. He's rehearsing.
        </p>
      )}
    </form>
  );
}
