import LZString from 'lz-string';

/**
 * Investigation State Management Utility
 *
 * Handles serialization/deserialization of graph investigation state for clipboard sharing.
 * Uses compact array-based format for smaller export codes.
 * Full node/edge properties are refetched from the database on restore.
 *
 * Format:
 * - Nodes as arrays: [label, pk, x, y]
 * - Edges as arrays: [label, pk]
 */

const STATE_VERSION = 1;

/**
 * Parse a stable key back to label and pk.
 * Format: "Label|pk"
 */
export function parseStableKey(key) {
  const separatorIndex = key.indexOf('|');
  if (separatorIndex === -1) {
    return { label: null, pk: null };
  }
  return {
    label: key.slice(0, separatorIndex),
    pk: key.slice(separatorIndex + 1),
  };
}

/**
 * Serialize investigation state to a compressed string.
 */
function serializeState(state) {
  const nodes = state.graphData?.nodes || [];
  const edges = state.graphData?.edges || [];

  // Nodes: [label, pk, x, y]
  const compactNodes = nodes.map(node => [
    node.data?.properties?._label || null,
    node.data?.properties?.id || null,
    Math.round(node.style?.x || 0),
    Math.round(node.style?.y || 0),
  ]);

  // Edges: [label, pk]
  const compactEdges = edges.map(edge => [
    edge.data?.properties?._label || null,
    edge.data?.properties?.id || null,
  ]);

  const stateObj = {
    v: STATE_VERSION,
    q: state.queries?.[0]?.query || '',
    n: compactNodes,
    e: compactEdges,
  };

  return LZString.compressToBase64(JSON.stringify(stateObj));
}

/**
 * Deserialize investigation state from compressed string.
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

    if (!state.v || state.v > STATE_VERSION) {
      console.error('[InvestigationState] Invalid or unsupported state version:', state.v);
      return null;
    }

    // Format: [label, pk, x, y]
    const minimalNodes = (state.n || []).map(([label, pk, x, y]) => ({
      label,
      pk,
      x,
      y,
    }));

    // Format: [label, pk]
    const minimalEdges = (state.e || []).map(([label, pk]) => ({
      label,
      pk,
    }));

    return {
      version: state.v,
      queries: state.q ? [{ query: state.q }] : [],
      minimalNodes,
      minimalEdges,
    };
  } catch (error) {
    console.error('[InvestigationState] Failed to deserialize investigation state:', error);
    return null;
  }
}

/**
 * Generate an export code for clipboard sharing.
 * Format: HKS1:<compressed_data>:Z
 */
export function generateExportCode(state) {
  const compressed = serializeState(state);
  const code = `HKS1:${compressed}:Z`;
  return { code, length: code.length };
}

/**
 * Parse an export code from clipboard back to state.
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

  if (!code.endsWith(':Z')) {
    console.error('[InvestigationState] Invalid export code: missing end marker (code may be truncated)');
    return null;
  }

  const compressed = code.slice(5, -2);
  return deserializeState(compressed);
}

export default {
  generateExportCode,
  parseExportCode,
  parseStableKey,
};
