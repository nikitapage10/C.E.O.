import type { Body as BodyKind } from "@ceo/core";
import { Suspense, type ComponentType } from "react";
import { Duck } from "./Duck.tsx";
import { Envoy } from "./Envoy.tsx";
import { Gestral } from "./Gestral.tsx";
import { Monolith } from "./Monolith.tsx";
import { KayKitBody, RobotBody } from "./Rigged.tsx";
import { Rocky } from "./Rocky.tsx";
import { BODY_HEIGHT, type BodyProps } from "./types.ts";

const BODIES: Record<Exclude<BodyKind, "classic">, ComponentType<BodyProps>> = {
  robot: RobotBody,
  mage: KayKitBody,
  rogue: KayKitBody,
  hooded: KayKitBody,
  knight: KayKitBody,
  barbarian: KayKitBody,
  rocky: Rocky,
  envoy: Envoy,
  gestral: Gestral,
  monolith: Monolith,
  duck: Duck,
};

/** Any body but the classic figure, at the look's size. Models stream in; until then there's nothing to see. */
export function Body(props: BodyProps) {
  const kind = props.look.body as Exclude<BodyKind, "classic">;
  const Component = BODIES[kind];
  return (
    <group scale={props.look.size}>
      <Suspense fallback={null}>
        <Component key={kind} {...props} />
      </Suspense>
    </group>
  );
}

/** Where the top of a look is, for labels. */
export function topOf(look: { body: BodyKind; size: number }, classic: number) {
  return look.body === "classic" ? classic : BODY_HEIGHT[look.body] * look.size;
}
