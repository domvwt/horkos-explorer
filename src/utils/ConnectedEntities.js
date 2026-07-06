/**
 * ConnectedEntities - pure helpers for the connected-entities side panel.
 *
 * The panel prioritises the ENTITY, not the edge: a neighbour reachable by
 * several relationships (multiple types, or parallel edges of one type) is one
 * connected entity, shown on a single row, counted once. These helpers do the
 * per-edge row shaping, the entity-first collapsing, and the bounded
 * "expand all" selection without any DB or DOM access, so they are
 * unit-testable in isolation.
 */

import {
  relationshipRoleLabel,
  extractOwnershipShare,
} from "./DisplayPolicy";

/**
 * Shape raw neighbour-fetch rows ({ r, dst }) into per-relationship records.
 *
 * Emits one record per (neighbour, relationship type, DIRECTION). Parallel
 * edges of the same type in the same direction collapse silently, but a
 * mutual relationship of one type — A owns B AND B owns A over the same rel
 * table — keeps both records, so the direction-asymmetric labels ("Owner"
 * and "Owned by") both survive to the collapsed entity row. Circular
 * ownership is a red flag in this domain and must stay visible.
 *
 * Display-environment concerns are injected so the function stays pure:
 * `getDisplayName(node)` resolves a neighbour's display name and
 * `isInGraph(nodeId)` reports canvas membership.
 *
 * @param {Array<Object>} rows - Raw fetch rows shaped { r, dst }.
 * @param {Object} helpers
 * @param {function(Object): string} helpers.getDisplayName
 * @param {function(string): boolean} helpers.isInGraph
 * @returns {Array<Object>} Per-edge records for collapseByEntity.
 */
export function buildEdgeRows(rows, { getDisplayName, isInGraph }) {
  const edgeRows = [];
  const seenKeys = new Set();
  if (!Array.isArray(rows)) {
    return edgeRows;
  }

  rows.forEach((row) => {
    const rel = row && row.r;
    const node = row && row.dst;
    if (!rel || !node || !node._id) {
      return;
    }

    const nodeId = `${node._id.table}_${node._id.offset}`;
    const edgeLabel = rel._label || "Connected";

    // Direction: _src holds the numeric {table, offset} internal id, so if
    // the neighbour is the edge source, the clicked node is the target
    // (reverse). Computed before deduping because direction is part of the
    // row's identity.
    const neighborIsSource = Boolean(rel._src)
      && rel._src.table === node._id.table
      && rel._src.offset === node._id.offset;

    const seenKey = `${nodeId}::${edgeLabel}::${neighborIsSource ? "in" : "out"}`;
    if (seenKeys.has(seenKey)) {
      return;
    }
    seenKeys.add(seenKey);

    edgeRows.push({
      id: nodeId,
      edgeLabel,
      displayName: getDisplayName(node),
      label: node._label || "Unknown",
      relationshipLabel: relationshipRoleLabel(edgeLabel, { reverse: neighborIsSource }),
      ownershipShare: extractOwnershipShare(rel),
      inGraph: isInGraph(nodeId),
      // Raw data retained for adding the entity to the graph.
      rawNode: node,
      rawRel: rel,
    });
  });

  return edgeRows;
}

/**
 * Collapse a per-edge entity list into one row per DISTINCT connected entity.
 *
 * Input rows are the per-(neighbour, relationship) records produced by
 * buildEdgeRows, each carrying `id` (the neighbour's g6 id),
 * `relationshipLabel`, and edge-specific detail. Rows sharing an `id` are the
 * SAME connected entity reached by different relationships; they collapse to a
 * single row that surfaces every distinct relationship label. Parallel edges
 * of the same type (identical label) collapse silently. Ownership shares are
 * gathered across the entity's edges and de-duplicated.
 *
 * The first row seen for an entity supplies its identity fields (displayName,
 * label, inGraph, rawNode) and its first raw relationship (`rawRel`, which the
 * add-to-graph path requires).
 *
 * @param {Array<Object>} edgeRows - Per-edge entity records.
 * @returns {Array<Object>} One record per distinct entity, input order
 *   preserved by first appearance.
 */
export function collapseByEntity(edgeRows) {
  if (!Array.isArray(edgeRows)) {
    return [];
  }
  const byId = new Map();

  edgeRows.forEach((row) => {
    if (!row || row.id === undefined || row.id === null) {
      return;
    }
    let entity = byId.get(row.id);
    if (!entity) {
      entity = {
        id: row.id,
        displayName: row.displayName,
        label: row.label,
        inGraph: row.inGraph,
        rawNode: row.rawNode,
        rawRel: row.rawRel,
        relationshipLabels: [],
        ownershipShares: [],
      };
      byId.set(row.id, entity);
    }

    // Collect distinct relationship labels in first-seen order; parallel
    // edges of the same type share a label, so they collapse to one entry.
    if (row.relationshipLabel && !entity.relationshipLabels.includes(row.relationshipLabel)) {
      entity.relationshipLabels.push(row.relationshipLabel);
    }
    // Ownership shares can differ per edge; keep the distinct set.
    if (row.ownershipShare && !entity.ownershipShares.includes(row.ownershipShare)) {
      entity.ownershipShares.push(row.ownershipShare);
    }
  });

  return Array.from(byId.values());
}

/**
 * Select the distinct connected entities to add when "expand all" is invoked,
 * bounded by the shared neighbour-fetch cap.
 *
 * Only entities not already on the canvas are candidates. They are ordered
 * exactly as the visible list shows them top-to-bottom: groups sorted by raw
 * entity label, then case-insensitive locale-aware display name within the
 * group, then id as a deterministic tie-break — the panel's grouped display
 * uses this same (label, name, id) comparator, so a capped expansion takes
 * the first N entities the user actually sees. When the candidate count
 * exceeds `cap`, the first `cap` are returned and `truncated` is set so the
 * caller can show a non-blocking notice.
 *
 * @param {Array<Object>} entities - Collapsed distinct entities (from
 *   collapseByEntity). Each needs `id`, `displayName`, `label`, and `inGraph`.
 * @param {number} cap - The maximum number to expand in one action (the
 *   existing neighbour-fetch bound). Fractional values are floored;
 *   invalid or non-positive values select nothing.
 * @returns {{ toAdd: Array<Object>, totalCandidates: number, truncated: boolean }}
 */
export function selectEntitiesToExpand(entities, cap) {
  const empty = { toAdd: [], totalCandidates: 0, truncated: false };
  if (!Array.isArray(entities)) {
    return empty;
  }
  const bound = Math.floor(Number(cap));
  if (!Number.isFinite(bound) || bound <= 0) {
    return empty;
  }

  const candidates = entities.filter((e) => e && !e.inGraph);
  const sorted = candidates.slice().sort((a, b) => {
    const byLabel = String(a.label || "").localeCompare(String(b.label || ""));
    if (byLabel !== 0) {
      return byLabel;
    }
    const nameA = (a.displayName || "").toLowerCase();
    const nameB = (b.displayName || "").toLowerCase();
    const byName = nameA.localeCompare(nameB);
    if (byName !== 0) {
      return byName;
    }
    return String(a.id).localeCompare(String(b.id));
  });

  return {
    toAdd: sorted.slice(0, bound),
    totalCandidates: candidates.length,
    truncated: candidates.length > bound,
  };
}
