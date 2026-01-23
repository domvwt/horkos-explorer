import LZString from 'lz-string';

/**
 * Investigation State Management Utility
 *
 * Handles serialization/deserialization of graph investigation state for clipboard sharing.
 * Uses compact array-based format for smaller export codes.
 * Full node/edge properties are refetched from the database on restore.
 *
 * Format:
 * - Nodes as arrays: [id, x, y, pk, label]
 * - Edges as arrays: [src, tgt]
 * - Query as string only (first query)
 */

const STATE_VERSION = 1;

/**
 * Serialize investigation state to a compressed string.
 *
 * @param {Object} state - Investigation state object
 * @param {Array} state.queries - Array of executed queries [{query, params, timestamp}]
 * @param {Object} state.graphData - Full graph data {nodes: [], edges: []}
 * @param {Object} state.hiddenElements - Object with {nodes: {}, edges: {}}
 * @returns {string} Compressed string
 */
function serializeState(state) {
  const nodes = state.graphData?.nodes || [];
  const edges = state.graphData?.edges || [];

  // Nodes as arrays: [id, x, y, pk, label]
  const compactNodes = nodes.map(node => [
    node.id,
    Math.round(node.style?.x || 0),
    Math.round(node.style?.y || 0),
    node.data?.properties?.id || null,
    node.data?.properties?._label || null,
  ]);

  // Edges as arrays: [src, tgt]
  const compactEdges = edges.map(edge => [edge.source, edge.target]);

  const stateObj = {
    v: STATE_VERSION,
    q: state.queries?.[0]?.query || '',
    n: compactNodes,
    e: compactEdges,
    h: state.hiddenElements || { nodes: {}, edges: {} },
  };

  const json = JSON.stringify(stateObj);
  return LZString.compressToBase64(json);
}

/**
 * Deserialize investigation state from compressed string.
 *
 * Returns minimal node/edge data that must be refetched from the database
 * to restore full properties.
 *
 * @param {string} compressed - Compressed state string
 * @returns {Object|null} Deserialized state object or null if invalid
 */
function deserializeState(compressed) {
  if (!compressed) {
    return null;
  }

  try {
    const json = LZString.decompressFromBase64(compressed);
    if (!json) {
      console.error('[InvestigationState] Failed to decompress investigation state');
      return null;
    }

    const state = JSON.parse(json);

    // Validate version
    if (!state.v || state.v > STATE_VERSION) {
      console.error('[InvestigationState] Invalid or unsupported state version:', state.v);
      return null;
    }

    // Convert compact arrays back to objects
    const minimalNodes = (state.n || []).map(([id, x, y, pk, label]) => ({
      id,
      x,
      y,
      pk,
      label,
    }));

    const minimalEdges = (state.e || []).map(([src, tgt], i) => ({
      id: `e_${i}`,
      src,
      tgt,
    }));

    // Check if nodes have labels
    const nodesWithoutLabels = minimalNodes.filter(n => !n.label);

    return {
      version: state.v,
      queries: state.q ? [{ query: state.q }] : [],
      minimalNodes,
      minimalEdges,
      hiddenElements: state.h || { nodes: {}, edges: {} },
      viewport: null,
      hasLegacyNodes: nodesWithoutLabels.length > 0,
      legacyNodeCount: nodesWithoutLabels.length,
    };
  } catch (error) {
    console.error('[InvestigationState] Failed to deserialize investigation state:', error);
    return null;
  }
}

/**
 * Generate an export code for clipboard sharing.
 *
 * @param {Object} state - Investigation state object
 * @returns {Object} {code, length}
 */
export function generateExportCode(state) {
  const compressed = serializeState(state);
  const code = `HKS1:${compressed}`;

  return {
    code,
    length: code.length,
  };
}

/**
 * Parse an export code from clipboard back to state.
 *
 * @param {string} code - Export code from generateExportCode
 * @returns {Object|null} Deserialized state or null if invalid
 */
export function parseExportCode(code) {
  if (!code || typeof code !== 'string') {
    return null;
  }

  code = code.trim();

  if (!code.startsWith('HKS1:')) {
    console.error('[InvestigationState] Invalid export code: missing prefix');
    return null;
  }

  const compressed = code.slice(5);
  return deserializeState(compressed);
}

export default {
  generateExportCode,
  parseExportCode,
};
