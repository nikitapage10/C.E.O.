import { useState } from "react";
import { DESK_ROOMS, portrait, type DeskRoom } from "./deskData.ts";

/**
 * The Desk's shared pieces: a titled section, an agent's portrait, and a small state pill (the banner over each
 * page is RoomBanner.tsx). All plain HTML and CSS; the pictures are static files.
 */

export function Panel({
  eyebrow,
  aside,
  className = "",
  children,
  label,
}: {
  eyebrow: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <section className={`panel ${className}`} aria-label={label ?? eyebrow}>
      <header className="panel__head">
        <h2>{eyebrow}</h2>
        {aside && <span className="panel__aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * An agent's portrait (its model, photographed in the portrait studio), by name or id; an initial in a ring when the
 * cast doesn't know them or the picture won't load.
 */
export function Avatar({ agent, size = "md", room }: { agent: string; size?: "sm" | "md" | "lg"; room?: DeskRoom }) {
  const src = portrait(agent);
  const [failed, setFailed] = useState<string | null>(null);
  const style = room ? ({ "--tone": DESK_ROOMS[room].accent } as React.CSSProperties) : undefined;
  return (
    <span className={`avatar avatar--${size}`} style={style} title={agent}>
      {src && failed !== src ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} /> : <b aria-hidden="true">{agent.charAt(0)}</b>}
    </span>
  );
}

export type Tone = "ok" | "slow" | "down" | "off";

export function Pill({ tone, children, className = "" }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`pill pill--${tone} ${className}`}>
      <i aria-hidden="true" />
      {children}
    </span>
  );
}
