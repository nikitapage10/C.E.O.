import type { ReactNode } from "react";
import { HIDDEN_LABEL, privateAttrs, useHide } from "./hide.ts";

/**
 * A personal value on the Desk: a name, a message, an amount, a device. While Hide is on the CSS lays a woven veil over
 * it (or blurs it, for a `block`), the real text is kept from screen readers, and they hear `label` ("hidden") instead.
 */
export function Private({ children, block = false, label = HIDDEN_LABEL, as: Tag = "span", className }: { children: ReactNode; block?: boolean; label?: string; as?: "span" | "b" | "div" | "p"; className?: string }) {
  const on = useHide((s) => s.on);
  return (
    <>
      <Tag className={className ? `wv-private ${className}` : "wv-private"} {...privateAttrs(on, block)}>
        {children}
      </Tag>
      {on && <span className="wv-sr">{label}</span>}
    </>
  );
}

/** The bar's Hide button: an eye, open or closed. Shift+H toggles it too (Desk.tsx). */
export function HideButton() {
  const on = useHide((s) => s.on);
  const toggle = useHide((s) => s.toggle);
  return (
    <button type="button" className="wv-navbtn wv-hide" data-on={on || undefined} aria-pressed={on} onClick={toggle} title={on ? "Personal details are hidden: show them (Shift+H)" : "Hide personal details, to show the Desk to someone (Shift+H)"}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path className="wv-hide__lid" d="M2.8 12C5 8.2 8.2 6.2 12 6.2s7 2 9.2 5.8c-2.2 3.8-5.4 5.8-9.2 5.8S5 15.8 2.8 12z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <circle className="wv-hide__iris" cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path className="wv-hide__slash" d="M4.5 19.5 19.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>{on ? "Hidden" : "Hide"}</span>
    </button>
  );
}
