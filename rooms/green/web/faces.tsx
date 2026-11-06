import { useState } from "react";
import type { GreenPlayer } from "../data/league.ts";

/* ── faces and logos ── */

export const initials = (name: string) =>
  name
    .replace(/[^A-Za-z .'-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export const faceUrl = (id: string) => (/^\d{1,8}$/.test(id) ? `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg` : null);
export const logoUrl = (team: string | null | undefined) => (team && /^[A-Z]{2,3}$/.test(team) ? `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png` : null);

/** A player's face (a defence's logo); initials underneath show when the picture can't load. */
export function Face({ p, size = 34 }: { p: Pick<GreenPlayer, "id" | "name" | "pos" | "team">; size?: number }) {
  const [bad, setBad] = useState(false);
  const def = p.pos === "DEF";
  const src = def ? logoUrl(p.team ?? p.id) : faceUrl(p.id);
  return (
    <span className={`gd-face${def ? " is-def" : ""}`} style={{ "--s": `${size}px` } as React.CSSProperties} aria-hidden="true">
      <i>{def ? (p.team ?? p.id) : initials(p.name)}</i>
      {src && !bad && <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />}
    </span>
  );
}

export function Logo({ team, size = 16 }: { team: string | null | undefined; size?: number }) {
  const [bad, setBad] = useState(false);
  const src = logoUrl(team);
  if (!src || bad) return team ? <span className="gd-tm">{team}</span> : null;
  return (
    <span className="gd-tm">
      <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />
      {team}
    </span>
  );
}

/** A fantasy team's badge: its initials, no picture (managers' avatars are never read). */
export const TeamBadge = ({ name, me = false }: { name: string; me?: boolean }) => (
  <span className={`gd-badge${me ? " is-me" : ""}`} aria-hidden="true">
    {initials(name)}
  </span>
);

