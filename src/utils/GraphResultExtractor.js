/**
 * GraphResultExtractor - Extracts G6 graph data from Kuzu query results
 *
 * This utility parses Kuzu query results containing NODE, REL, and RECURSIVE_REL
 * data types and converts them into G6-compatible node and edge objects.
 *
 * Responsibilities:
 * - Parse query result rows and extract nodes/edges
 * - Handle recursive relationship results
 * - Apply visual settings from the settings store
 * - Count nodes/edges by label for overview statistics
 * - Handle overlapping edges and self-loops
 * - Enforce max node limits
 */

import G6Utils from "./G6Utils";
import ValueFormatter from "./ValueFormatter";
import { DATA_TYPES, LOOP_POSITIONS, ARC_CURVE_OFFSETS, POSSIBLE_MATCH_STYLE } from "./Constants";
import {
  NODE_TYPE_DISPLAY_NAMES,
  relTypeDisplayName,
  isAmbiguousRelType,
  isVirtualNodeType,
  POSSIBLE_MATCH_LABEL_PREFIX,
} from "./DisplayPolicy";

/**
 * Encode a Kuzu internal ID to a string suitable for G6 node/edge IDs
 * @param {Object} id - Kuzu internal ID with table and offset properties
 * @returns {string} Encoded ID string
 */
export function encodeId(id) {
  return `${id.table}_${id.offset}`;
}

/**
 * Get Font Awesome icon unicode for a node label
 * @param {string} nodeLabel - The node label/type
 * @returns {string} Font Awesome unicode character
 */
export function getNodeIcon(nodeLabel) {
  const iconMap = {
    'Person': '\uf007',      // fa-user
    'Company': '\uf1ad',     // fa-building
    'Address': '\uf3c5',     // fa-map-marker-alt
  };
  return iconMap[nodeLabel] || '\uf111'; // fa-circle as fallback
}

/**
 * Format a node's display label property using schema type information
 * @param {Object} rawNode - Raw node properties from Kuzu
 * @param {Object} schema - Database schema with nodeTables
 * @param {Object} settingsStore - Settings store for label property config
 * @returns {string} Formatted label string for display
 */
export function formatNodeLabel(rawNode, schema, settingsStore) {
  if (!rawNode || !rawNode._label) {
    return "";
  }

  // Settings are derived from the schema after it loads; a label can lack an
  // entry if a result is formatted before that happens.
  const nodeSettings = settingsStore.settingsForLabel(rawNode._label);
  const nodeLabelProp = nodeSettings?.label;

  // Prefer the configured label property (a hub's build-time `name`, a
  // Person/Company name, an Address `full`) so a representative label shows
  // rather than the raw cluster id. This runs BEFORE the type-name fallback so
  // internal node tables (VirtualHub) that now carry a `name` display it.
  if (nodeLabelProp && rawNode[nodeLabelProp] !== undefined && rawNode[nodeLabelProp] !== null && rawNode[nodeLabelProp] !== "") {
    // A hub's representative name gets the ≈ prefix so the canvas never shows
    // it as a second, identically-named real entity (the type-name fallback
    // below already reads as tentative and takes no prefix).
    const prefix = isVirtualNodeType(rawNode._label) ? POSSIBLE_MATCH_LABEL_PREFIX : "";
    // Find the property type from the schema for proper formatting.
    const nodeTable = schema?.nodeTables?.find((table) => table.name === rawNode._label);
    if (nodeTable) {
      const property = nodeTable.properties.find((p) => p.name === nodeLabelProp);
      if (property) {
        return prefix + String(ValueFormatter.beautifyValue(rawNode[nodeLabelProp], property.type));
      }
    }
    // Fallback to string conversion if no schema info.
    return prefix + String(rawNode[nodeLabelProp]);
  }

  // No label-property value: for internal node tables (VirtualHub), fall back to
  // the plain-English type name rather than the cluster id — this covers graphs
  // built before the pipeline emitted a hub `name`.
  if (NODE_TYPE_DISPLAY_NAMES[rawNode._label]) {
    return NODE_TYPE_DISPLAY_NAMES[rawNode._label];
  }

  // Settings not loaded yet, or a real entity type with no label value.
  return "";
}

