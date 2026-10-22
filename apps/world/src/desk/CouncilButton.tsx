import type { RoomPulse } from "./roomPulse.ts";

/** The compact control: Skippy's can with nine coloured sparks around it. */
export function CouncilButton({ pulses, onOpen }: { pulses: RoomPulse[]; onOpen: () => void }) {
  const hot = pulses.filter((p) => p.state === "busy" || p.state === "down").length;
  return (
    <button type="button" className="council-btn" onClick={onOpen} aria-haspopup="dialog" title="Hear the Council's rundown">
      <span className="council-btn__ring" aria-hidden="true">
        {pulses.map((p, i) => (
          <i key={p.id} style={{ "--c": p.colour, "--a": `${(i / pulses.length) * 360}deg` } as React.CSSProperties} className={p.real ? "real" : ""} />
        ))}
      </span>
      <span className="council-btn__text">
        <b>The Council</b>
        <small>{hot ? `${hot} ${hot === 1 ? "room" : "rooms"} with news` : "Nine rooms, one rundown"}</small>
      </span>
    </button>
  );
}
