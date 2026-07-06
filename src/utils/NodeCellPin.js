/**
 * Pin metadata for a NODE-typed result-table cell.
 *
 * The table renders a node cell from its beautified property list (the output
 * of ValueFormatter.filterAndBeautifyProperties), which keeps each property's
 * name/value/isPrimaryKey but replaces the raw `_label` with a display-only
 * "Entity Type" row holding the DISPLAY name, which can diverge from the table
 * name (e.g. VirtualHub → "Possible Matches"). Pins are keyed "Label|pk" from
 * the raw table name to match graph pins, so this helper reads the label from
 * the raw node value and derives pk/name from the beautified list, exactly like
 * EntityPinPanel.
 *
 * Returns null for anything that can't be pinned (missing label or pk), so the
 * table can omit the toggle without special-casing at the call site.
 *
 * @param {Object} rawValue - The raw NODE value (carries `_label`).
 * @param {Array<{name: string, value: *, isPrimaryKey?: boolean}>} properties -
 *   The beautified property list the cell displays.
 * @returns {{label: string, pk: string, name: string}|null}
 */
export function nodeCellPinMeta(rawValue, properties) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }
  const label = rawValue._label;
  if (typeof label !== "string" || !label) {
    return null;
  }
  if (!Array.isArray(properties)) {
    return null;
  }

  // The cluster id is the primary key; fall back to the "id" property. Mirrors
  // EntityPinPanel so a pin made from the table keys identically to a graph pin.
  const pkProp = properties.find((p) => p.isPrimaryKey);
  let pk = pkProp && pkProp.value != null ? String(pkProp.value) : null;
  if (pk == null) {
    const idProp = properties.find((p) => p.name === "id");
    pk = idProp && idProp.value != null ? String(idProp.value) : null;
  }
  if (pk == null || pk === "") {
    return null;
  }

  // Display name for the pin card, preferring name/full, falling back to pk.
  const nameProp =
    properties.find((p) => p.name === "name") ||
    properties.find((p) => p.name === "full");
  const name = nameProp && nameProp.value != null ? String(nameProp.value) : pk;

  return { label, pk, name };
}
