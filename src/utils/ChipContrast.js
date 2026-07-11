/**
 * Ink colour for text sitting on a coloured chip/badge.
 *
 * Entity-type colours are user-configurable (SettingsStore), so a fixed ink
 * can't work: dark ink is illegible on the darker palette entries and white
 * ink is illegible on the lighter ones. Historically the UI papered over this
 * with a four-way black text-shadow outline around white text, which reads as
 * rough at badge sizes. Instead, pick the ink per background using YIQ
 * perceived brightness (the standard 299/587/114 weighting): dark ink on
 * light chips, white ink on dark chips — no outline needed.
 */

/** Perceived-brightness threshold (0-255) above which a colour counts as light. */
const LIGHT_THRESHOLD = 128;

/** Ink used on light fills. Near-black: mid-tone palette entries (teal,
 * orange…) count as "light" here, and the body-text grey doesn't pull enough
 * contrast against them. */
export const DARK_INK = "#1c1c1e";

/** Ink used on dark chips. */
export const LIGHT_INK = "#ffffff";

/**
 * Parse a CSS hex colour ("#rgb" or "#rrggbb") to [r, g, b], or null when the
 * value isn't a hex colour (named colours, rgb(), undefined…).
 */
function parseHex(color) {
  if (typeof color !== "string") return null;
  const hex = color.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return null;
}

/**
 * The ink colour (dark grey or white) that stays legible on the given chip
 * background. Non-hex/unparseable backgrounds fall back to white ink, which
 * matches the old behaviour for the mid-tone default palette.
 */
export function inkForBackground(color) {
  const rgb = parseHex(color);
  if (!rgb) return LIGHT_INK;
  const [r, g, b] = rgb;
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= LIGHT_THRESHOLD ? DARK_INK : LIGHT_INK;
}

/**
 * Convenience for Vue `:style` bindings: the full style object for an
 * entity/source chip seeded with the given colour.
 *
 * Rather than painting the raw colour behind text (mid-tone palette entries
 * leave neither white nor dark ink comfortably readable), the chip is a light
 * wash of the colour over the page background with ink that is mostly body
 * text and a whisper of the hue. Both mixes lean on theme tokens, so the same
 * chip adapts to light and dark themes with no extra rules. A faint border of
 * the colour keeps the chip defined on same-coloured table rows.
 */
export function chipStyle(color) {
  if (typeof color !== "string" || !color.trim()) {
    return {};
  }
  const c = color.trim();
  return {
    backgroundColor: `color-mix(in srgb, ${c} 25%, var(--bs-body-bg))`,
    color: `color-mix(in srgb, var(--bs-body-text) 75%, ${c})`,
    border: `1px solid color-mix(in srgb, ${c} 55%, var(--bs-body-bg))`,
  };
}
