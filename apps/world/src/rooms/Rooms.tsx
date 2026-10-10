import { ROOM_IDS, roomAngle, roomCenter, type RoomId } from "@ceo/core";
import type { ThreeEvent } from "@react-three/fiber";
import type { ComponentType } from "react";
import { useWorld } from "../store.ts";
import { PALETTE } from "../theme.ts";
import { Archive } from "./Archive.tsx";
import { BreakRoom } from "./BreakRoom.tsx";
import { Exchange } from "./Exchange.tsx";
import { Foundry } from "./Foundry.tsx";
import { Green } from "./Green.tsx";
import { Relay } from "./Relay.tsx";
import { Spire } from "./Spire.tsx";

export const ROOM_ACCENTS: Record<RoomId, string> = {
  foundry: "#ffb067",
  spire: PALETTE.silver,
  exchange: PALETTE.mint,
  green: "#b8f28a",
  relay: "#e8c27a",
  archive: PALETTE.violet,
  breakroom: "#ff8fb1",
};

const CONTENT: Record<RoomId, ComponentType> = {
  foundry: Foundry,
  spire: Spire,
  exchange: Exchange,
  green: Green,
  relay: Relay,
  archive: Archive,
  breakroom: BreakRoom,
};

function Room({ id }: { id: RoomId }) {
  const setFocus = useWorld((s) => s.setFocus);
  const focused = useWorld((s) => s.focus === id);
  const Content = CONTENT[id];
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!focused) setFocus(id);
  };
  return (
    <group position={roomCenter(id)} rotation={[0, roomAngle(id), 0]} name={`room-${id}`}>
      <group onClick={onClick}>
        <Content />
      </group>
    </group>
  );
}

export function Rooms() {
  return (
    <group>
      {ROOM_IDS.map((id) => (
        <Room key={id} id={id} />
      ))}
    </group>
  );
}
