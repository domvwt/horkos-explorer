/**
 * DisplayLabels - Backwards-compatible re-export shim.
 *
 * The node/rel display-name maps now live in the unified DisplayPolicy module.
 * This file re-exports them so existing importers keep working; new code should
 * import from DisplayPolicy directly.
 */

export {
  REL_TYPE_DISPLAY_NAMES,
  NODE_TYPE_DISPLAY_NAMES,
  relTypeDisplayName,
  nodeTypeDisplayName,
} from "./DisplayPolicy";
