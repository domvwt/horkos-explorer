import LZString from 'lz-string';

/**
 * Investigation State Management Utility
 *
 * Handles serialization/deserialization of graph investigation state for URL sharing.
 * State includes queries executed, node expansions, hidden elements, and viewport settings.
 */

const STATE_VERSION = 1;
const MAX_URL_LENGTH = 65000; // Modern browsers support ~64KB-2MB URLs, being conservative at 65KB

/**
 * Serialize investigation state to URL-safe compressed string
 *
 * @param {Object} state - Investigation state object
 * @param {Array} state.queries - Array of executed queries [{query, params, timestamp}]
 * @param {Object} state.graphData - Full graph data {nodes: [], edges: []} - all visible nodes and edges
 * @param {Object} state.hiddenElements - Object with {nodes: {}, edges: {}}
 * @param {Object} state.viewport - Optional viewport state {zoom, x, y}
 * @returns {string} Compressed, URL-safe string
 */
export function serializeState(state) {
  const stateObj = {
    v: STATE_VERSION,
    q: state.queries || [],
    g: state.graphData || { nodes: [], edges: [] }, // 'g' for graphData
    h: state.hiddenElements || { nodes: {}, edges: {} },
  };

  // Include viewport only if provided (optional, saves space)
  if (state.viewport) {
    stateObj.vp = state.viewport;
  }

  const json = JSON.stringify(stateObj);
  const compressed = LZString.compressToEncodedURIComponent(json);

  return compressed;
}

/**
 * Deserialize investigation state from URL parameter
 *
 * @param {string} compressed - Compressed state string from URL
 * @returns {Object|null} Deserialized state object or null if invalid
 */
export function deserializeState(compressed) {
  if (!compressed) {
    return null;
  }

  try {
    const json = LZString.decompressFromEncodedURIComponent(compressed);
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

    const deserializedState = {
      version: state.v,
      queries: state.q,
      graphData: state.g || { nodes: [], edges: [] }, // New: full graph data
      hiddenElements: state.h || { nodes: {}, edges: {} },
      viewport: state.vp || null,
    };

    return deserializedState;
  } catch (error) {
    console.error('[InvestigationState] Failed to deserialize investigation state:', error);
    return null;
  }
}

/**
 * Generate shareable URL with investigation state
 *
 * @param {Object} state - Investigation state object
 * @param {string} baseUrl - Base URL (default: current location)
 * @returns {Object} Object with {url, isOversized, estimatedLength}
 */
export function generateShareableUrl(state, baseUrl = null) {
  const compressed = serializeState(state);
  const base = baseUrl || window.location.origin + window.location.pathname;

  // Preserve existing hash (e.g., #shell)
  const hash = window.location.hash || '#shell';

  // Build URL with investigation parameter
  const url = `${base}?investigation=${compressed}${hash}`;

  const estimatedLength = url.length;
  const isOversized = estimatedLength > MAX_URL_LENGTH;

  return {
    url,
    isOversized,
    estimatedLength,
    compressed,
  };
}

/**
 * Extract investigation state from current URL
 *
 * @returns {Object|null} Deserialized state or null if not present/invalid
 */
export function getStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const compressed = params.get('investigation');

  if (!compressed) {
    return null;
  }

  const state = deserializeState(compressed);
  return state;
}

/**
 * Update current URL with investigation state (without page reload)
 *
 * @param {Object} state - Investigation state object
 * @param {boolean} replace - Use replaceState instead of pushState (default: true)
 */
export function updateUrlWithState(state, replace = true) {
  const result = generateShareableUrl(state);

  if (result.isOversized) {
    console.warn(`Investigation state is too large for URL (${result.estimatedLength} chars). Consider excluding viewport data.`);
    return false;
  }

  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', result.url);

  return true;
}

/**
 * Estimate size of state in URL
 *
 * @param {Object} state - Investigation state object
 * @returns {Object} Size information {bytes, kb, canFitInUrl}
 */
export function estimateStateSize(state) {
  const result = generateShareableUrl(state);
  const bytes = result.estimatedLength;
  const kb = (bytes / 1024).toFixed(2);
  const canFitInUrl = !result.isOversized;

  return {
    bytes,
    kb,
    canFitInUrl,
    maxBytes: MAX_URL_LENGTH,
  };
}

/**
 * Create minimal state by excluding optional fields
 * Useful when state is too large for URL
 *
 * @param {Object} state - Full investigation state
 * @returns {Object} Minimal state without viewport
 */
export function createMinimalState(state) {
  return {
    queries: state.queries,
    graphData: state.graphData,
    hiddenElements: state.hiddenElements,
    // Exclude viewport to save space
  };
}

/**
 * Validate state structure
 *
 * @param {Object} state - State object to validate
 * @returns {Object} {valid: boolean, errors: string[]}
 */
export function validateState(state) {
  const errors = [];

  if (!state) {
    errors.push('State is null or undefined');
    return { valid: false, errors };
  }

  if (!Array.isArray(state.queries)) {
    errors.push('queries must be an array');
  } else {
    // Validate each query
    state.queries.forEach((q, i) => {
      if (!q.query || typeof q.query !== 'string') {
        errors.push(`Query ${i} missing or invalid query string`);
      }
    });
  }

  if (state.graphData) {
    if (typeof state.graphData !== 'object') {
      errors.push('graphData must be an object');
    } else {
      if (!Array.isArray(state.graphData.nodes)) {
        errors.push('graphData.nodes must be an array');
      }
      if (!Array.isArray(state.graphData.edges)) {
        errors.push('graphData.edges must be an array');
      }
    }
  }

  if (state.hiddenElements) {
    if (typeof state.hiddenElements !== 'object') {
      errors.push('hiddenElements must be an object');
    } else {
      if (!state.hiddenElements.nodes || typeof state.hiddenElements.nodes !== 'object') {
        errors.push('hiddenElements.nodes must be an object');
      }
      if (!state.hiddenElements.edges && state.hiddenElements.edges !== undefined) {
        errors.push('hiddenElements.edges must be an object if provided');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default {
  serializeState,
  deserializeState,
  generateShareableUrl,
  getStateFromUrl,
  updateUrlWithState,
  estimateStateSize,
  createMinimalState,
  validateState,
};
