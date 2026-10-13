import { useState } from "react";
import { DESK_ROOMS, portrait, roomImage, type DeskRoom } from "./deskData.ts";

/**
 * The Desk's shared pieces: a page head that can carry a still from the Lattice, a titled section, an agent's
 * portrait, and a small state pill. All plain HTML and CSS; the pictures are static files.
 */

/** A page's head: the eyebrow, the title and the lead, over a still of the room it belongs to when it has one. */
export function PageHead({
  eyebrow,
  title,
  lead,
  aside,
  room,
  image,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: React.ReactNode;
  aside?: React.ReactNode;
  /** The room the page belongs to: its still and its colour. */
  room?: DeskRoom;
  /** A still to use instead of the room's. */
  image?: string;
  children?: React.ReactNode;
}) {
  const src = image ?? (room ? roomImage(room) : undefined);
  return (
    <header className={`page-head ${src ? "page-head--pic" : ""}`} style={room ? ({ "--tone": DESK_ROOMS[room].accent } as React.CSSProperties) : undefined}>
      {src && <img className="page-head__pic" src={src} alt="" decoding="async" />}
      <div className="page-head__text">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="desk__title">{title}</h1>
        {lead && <p className="page-head__lead">{lead}</p>}
        {children}
      </div>
      {aside && <div className="page-head__aside">{aside}</div>}
    </header>
  );
}

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
