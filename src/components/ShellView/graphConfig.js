/**
 * G6 Graph Configuration Factory
 *
 * Provides a factory function to generate consistent G6 graph configuration
 * objects used throughout ResultGraph.vue. This eliminates ~200 lines of
 * duplication across drawGraph(), redrawGraph(), and initializeEmptyGraph().
 *
 * The configuration includes:
 * - Container and sizing
 * - Multiple layout types (force-directed, circular, radial, dagre, concentric)
 * - Node styles (circle type with icons and labels)
 * - Edge styles (arrows, labels, auto-rotation)
 * - Interactive behaviors (zoom, drag, click-select)
 * - State management (active/inactive states for highlighting)
 */

// Node sizing constants
// The visual node is 75px, but labels add significant height below
// Label: 8px offset + up to 3 lines * 16px line height = ~56px
// Total effective height: 75 + 56 = ~131px
const NODE_SIZE = 75;
const LABEL_HEIGHT = 60; // 8px offset + ~52px for 3 lines of text
const EFFECTIVE_NODE_SIZE = NODE_SIZE + LABEL_HEIGHT; // ~135px total footprint

/**
 * Get D3 force layout configuration (default)
 *
 * @param {Array} edges - Edge data for distance calculation
 * @returns {Object} Force layout configuration
 */
function getD3ForceConfig(edges) {
  // Calculate dynamic node spacing based on edge count
  let nodeSpacing = edges.length * 8;
  nodeSpacing = nodeSpacing < 80 ? 80 : nodeSpacing;
  nodeSpacing = nodeSpacing > 500 ? 500 : nodeSpacing;

  return {
    type: 'd3-force',
    link: {
      // Dynamic distance:
      // Fixed distance for nodes with large number of neighbors will cause mass collision (a large circle)
      // Variable distance with multiple layers of variation will display the nodes in a spaced out manner (multiple circles around node)
      distance: (d) => {
        // Get the source and target node degrees
        const sourceDegree = d.source.data?.degree || 1;
        const targetDegree = d.target.data?.degree || 1;

        // Base distance increased to account for labels below nodes
        const baseDistance = 200;

        // For high-degree nodes (hubs), vary the distance based on connection index
        if (sourceDegree > 5 || targetDegree > 5) {
          // Use a hash of the edge ID to create pseudo-random but consistent distances
          const edgeHash = d.id ? d.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : 0;
          const variation = (edgeHash % 6) * 100 + 100;
          return baseDistance + variation;
        }

        // For regular nodes, use standard distance
        return baseDistance;
      },
      strength: 2,
    },
    collide: {
      // Increase collision radius significantly to account for labels below nodes
      // Node radius + label offset (8px) + label height (~50px for 3 lines) + padding
      radius: (d) => d.size / 2 + 80,
      strength: 1.2, // Stronger collision avoidance
    },
    manyBody: {
      strength: -1800,  // Increased repulsion to spread nodes apart
    },
    radial: {
      radius: 200,
    },
    alpha: 1,
    alphaMin: 0.2,
    alphaDecay: 0.03,
    velocityDecay: 0.45,
  };
}

/**
 * Get circular layout configuration
 *
 * @param {number} nodeCount - Number of nodes in the graph
 * @returns {Object} Circular layout configuration
 */
function getCircularConfig(nodeCount = 10) {
  // Calculate radius to fit all nodes with labels
  // Circumference needs to fit nodeCount * effective node width
  // C = 2 * PI * r, so r = (nodeCount * nodeWidth) / (2 * PI)
  const minRadiusForNodes = (nodeCount * EFFECTIVE_NODE_SIZE) / (2 * Math.PI);
  const radius = Math.max(250, minRadiusForNodes);

  return {
    type: 'circular',
    radius,
    ordering: 'degree',
    clockwise: true,
    startAngle: 0,
    endAngle: 2 * Math.PI,
    divisions: 1,
  };
}

/**
 * Get dagre (hierarchical) layout configuration
 *
 * @param {number} nodeCount - Number of nodes in the graph
 * @returns {Object} Dagre layout configuration
 */
function getDagreConfig(nodeCount = 10) {
  // Use effective node size for spacing - labels need vertical space
  // nodesep: horizontal spacing between nodes in same rank
  // ranksep: vertical spacing between ranks (needs extra for labels)
  const nodesep = Math.max(EFFECTIVE_NODE_SIZE, 150);
  const ranksep = Math.max(EFFECTIVE_NODE_SIZE * 1.2, 180);

  return {
    type: 'dagre',
    rankdir: 'TB',
    nodesep,
    ranksep,
    align: 'UL',
    controlPoints: true,
  };
}