/**
 * Build a G6 node object from raw Kuzu node data
 * @param {string} nodeId - The G6 node ID
 * @param {Object} rawNode - Raw node properties from Kuzu (must have _label)
 * @param {Object} settingsStore - Settings store for visual settings
 * @param {Object} [options] - Optional settings
 * @param {number} [options.x] - X position for style
 * @param {number} [options.y] - Y position for style
 * @param {number} [options.fx] - Fixed X position for data (pinning)
 * @param {number} [options.fy] - Fixed Y position for data (pinning)
 * @param {string} [options.formattedLabel] - Pre-formatted label (if not provided, uses raw value)
 * @param {Object} [options.rawProperties] - Original raw properties to store (if different from rawNode)
 * @returns {Object|null} G6 node object, or null when the node is invalid or has no visual settings
 */
export function buildG6Node(nodeId, rawNode, settingsStore, options = {}) {
  if (!rawNode || !rawNode._label) {
    console.warn('buildG6Node: rawNode must have _label property');
    return null;
  }

  const nodeSettings = settingsStore.settingsForLabel(rawNode._label);
  if (!nodeSettings?.g6Settings) {
    console.warn('buildG6Node: no visual settings for label:', rawNode._label);
    return null;
  }
  const nodeFill = nodeSettings.g6Settings.style.fill;

  // Cap node size to prevent extreme zoom when there are few nodes
  const maxNodeSize = 100;
  const displaySize = Math.min(nodeSettings.g6Settings.size, maxNodeSize);

  // Get label text - use pre-formatted if provided, otherwise extract from rawNode
  let nodeLabel = "";
  if (options.formattedLabel !== undefined) {
    nodeLabel = options.formattedLabel;
  } else {
    const nodeLabelProp = nodeSettings.label;
    if (nodeLabelProp && rawNode[nodeLabelProp] !== undefined) {
      nodeLabel = String(rawNode[nodeLabelProp]);
    }
  }

  // Use rawProperties if provided (for storing original unformatted data), otherwise use rawNode
  const propertiesToStore = options.rawProperties || rawNode;

  const g6Node = {
    id: nodeId,
    data: {
      properties: propertiesToStore,
      ...nodeSettings.g6Settings,
    },
    style: {
      size: displaySize,
      fill: nodeFill,
      stroke: G6Utils.shadeColor(nodeFill),
      lineWidth: nodeSettings.g6Settings.style.lineWidth || 0,
      labelText: nodeLabel,
      iconText: getNodeIcon(rawNode._label),
      iconFontFamily: "Font Awesome 6 Free",
      iconFontWeight: 900,
      iconFontSize: displaySize * 0.35,
      iconFill: "#ffffff",
    },
  };

  // Apply position options if provided
  if (options.x !== undefined) {
    g6Node.style.x = options.x;
  }
  if (options.y !== undefined) {
    g6Node.style.y = options.y;
  }
  if (options.fx !== undefined) {
    g6Node.data.fx = options.fx;
  }
  if (options.fy !== undefined) {
    g6Node.data.fy = options.fy;
  }

  return g6Node;
}

/**
 * Build a G6 edge object from raw Kuzu relationship data
 * @param {string} edgeId - The G6 edge ID
 * @param {string} sourceId - Source node ID
 * @param {string} targetId - Target node ID
 * @param {Object} rawRel - Raw relationship properties from Kuzu (must have _label)
 * @param {Object} settingsStore - Settings store for visual settings
 * @param {Object} schema - Database schema for property types (optional but recommended)
 * @param {Object} [options] - Optional settings
 * @param {number} [options.overlapIndex=1] - Index for overlapping edge offset (1-based)
 * @returns {Object|null} G6 edge object, or null when the rel is invalid or has no visual settings
 */
