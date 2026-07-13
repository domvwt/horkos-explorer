export const DATA_TYPES = {
  ANY: "ANY",
  NODE: "NODE",
  REL: "REL",
  RECURSIVE_REL: "RECURSIVE_REL",
  SERIAL: "SERIAL",
  BOOL: "BOOL",
  INT128: "INT128",
  INT64: "INT64",
  INT32: "INT32",
  INT16: "INT16",
  INT8: "INT8",
  UINT64: "UINT64",
  UINT32: "UINT32",
  UINT16: "UINT16",
  UINT8: "UINT8",
  DOUBLE: "DOUBLE",
  FLOAT: "FLOAT",
  DATE: "DATE",
  TIMESTAMP: "TIMESTAMP",
  TIMESTAMP_NS: "TIMESTAMP_NS",
  TIMESTAMP_MS: "TIMESTAMP_MS",
  TIMESTAMP_SEC: "TIMESTAMP_SEC",
  TIMESTAMP_TZ: "TIMESTAMP_TZ",
  INTERVAL: "INTERVAL",
  FIXED_LIST: "FIXED_LIST",
  INTERNAL_ID: "INTERNAL_ID",
  ARROW_COLUMN: "ARROW_COLUMN",
  STRING: "STRING",
  BLOB: "BLOB",
  VAR_LIST: "VAR_LIST",
  STRUCT: "STRUCT",
  MAP: "MAP",
  UNION: "UNION",
  UUID: "UUID",
};

export const UI_SIZE = {
  DEFAULT_MARGIN: 20,
  SHELL_TOOL_BAR_WIDTH: 40,
  DEFAULT_BORDER_WIDTH: 2,
};

export const SHOW_REL_LABELS_OPTIONS = {
  ALWAYS: "ALWAYS",
  HOVER: "HOVER",
  NEVER: "NEVER",
};

export const MODES = {
  READ_WRITE: "READ_WRITE",
  READ_ONLY: "READ_ONLY",
};



export const ARC_CURVE_OFFSETS = [
  0, 60, -60, 80, -80, 100, -100, 120, -120, 140, -140, 160, -160, 180, -180, 200, -200,
];

export const LOOP_POSITIONS = [
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
  "top-left",
];

export const TABLE_TYPES = {
  NODE: "NODE",
  REL: "REL",
};

export const LOADING_STATUS = {
  EVAL: "Evaluating query...",
  PROCESS: "Processing results...",
};

// Deploy-time legal / operator identity for the Art. 14 privacy notice and the
// per-result disclaimer. Re-exported from a CommonJS module so the SAME single
// source of truth is readable by both the app bundle (ESM) and the build-time
// guard in vue.config.js (CommonJS). Complete the [SET AT DEPLOY] values before
// public launch — a production build hard-fails until they are (see README).
export { LEGAL } from "../config/legal.config";

// Visual treatment for possible-match edges (see DisplayPolicy for layer
// membership): dashed, thin, arrowless — the dash carries the tentative
// semantics; the stroke inherits the shared neutral edge grey. Hub NODES
// deliberately keep their standard solid rendering: a novel hollow shape
// would be a new visual vocabulary the viewer must learn, which costs more
// than it signals.
export const POSSIBLE_MATCH_STYLE = {
  EDGE_LINE_WIDTH: 2,
  EDGE_LINE_DASH: [4, 4],
};

export const GRAPH_LAYOUTS = {
  D3_FORCE: {
    key: 'd3-force',
    label: 'Force-Directed',
    icon: 'fa-circle-nodes',
    description: 'Organic clustering, relationship density',
  },
  CIRCULAR: {
    key: 'circular',
    label: 'Circular',
    icon: 'fa-circle',
    description: 'Overview, equal visual weight',
  },
  DAGRE: {
    key: 'dagre',
    label: 'Hierarchical',
    icon: 'fa-sitemap',
    description: 'Ownership chains (Person→Company→Company)',
  },
  CONCENTRIC: {
    key: 'concentric',
    label: 'Concentric',
    icon: 'fa-compact-disc',
    description: 'Importance analysis, hubs in center',
  },
};
