import LZString from 'lz-string';

/**
 * Investigation State Management Utility
 *
 * Handles serialization/deserialization of graph investigation state for clipboard sharing.
 * Uses minimal state format: stores only node IDs, positions, and primary keys.
 * Full node/edge properties are refetched from the database on restore.
 */

const STATE_VERSION = 1;

/**
 * Serialize investigation state to a compressed string.
 *
 * Minimal format stores only:
 * - Node: {id, x, y, pk} - G6 ID, position, primary key value
 * - Edge: {id, src, tgt} - G6 ID, source/target node IDs
 *
 * Full properties are refetched from the database on restore.
 *
 * @param {Object} state - Investigation state object
 * @param {Array} state.queries - Array of executed queries [{query, params, timestamp}]
 * @param {Object} state.graphData - Full graph data {nodes: [], edges: []}
 * @param {Object} state.hiddenElements - Object with {nodes: {}, edges: {}}
 * @param {Object} state.viewport - Optional viewport state {zoom}
 * @returns {string} Compressed string
 */
function serializeState(state) {
  // Convert full graph data to minimal format
  const minimalNodes = (state.graphData?.nodes || []).map(node => ({
    id: node.id,                                    // G6 node ID like "1_65"
    x: Math.round(node.style?.x || 0),              // Position (rounded to save space)
    y: Math.round(node.style?.y || 0),
    pk: node.data?.properties?.id || null,          // Primary key value (cluster hash)
    label: node.data?.properties?._label || null,   // Node label (e.g., "Company", "Person")
  }));

  const minimalEdges = (state.graphData?.edges || []).map(edge => ({
    id: edge.id,                                    // G6 edge ID
    src: edge.source,                               // Source node ID
    tgt: edge.target,                               // Target node ID
  }));

  const stateObj = {
    v: STATE_VERSION,
    q: state.queries || [],
    n: minimalNodes,
    e: minimalEdges,
    h: state.hiddenElements || { nodes: {}, edges: {} },
  };

  // Include viewport only if provided (optional, saves space)
  if (state.viewport) {
    stateObj.vp = state.viewport;
  }

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

    // Validate required fields
    if (!Array.isArray(state.q)) {
      console.error('[InvestigationState] Invalid state: queries must be an array');
      return null;
    }

    const minimalNodes = state.n || [];

    // Check if nodes have the label field (added in later versions)
    // Nodes without labels cannot be refetched from the database
    const nodesWithoutLabels = minimalNodes.filter(n => !n.label);
    const hasLegacyNodes = nodesWithoutLabels.length > 0;

    return {
      version: state.v,
      queries: state.q,
      minimalNodes,
      minimalEdges: state.e || [],
      hiddenElements: state.h || { nodes: {}, edges: {} },
      viewport: state.vp || null,
      hasLegacyNodes,
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
