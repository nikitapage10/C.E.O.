import { BoxGeometry, Mesh, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { DETAIL_LAYER, HIDDEN_LAYER, layerMask, trackable } from "./DetailLevels.tsx";

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
