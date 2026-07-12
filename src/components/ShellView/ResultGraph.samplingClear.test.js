import { describe, it, expect } from "vitest";

// The nodeSampling-clearing logic that lives inline across several mutation
// entry points in ResultGraph.vue: addData, removeFromGraph,
// restoreNodesAndEdges, redoAddConnectedNode, and restoreInvestigationState.
// nodeSampling backs the "Showing 500 of 2,341 nodes" caption
// (nodeCountCaption computed) that drawGraph() sets when
// GraphResultExtractor downsampled the INITIAL query result. Once the user
// mutates the canvas (expand, remove, undo/redo, a pinned-entity add, a
// restored saved view) the denominator (totalNodeCount) no longer describes
// what's on screen, so every one of those entry points clears nodeSampling
// back to its unsampled default rather than try to recompute a number that
// was never truly know-able post-mutation.
//
// ResultGraph.vue is a large SFC that vitest does not compile (see
// ResultGraph.edgeIntegrity.test.js for the same repo-wide pattern), so this
// locks the clearing SEMANTICS with a reference implementation that mirrors
// each inline site. If any of those sites change, this reference must change
// with it.
const UNSAMPLED = { sampled: false, totalNodeCount: 0 };

function makeGraphHarness(initialSampling) {
  return {
    nodeSampling: initialSampling,
    // Mirrors the tail of addData: only clears when a genuine add happened
    // (nodesToAdd/edgesToAdd non-empty) - a no-op call (everything already
    // on canvas) leaves sampling state untouched.
    addData(nodesToAdd, edgesToAdd) {
      if (nodesToAdd.length > 0 || edgesToAdd.length > 0) {
        this.nodeSampling = { ...UNSAMPLED };
      }
    },
    // Mirrors the tail of removeFromGraph: the function early-returns before
    // this point when both removal sets are empty, so reaching here always
    // means a genuine mutation - clears unconditionally.
    removeFromGraph(nodeIdsToRemove, edgeIdsToRemove) {
      if (nodeIdsToRemove.size === 0 && edgeIdsToRemove.size === 0) {
        return;
      }
      this.nodeSampling = { ...UNSAMPLED };
    },
    // Mirrors the tail of restoreNodesAndEdges (undo-remove, undo-collapse,
    // redo-expand, redo-expandGraph).
    restoreNodesAndEdges(nodesToRestore, edgesToRestore) {
      if (nodesToRestore.length > 0 || edgesToRestore.length > 0) {
        this.nodeSampling = { ...UNSAMPLED };
      }
    },
    // Mirrors the tail of redoAddConnectedNode.
    redoAddConnectedNode(data) {
      if (data.addedNodes.length > 0 || data.addedEdges.length > 0) {
        this.nodeSampling = { ...UNSAMPLED };
      }
    },
    // Mirrors the tail of restoreInvestigationState's g6Graph branch: a
    // full canvas replacement always clears, unconditionally.
    restoreInvestigationState() {
      this.nodeSampling = { ...UNSAMPLED };
    },
  };
}

describe("ResultGraph nodeSampling clearing on canvas mutation", () => {
  it("clears a sampled caption when addData adds new nodes", () => {
    const harness = makeGraphHarness({ sampled: true, totalNodeCount: 2341 });
    harness.addData([{ id: "n1" }], []);
    expect(harness.nodeSampling).toEqual(UNSAMPLED);
  });

  it("leaves sampling untouched when addData is a pure no-op (nothing new)", () => {
    const sampled = { sampled: true, totalNodeCount: 2341 };
    const harness = makeGraphHarness(sampled);
    harness.addData([], []);
    expect(harness.nodeSampling).toBe(sampled);
  });

  it("clears on node removal", () => {
    const harness = makeGraphHarness({ sampled: true, totalNodeCount: 2341 });
    harness.removeFromGraph(new Set(["n1"]), new Set());
    expect(harness.nodeSampling).toEqual(UNSAMPLED);
  });

  it("clears on clearCanvas-style bulk removal", () => {
    const harness = makeGraphHarness({ sampled: true, totalNodeCount: 2341 });
    harness.removeFromGraph(new Set(["n1", "n2", "n3"]), new Set(["e1"]));
    expect(harness.nodeSampling).toEqual(UNSAMPLED);
  });

  it("leaves sampling untouched when removeFromGraph has nothing to remove", () => {
    const sampled = { sampled: true, totalNodeCount: 2341 };
    const harness = makeGraphHarness(sampled);
    harness.removeFromGraph(new Set(), new Set());
    expect(harness.nodeSampling).toBe(sampled);
  });

  it("clears on undo/redo restore that brings nodes back", () => {
    const harness = makeGraphHarness({ sampled: true, totalNodeCount: 2341 });
    harness.restoreNodesAndEdges([{ id: "n1" }], []);
    expect(harness.nodeSampling).toEqual(UNSAMPLED);
  });

  it("clears on a redo of add-connected-node", () => {
    const harness = makeGraphHarness({ sampled: true, totalNodeCount: 2341 });
    harness.redoAddConnectedNode({ addedNodes: [{ id: "n1" }], addedEdges: [] });
    expect(harness.nodeSampling).toEqual(UNSAMPLED);
  });

  it("clears unconditionally on a saved-view restore", () => {
    const harness = makeGraphHarness({ sampled: true, totalNodeCount: 2341 });
    harness.restoreInvestigationState();
    expect(harness.nodeSampling).toEqual(UNSAMPLED);
  });

  it("is a no-op to clear an already-unsampled state (idempotent)", () => {
    const harness = makeGraphHarness({ ...UNSAMPLED });
    harness.addData([{ id: "n1" }], []);
    expect(harness.nodeSampling).toEqual(UNSAMPLED);
  });
});
