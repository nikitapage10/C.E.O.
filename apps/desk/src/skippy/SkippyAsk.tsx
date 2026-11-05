import { useSkippy } from "./chat.ts";
import { SkippyComposer } from "./SkippyChat.tsx";
import "./skippy.css";

/**
 * The compact "Ask Skippy" box: one line to type or say something, right on the page. Sending opens the dialogue so
 * the answer and its buttons have room. Self-contained: the caller only places it.
 */
export function SkippyAsk({ className = "" }: { className?: string }) {
  const setOpen = useSkippy((s) => s.setOpen);
  return (
    <section className={`skp-ask ${className}`} aria-label="Ask Skippy">
      <span className="skp-ask__label" aria-hidden="true">
        Ask Skippy
      </span>
      <SkippyComposer compact onSent={() => setOpen(true)} placeholder="Ask anything, or tell me an idea and I'll route it…" />
    </section>
  );
}