export function buildG6Edge(edgeId, sourceId, targetId, rawRel, settingsStore, schema, options = {}) {
  if (!rawRel || !rawRel._label) {
    console.warn('buildG6Edge: rawRel must have _label property');
    return null;
  }

  const overlapIndex = options.overlapIndex ?? 1;
  const relSettings = settingsStore.settingsForLabel(rawRel._label);
  if (!relSettings?.g6Settings) {
    console.warn('buildG6Edge: no visual settings for label:', rawRel._label);
    return null;
  }

  // Build label with proper formatting
  let relLabel = "";
  const relLabelProp = relSettings.label;
  if (relLabelProp && rawRel[relLabelProp] !== undefined) {
    relLabel = rawRel[relLabelProp];

    // Use group name if showing _label and group exists
    const relTable = schema?.relTables?.find((table) => table.name === rawRel._label);
    if (relLabelProp === '_label' && relTable && relTable.group) {
      relLabel = relTable.group;
    } else if (relLabelProp === '_label') {
      // Re-order actor-first table names relationship-first for display
      relLabel = relTypeDisplayName(relLabel);
    }

    // Format value based on property type if available
    if (relTable) {
      const expectedPropertiesType = {};
      relTable.properties.forEach((property) => {
        expectedPropertiesType[property.name] = property.type;
      });
      if (relLabelProp in expectedPropertiesType) {
        relLabel = ValueFormatter.beautifyValue(rawRel[relLabelProp], expectedPropertiesType[relLabelProp]);
      }
    }

    relLabel = String(relLabel);
    const fontSize = relSettings.g6Settings.labelCfg.style.fontSize;
    // Truncate very long edge labels; wide enough that no schema rel type display name truncates
    relLabel = G6Utils.fittingString(relLabel, 200, fontSize);
  }

  const g6Rel = {
    id: edgeId,
    source: sourceId,
    target: targetId,
    data: {
      properties: rawRel,
      ...relSettings.g6Settings,
    },
    style: {
      stroke: relSettings.g6Settings.style.stroke,
      lineWidth: relSettings.g6Settings.size || 3,
      labelText: relLabel,
    },
  };

  // Possible-match edge: dashed, thin, arrowless. The relation is symmetric
  // (a candidate match), so an arrowhead would assert a direction that does
  // not exist; the stroke inherits the shared neutral edge grey so the dash
  // pattern — not colour weight — carries the differentiation in both themes.
  if (isAmbiguousRelType(rawRel._label)) {
    g6Rel.style.lineWidth = POSSIBLE_MATCH_STYLE.EDGE_LINE_WIDTH;
    // Copy the dash array: G6 receives one array per edge, so no consumer can
    // mutate the shared constant (and with it every other dashed edge).
    g6Rel.style.lineDash = [...POSSIBLE_MATCH_STYLE.EDGE_LINE_DASH];
    g6Rel.style.endArrow = false;
  }

  // Handle self-loops and overlapping edges
  if (sourceId === targetId) {
    // Self-loop (do not set type, otherwise it will not work)
    g6Rel.style.loopDist = 50;
    g6Rel.style.loopPlacement = LOOP_POSITIONS[(overlapIndex - 1) % LOOP_POSITIONS.length];
  } else if (overlapIndex > 1) {
    g6Rel.type = 'quadratic';
    g6Rel.style.curveOffset = ARC_CURVE_OFFSETS[(overlapIndex - 1) % ARC_CURVE_OFFSETS.length];
    g6Rel.style.curvePosition = 0.5;
  } else {
    g6Rel.type = 'line';
  }

  return g6Rel;
}

/**
 * Extract G6-compatible graph data from a Kuzu query result
 *
 * @param {Object} queryResult - Kuzu query result with rows and dataTypes
 * @param {Object} schema - Database schema with nodeTables and relTables
 * @param {Object} settingsStore - Pinia settings store for visual settings
 * @param {Object} performanceSettings - Performance settings with max node limits
 * @returns {Object} Extracted graph data with:
 *   - counters: {node: Object, rel: Object, total: {node: number, rel: number}}
 *   - nodes: Array of G6 node objects
 *   - edges: Array of G6 edge objects
 *   - nodesMap: Object mapping node ID to node object
 *   - edgesMap: Object mapping edge ID to edge object
 *   - sampled: boolean, true when the result exceeded maxNumberOfNodes and was downsampled
 *   - sampledNodeCount: number of nodes actually kept (equals counters.total.node)
 *   - totalNodeCount: number of nodes present in the result before downsampling
 */
