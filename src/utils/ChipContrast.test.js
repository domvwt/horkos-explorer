import { describe, it, expect } from "vitest";
import { inkForBackground, chipStyle, DARK_INK, LIGHT_INK } from "./ChipContrast";

describe("inkForBackground", () => {
  it("uses dark ink on light chips (default Person teal)", () => {
    expect(inkForBackground("#76B7B2")).toBe(DARK_INK);
  });

  it("uses white ink on dark chips (mid blue)", () => {
    expect(inkForBackground("#4E79A7")).toBe(LIGHT_INK);
  });

  it("handles the extremes", () => {
    expect(inkForBackground("#ffffff")).toBe(DARK_INK);
    expect(inkForBackground("#000000")).toBe(LIGHT_INK);
  });

  it("supports 3-digit hex", () => {
    expect(inkForBackground("#fff")).toBe(DARK_INK);
    expect(inkForBackground("#000")).toBe(LIGHT_INK);
  });

  it("pins the YIQ boundary (>= 128 is light)", () => {
    // #808080 has YIQ exactly 128, #7f7f7f is 127: a `>` vs `>=` slip on the
    // threshold would flip one of these, so assert both sides of the edge.
    expect(inkForBackground("#808080")).toBe(DARK_INK);
    expect(inkForBackground("#7f7f7f")).toBe(LIGHT_INK);
  });

  it("falls back to white ink for unparseable values", () => {
    expect(inkForBackground(undefined)).toBe(LIGHT_INK);
    expect(inkForBackground("")).toBe(LIGHT_INK);
    expect(inkForBackground("rebeccapurple")).toBe(LIGHT_INK);
    expect(inkForBackground("rgb(240, 240, 240)")).toBe(LIGHT_INK);
  });
});

describe("chipStyle", () => {
  it("washes the colour over theme tokens for background, ink and border", () => {
    const style = chipStyle("#76B7B2");
    expect(style.backgroundColor).toBe(
      "color-mix(in srgb, #76B7B2 25%, var(--bs-body-bg))"
    );
    expect(style.color).toBe(
      "color-mix(in srgb, var(--bs-body-text) 75%, #76B7B2)"
    );
    expect(style.border).toContain("#76B7B2 55%");
  });

  it("returns no styles for a missing colour (badge defaults apply)", () => {
    expect(chipStyle(undefined)).toEqual({});
    expect(chipStyle("  ")).toEqual({});
  });

  it("passes non-hex colours straight into color-mix (named/rgb degrade gracefully)", () => {
    // Unlike inkForBackground, chipStyle doesn't validate hex — color-mix
    // accepts named and rgb() colours, so the raw value is interpolated as-is.
    const named = chipStyle("rebeccapurple");
    expect(named.backgroundColor).toBe(
      "color-mix(in srgb, rebeccapurple 25%, var(--bs-body-bg))"
    );
    const rgb = chipStyle("rgb(240, 240, 240)");
    expect(rgb.color).toBe(
      "color-mix(in srgb, var(--bs-body-text) 75%, rgb(240, 240, 240))"
    );
  });

  it("trims surrounding whitespace before building the mix", () => {
    expect(chipStyle("  #76B7B2  ").backgroundColor).toBe(
      "color-mix(in srgb, #76B7B2 25%, var(--bs-body-bg))"
    );
  });
});
