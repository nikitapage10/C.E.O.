import { ROOMS, ROOM_IDS, roomToWorld, type RoomId } from "@ceo/core";
import { Html } from "@react-three/drei";
import { useMemo } from "react";
import { roomStats } from "../hud/Hud.tsx";
import { useWorld } from "../store.ts";
import { Decode } from "../tide/Decode.tsx";

/**
 * The Tide's universal annotation, placed in the Lattice: a ringed point, a hairline leader and a decoding
 * label with readouts (like "TETHRA · R 108,420 km" on the Tide's home). Leaders are drawn by canon status,
 * as in the Tide: every agent here is still simulated, so the leaders are dotted ("unverified").
 */
function Callout({
  position,
  title,
  reads,
  onClick,
  canon = "unverified",
}: {
  position: [number, number, number];
  title: string;
  reads: React.ReactNode[];
  onClick?: () => void;
  canon?: "confirmed" | "unverified";
}) {
  return (
    <Html position={position} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
      <div className="callout" data-canon={canon} onClick={onClick} role={onClick ? "button" : undefined} style={{ pointerEvents: onClick ? "auto" : "none" }}>
        <span className="callout__ping" />
        <span className="callout__line" />
        <span className="callout__label">
          <span className="callout__title">
            <Decode text={title} tick={34} />
          </span>
          {reads.map((r, i) => (
            <span key={i} className="callout__read">
              {r}
            </span>
          ))}
        </span>
      </div>
    </Html>
  );
}

function RoomCallout({ id }: { id: RoomId }) {
  const lattice = useWorld((s) => s.lattice);
  const setFocus = useWorld((s) => s.setFocus);
  const st = useMemo(() => roomStats(lattice, id), [lattice, id]);
  return (
    <Callout
      position={roomToWorld(id, -3.2, 6.2, -4) as [number, number, number]}
      title={ROOMS[id].name}
      onClick={() => setFocus(id)}
      reads={[
        `A ${st.agents} · Σ ${st.shipped} · Δ ${st.running}`,
        st.waiting ? (
          <b key="w">◦ {st.waiting} awaiting the C.E.O.</b>
        ) : (
          ROOMS[id].theme
        ),
      ]}
    />
  );
}

export function Callouts() {
  const focus = useWorld((s) => s.focus);
  if (focus) return null;
  return (
    <group>
      {ROOM_IDS.map((id) => (
        <RoomCallout key={id} id={id} />
      ))}
      <Callout position={[1.8, 14, 0]} title="The Kernel" canon="confirmed" reads={["Syntherion · unfinished", "Glass 0.78 · still being written"]} />
    </group>
  );
}