export function extractGraphFromQueryResult(queryResult, schema, settingsStore, performanceSettings) {
  // The schema arrives asynchronously at boot (and can fail to load outright);
  // a result drawn before then degrades to an empty graph instead of crashing.
  if (!schema?.nodeTables || !schema?.relTables) {
    console.warn('extractGraphFromQueryResult: schema not loaded, skipping graph extraction');
    return {
      counters: { node: {}, rel: {}, total: { node: 0, rel: 0 } },
      nodes: [],
      edges: [],
      nodesMap: {},
      edgesMap: {},
      sampled: false,
      sampledNodeCount: 0,
      totalNodeCount: 0,
    };
  }

  const rows = queryResult.rows;
  const dataTypes = queryResult.dataTypes;
  const nodes = {};
  const edges = {};
  const numberOfRelsBetweenNodes = {};
  const nodeLabels = {};

  /**
   * Sort node identifiers for consistent edge counting
   */
  const sortNodes = (src, dst) => {
    const sortedLabels = [src.table, dst.table].sort();
    const sortedSrcDst = [src.offset, dst.offset].sort();
    return [sortedLabels[0], sortedSrcDst[0], sortedLabels[1], sortedSrcDst[1]];
  };

  /**
   * Track and count relationships between node pairs for edge offsetting
   */
  const increaseRelCounter = (src, dst) => {
    const sortedNodeInfo = sortNodes(src, dst);
    if (!numberOfRelsBetweenNodes[sortedNodeInfo[0]]) {
      numberOfRelsBetweenNodes[sortedNodeInfo[0]] = {};
    }
    if (!numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]]) {
      numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]] = {};
    }
    if (!numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]][sortedNodeInfo[1]]) {
      numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]][sortedNodeInfo[1]] = {};
    }
    const currentMap = numberOfRelsBetweenNodes[sortedNodeInfo[0]][sortedNodeInfo[2]][sortedNodeInfo[1]];
    if (!currentMap[sortedNodeInfo[3]]) {
      currentMap[sortedNodeInfo[3]] = 0;
    }
    currentMap[sortedNodeInfo[3]] += 1;
    return currentMap[sortedNodeInfo[3]];
  };

  /**
   * Process a raw node from query results into a G6 node object
   */
  const processNode = (rawNode) => {
    if (!rawNode || !rawNode._id || !rawNode._label) {
      console.warn('Invalid node data:', rawNode);
      return;
    }

    const nodeId = encodeId(rawNode._id);
    nodeLabels[rawNode._id.table] = rawNode._label;

    if (nodes[nodeId]) {
      return;
    }

    // Validate node table exists in schema
    const nodeTable = schema.nodeTables.find((table) => table.name === rawNode._label);
    if (!nodeTable) {
      console.warn('Node table not found for label:', rawNode._label);
      return;
    }

    // Format label for display
    const formattedLabel = formatNodeLabel(rawNode, schema, settingsStore);

    const g6Node = buildG6Node(nodeId, rawNode, settingsStore, {
      formattedLabel,
      rawProperties: rawNode,  // Store original raw properties for data access
    });

    if (g6Node) {
      nodes[nodeId] = g6Node;
    }
  };

  /**
   * Process a raw relationship from query results into a G6 edge object
   */
  const processRel = (rawRel) => {
    if (!rawRel || !rawRel._id || !rawRel._label || !rawRel._src || !rawRel._dst) {
      console.warn('Invalid rel data:', rawRel);
      return;
    }

    const relId = encodeId(rawRel._id);
    const numberOfOverlappingRels = increaseRelCounter(rawRel._src, rawRel._dst);

    if (edges[relId]) {
      return;
    }

    const relTable = schema.relTables.find((table) => table.name === rawRel._label);
    if (!relTable) {
      console.warn('Rel table not found for label:', rawRel._label);
      return;
    }

    const g6Rel = buildG6Edge(
      relId,
      encodeId(rawRel._src),
      encodeId(rawRel._dst),
      rawRel,
      settingsStore,
      schema,
      { overlapIndex: numberOfOverlappingRels }
    );

    if (g6Rel) {
      edges[relId] = g6Rel;
    }
  };

  // Process all rows and deduplicate nodes and edges
  rows.forEach((row) => {
    for (let key in row) {
      switch (dataTypes[key]) {
        case DATA_TYPES.NODE: {
          if (!row[key] || !row[key]._id) {
            continue;
          }
          const node = { ...row[key] };
          processNode(node);
          break;
        }
        case DATA_TYPES.REL: {
          if (!row[key] || !row[key]._src || !row[key]._dst) {
            continue;
          }
          const rel = { ...row[key] };
          processRel(rel);
          break;
        }
        case DATA_TYPES.RECURSIVE_REL: {
          const recursiveRel = { ...row[key] };
          if (recursiveRel._nodes && Array.isArray(recursiveRel._nodes)) {
            recursiveRel._nodes.forEach((originalNode) => {
              if (!originalNode || !originalNode._id) return;
              const nodeCopy = { ...originalNode };
              const nodeId = encodeId(nodeCopy._id);
              if (nodes[nodeId]) {
                return;
              }
              for (let propKey in nodeCopy) {
                if (nodeCopy[propKey] === null || nodeCopy[propKey] === undefined) {
                  delete nodeCopy[propKey];
                }
              }
              processNode(nodeCopy);
            });
          }
          if (recursiveRel._rels && Array.isArray(recursiveRel._rels)) {
            recursiveRel._rels.forEach((originalRel) => {
              if (!originalRel || !originalRel._id) return;
              const relCopy = { ...originalRel };
              const relId = encodeId(relCopy._id);
              if (edges[relId]) {
                return;
              }
              for (let propKey in relCopy) {
                if (relCopy[propKey] === null || relCopy[propKey] === undefined) {
                  delete relCopy[propKey];
                }
              }
              processRel(relCopy);
            });
          }
          break;
        }
        default:
          break;
      }
    }
  });

  // Enforce max node limit with an honest, linear-time random sample: a
  // Fisher-Yates shuffle of the node IDs followed by a straight truncation.
  // (The previous approach looped `while (nodeIds.length > max)` picking a
  // random index and splice()-ing it out one at a time — O(n^2) on large
  // result sets, and it silently dropped nodes with no trace left for the UI.)
  const preSampleNodeCount = Object.keys(nodes).length;
  const sampled = preSampleNodeCount > performanceSettings.maxNumberOfNodes;
  let sampledNodeCount = preSampleNodeCount;
  if (sampled) {
    const nodeIds = Object.keys(nodes);
    // Fisher-Yates shuffle.
    for (let i = nodeIds.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [nodeIds[i], nodeIds[j]] = [nodeIds[j], nodeIds[i]];
    }
    const keepIds = new Set(nodeIds.slice(0, performanceSettings.maxNumberOfNodes));
    for (const nodeId of nodeIds) {
      if (!keepIds.has(nodeId)) {
        delete nodes[nodeId];
      }
    }
    sampledNodeCount = keepIds.size;
    // Remove edges that reference removed nodes
    for (let key in edges) {
      const edge = edges[key];
      if (!nodes[edge.source] || !nodes[edge.target]) {
        delete edges[key];
      }
    }
  }

  // Calculate node counters by label
  const nodeCounters = {};
  for (let key in nodes) {
    const label = nodes[key].data.properties._label;
    if (!nodeCounters[label]) {
      nodeCounters[label] = 0;
    }
    nodeCounters[label] += 1;
  }

  // Calculate relationship counters by label
  const relCounters = {};
  for (let key in edges) {
    const label = edges[key].data.properties._label;
    if (!relCounters[label]) {
      relCounters[label] = 0;
    }
    relCounters[label] += 1;
  }

  const postSampleNodeCount = Object.values(nodeCounters).reduce((a, b) => a + b, 0);
  const totalRelCount = Object.values(relCounters).reduce((a, b) => a + b, 0);

  const counters = {
    node: nodeCounters,
    rel: relCounters,
    total: {
      node: postSampleNodeCount,
      rel: totalRelCount,
    },
  };

  // Calculate node degrees for dynamic force layout distance
  const nodeDegrees = {};
  Object.values(edges).forEach(edge => {
    nodeDegrees[edge.source] = (nodeDegrees[edge.source] || 0) + 1;
    nodeDegrees[edge.target] = (nodeDegrees[edge.target] || 0) + 1;
  });

  // Add degree information to node data
  Object.values(nodes).forEach(node => {
    node.data.degree = nodeDegrees[node.id] || 0;
  });

  // Remove labels if too many nodes (performance optimization)
  if (postSampleNodeCount > performanceSettings.maxNumberOfNodesWithLabels) {
    for (let key in nodes) {
      const node = nodes[key];
      delete node.style.labelText;
    }
    for (let key in edges) {
      const edge = edges[key];
      delete edge.style.labelText;
    }
  }

  return {
    counters,
    nodes: Object.values(nodes),
    edges: Object.values(edges),
    nodesMap: nodes,
    edgesMap: edges,
    sampled,
    sampledNodeCount,
    totalNodeCount: preSampleNodeCount,
  };
}

export default {
  encodeId,
  getNodeIcon,
  formatNodeLabel,
  buildG6Node,
  buildG6Edge,
  extractGraphFromQueryResult,
};
