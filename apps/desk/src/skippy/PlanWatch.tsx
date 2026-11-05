import { useEffect } from "react";
import { planWarnings, useTalk } from "./talk.ts";

/**
 * A plain line or two about Skippy's ElevenLabs voice plan (#550), only while there is something to say: it is ending,
 * overdue, used up, or will run dry before it resets. Read from the credits Talk already fetches (kept five minutes
 * server-side, signed-in only), so signed out it shows nothing.
 */
export function PlanWatch({ className = "" }: { className?: string }) {
  const credits = useTalk((s) => s.credits);
  const asked = useTalk((s) => s.ready !== null);
  useEffect(() => {
    if (!asked) void useTalk.getState().refresh();
  }, [asked]);
  const lines = planWarnings(credits, Date.now());
  if (!lines.length) return null;
  return (
    <div className={`plan-watch ${className}`.trim()} role="status">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}
