import { describe, it, expect } from "vitest";
import { getLayoutConfig } from "./graphConfig";

// getLayoutConfig is a pure factory: (layoutType, options) -> G6 layout config.
// These tests lock in the force-layout energy logic that drives the
// "re-selecting Force-Directed re-runs the simulation" behaviour, in particular
// the ordering of the fullEnergy vs isLayoutChange branches — a future refactor
// could silently invert it, changing whether a reshuffle actually reheats.

describe("getLayoutConfig — d3-force energy", () => {
  it("uses the base full energy (alpha 1) for an initial force draw", () => {
    const config = getLayoutConfig("d3-force");
    expect(config.type).toBe("d3-force");
    expect(config.alpha).toBe(1);
    expect(config.alphaDecay).toBe(0.03);
  });

  it("eases in gently (alpha 0.3) when switching in from another layout", () => {
    const config = getLayoutConfig("d3-force", { isLayoutChange: true });
    expect(config.alpha).toBe(0.3);
    expect(config.alphaDecay).toBe(0.05);
  });

  it("reheats at full energy when fullEnergy is set (deliberate reshuffle)", () => {
    const config = getLayoutConfig("d3-force", { fullEnergy: true });
    expect(config.alpha).toBe(1);
    expect(config.alphaDecay).toBe(0.03);
  });

  it("lets fullEnergy win over isLayoutChange when both are set", () => {
    // A force->force re-run passes BOTH flags (it is a layout change AND a
    // reshuffle); fullEnergy must take precedence so it does not ease in gently.
    const config = getLayoutConfig("d3-force", {
      isLayoutChange: true,
      fullEnergy: true,
    });
    expect(config.alpha).toBe(1);
    expect(config.alphaDecay).toBe(0.03);
  });
});

describe("getLayoutConfig — non-force layouts", () => {
  it("ignores the energy flags for deterministic layouts", () => {
    // circular/dagre/concentric compute positions algorithmically and have no
    // alpha; the fullEnergy/isLayoutChange flags must not leak into them.
    for (const type of ["circular", "dagre", "concentric"]) {
      const config = getLayoutConfig(type, {
        isLayoutChange: true,
        fullEnergy: true,
      });
      expect(config.type).toBe(type);
      expect(config.alpha).toBeUndefined();
    }
  });

  it("falls back to the force layout for an unknown type", () => {
    const config = getLayoutConfig("nonexistent-layout");
    expect(config.type).toBe("d3-force");
  });
});