/**
 * Get concentric layout configuration
 *
 * @param {number} nodeCount - Number of nodes in the graph
 * @returns {Object} Concentric layout configuration
 */
function getConcentricConfig(nodeCount = 10) {
  return {
    type: 'concentric',
    sortBy: 'degree',
    preventOverlap: true,
    nodeSize: EFFECTIVE_NODE_SIZE,
    minNodeSpacing: EFFECTIVE_NODE_SIZE,
    equidistant: false,
    startAngle: 0,
    clockwise: true,
  };
}

/**
 * Get layout configuration by type
 *
 * @param {string} layoutType - Layout type key (d3-force, circular, dagre, concentric)
 * @param {Object} options - Layout-specific options
 * @param {Array} options.edges - Edge data (for d3-force)
 * @param {number} options.nodeCount - Number of nodes in the graph
 * @param {boolean} options.isLayoutChange - Whether this is a layout change (vs initial render)
 * @returns {Object} Layout configuration
 */
export function getLayoutConfig(layoutType, options = {}) {
  const nodeCount = options.nodeCount || 10;
  const isLayoutChange = options.isLayoutChange || false;

  switch (layoutType) {
    case 'circular':
      return getCircularConfig(nodeCount);
    case 'dagre':
      return getDagreConfig(nodeCount);
    case 'concentric':
      return getConcentricConfig(nodeCount);
    case 'd3-force':
    default: {
      const config = getD3ForceConfig(options.edges || []);
      // When switching TO force layout, use lower initial energy to prevent nodes shooting away
      if (isLayoutChange) {
        config.alpha = 0.3;
        config.alphaDecay = 0.05;
      }
      return config;
    }
  }
}

/**
 * Create a G6 graph configuration object
 *
 * @param {Object} params - Configuration parameters
 * @param {HTMLElement} params.container - DOM container for the graph
 * @param {number} params.width - Graph width in pixels
 * @param {number} params.height - Graph height in pixels
 * @param {Array} params.edges - Edge data for layout configuration
 * @param {string} params.labelColor - Color for node/edge labels
 * @param {string} params.edgeColor - Color for edges
 * @param {string} params.layoutType - Layout type (d3-force, circular, radial, dagre, concentric)
 * @param {Object} params.layoutOptions - Additional layout-specific options
 * @returns {Object} G6 graph configuration object
 */
export function createGraphConfig({ container, width, height, edges, labelColor, edgeColor, layoutType = 'd3-force', layoutOptions = {} }) {
  const layout = getLayoutConfig(layoutType, { edges, ...layoutOptions });

  return {
    container,
    width,
    height,
    layout,
    node: {
      type: 'circle',
      style: {
        labelFontSize: 13,
        labelFontFamily: "Lexend, Helvetica Neue, Helvetica, Arial, sans-serif",
        labelFontWeight: 400,
        labelFill: labelColor,
        labelPlacement: 'bottom',
        labelOffsetY: 8,
        labelMaxWidth: 200,
        labelWordWrap: true,
        labelWordWrapWidth: 200,
        labelLineHeight: 16,
        labelMaxLines: 3,
        iconFontFamily: "Font Awesome 6 Free",
        iconFontSize: 24,
        iconFontWeight: 900,
        iconFill: "#ffffff",
        zIndex: 10,
      },
      state: {
        active: {
          lineWidth: 10,
          stroke: '#1890FF',
        },
      },
    },
    edge: {
      style: {
        lineWidth: 5,
        stroke: edgeColor,
        endArrow: true,
        labelFontSize: 12,
        labelFontFamily: "Lexend,Helvetica Neue, Helvetica, Arial, sans-serif",
        labelFontWeight: 350,
        labelFill: labelColor,
        labelAutoRotate: true,
        labelTextBaseline: 'bottom',
        labelOffsetY: -8,
        zIndex: 1,
      },
      state: {
        active: {
          lineWidth: 10,
          stroke: '#1890FF',
        },
      },
    },
    behaviors: ['zoom-canvas', 'drag-canvas',
      {
        type: 'optimize-viewport-transform',
        debounce: 300,
      },
      {
        type: 'drag-element-force',
        fixed: true,
      },
      {
        type: 'click-select',
        key: 'click-select-element',
        degree: 0,
        state: 'active',
        enable: true,
      },
      {
        type: 'click-select',
        key: 'click-highlight',
        degree: 1,
        state: 'active',
        unselectedState: 'inactive',
        enable: false,
        neighborState: 'active',
      },
    ],
  };
}
