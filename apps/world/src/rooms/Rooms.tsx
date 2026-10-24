import { ROOM_IDS, roomAngle, roomCenter, type RoomId } from "@ceo/core";
import type { ThreeEvent } from "@react-three/fiber";
import type { ComponentType } from "react";
import { RoomScope, useStreaming } from "../scene/roomScope.ts";
import { useWorld } from "../store.ts";
import { ROOM_ACCENTS } from "../theme.ts";
import { Archive } from "./Archive.tsx";
import { BoilerRoom } from "./BoilerRoom.tsx";
import { BreakRoom } from "./BreakRoom.tsx";
import { Exchange } from "./Exchange.tsx";
import { EASTER_EGGS } from "./EasterEggs.tsx";
import { Foundry } from "./Foundry.tsx";
import { Green } from "./Green.tsx";
import { HoverGlow } from "./HoverGlow.tsx";
import { Podium } from "./Podium.tsx";
import { Relay } from "./Relay.tsx";
import { Spire } from "./Spire.tsx";
import { Studio } from "./Studio.tsx";
import { Workshop } from "./Workshop.tsx";

/** Each room's accent (its plinth's glow); kept in theme.ts so the portrait studio can use it without the rooms. */
export { ROOM_ACCENTS };

const CONTENT: Record<RoomId, ComponentType> = {
  foundry: Foundry,
  spire: Spire,
  exchange: Exchange,
  green: Green,
  relay: Relay,
  archive: Archive,
  breakroom: BreakRoom,
  boiler: BoilerRoom,
  workshop: Workshop,
  studio: Studio,
};

function Room({ id }: { id: RoomId }) {
  const setFocus = useWorld((s) => s.setFocus);
  const focused = useWorld((s) => s.focus === id);
  const Content = CONTENT[id];
  const Eggs = EASTER_EGGS[id];
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!focused) setFocus(id);
  };
  // The scope lets the room's library models wait while another room loads first (scene/streaming.ts); everything
  // built in code (walls, floor, furniture, lights) is always there. The clickable group is where the room's still
  // furniture is merged (scene/StillFurniture.tsx), so a click on a merged wall still focuses the room.
  return (
    <RoomScope.Provider value={id}>
      <group position={roomCenter(id)} rotation={[0, roomAngle(id), 0]} name={`room-${id}`}>
        <group onClick={onClick} userData={{ stillRoot: id }}>
          <Content />
          <Podium room={id} />
          <HoverGlow room={id} />
          <Eggs />
        </group>
      </group>
    </RoomScope.Provider>
  );
}

export function Rooms() {
  // One room on its own (#332): only it is built.
  const solo = useStreaming((s) => s.solo);
  return (
    <group>
      {(solo ? [solo] : ROOM_IDS).map((id) => (
        <Room key={id} id={id} />
      ))}
    </group>
  );
}
