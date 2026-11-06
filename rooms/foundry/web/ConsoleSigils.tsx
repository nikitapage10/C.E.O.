import { UndoneField } from "@ceo/engine/sigils/UndoneField.tsx";

/**
 * The furnace's look carried under it (#922, Nikita 2026-11-06 01:04Z: what sits under a room's hero must look the
 * part): the gold wire grid and the sigil nanites behind the Foundry's console, from the engine's shared field
 * (@ceo/engine/sigils/UndoneField.tsx, which the Boiler Room's pages share since #936).
 */
export function ConsoleSigils() {
  return <UndoneField className="fo-deck-sig" />;
}
