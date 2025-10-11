/**
 * G6 Graph Configuration Factory
 *
 * Provides a factory function to generate consistent G6 graph configuration
 * objects used throughout ResultGraph.vue. This eliminates ~200 lines of
 * duplication across drawGraph(), redrawGraph(), and initializeEmptyGraph().
 *
 * The configuration includes:
 * - Container and sizing
 * - Force-directed layout with dynamic edge distances
 * - Node styles (circle type with icons and labels)
 * - Edge styles (arrows, labels, auto-rotation)
 * - Interactive behaviors (zoom, drag, click-select)
 * - State management (active/inactive states for highlighting)
 */

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
 * @returns {Object} G6 graph configuration object
 */
export function createGraphConfig({ container, width, height, edges, labelColor, edgeColor }) {
  // Calculate dynamic node spacing based on edge count
  let nodeSpacing = edges.length * 8;
  nodeSpacing = nodeSpacing < 80 ? 80 : nodeSpacing;
  nodeSpacing = nodeSpacing > 500 ? 500 : nodeSpacing;

  return {
    container,
    width,
    height,
    layout: {
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
    },
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
