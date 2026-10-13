import { roomCenter } from "@ceo/core";
import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { DETAIL_LAYER, HIDDEN_LAYER, hideCutoff, layerMask, trackable } from "./DetailLevels.tsx";

const mesh = () => new Mesh(new BoxGeometry(), new MeshBasicMaterial());

describe("level of detail", () => {
  it("matches three.js's own masks, the hidden layer's included", () => {
    const m = mesh();
    for (const layer of [0, DETAIL_LAYER, HIDDEN_LAYER]) {
      m.layers.set(layer);
      expect(m.layers.mask).toBe(layerMask(layer));
    }
  });

  it("keeps tracking a mesh after hiding it, so it can come back (#111)", () => {
    const m = mesh();
    expect(trackable(m)).toBe(true);
    m.layers.set(DETAIL_LAYER);
    expect(trackable(m)).toBe(true);
    m.layers.set(HIDDEN_LAYER);
    expect(trackable(m)).toBe(true);
  });

  it("leaves meshes put on other layers on purpose, and opted-out ones, alone", () => {
    const m = mesh();
    m.layers.set(5);
    expect(trackable(m)).toBe(false);
    const both = mesh();
    both.layers.enable(DETAIL_LAYER);
    expect(trackable(both)).toBe(false);
    const out = mesh();
    out.userData.lod = false;
    expect(trackable(out)).toBe(false);
  });
});

describe("far rooms while inside a room (#115)", () => {
  const room = roomCenter("foundry");
  it("keeps the normal cut-off on the overview and inside the viewed room", () => {
    expect(hideCutoff("high", null, 0, 0, 120)).toBe(1.5);
    // The viewed room's back corner, further than 40 units from the camera: still the normal cut-off.
    expect(hideCutoff("high", room, room[0] + 8, room[2] + 6.5, 45)).toBe(1.5);
  });

  it("drops small props sooner in rooms beyond 40 units", () => {
    const [x, , z] = roomCenter("workshop");
    expect(hideCutoff("high", room, x, z, 60)).toBeGreaterThan(1.5);
    expect(hideCutoff("low", room, x, z, 60)).toBeGreaterThan(2.5);
    // ...but not when they're close to the camera.
    expect(hideCutoff("high", room, x, z, 30)).toBe(1.5);
  });
});
