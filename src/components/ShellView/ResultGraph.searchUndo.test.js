import { describe, it, expect } from "vitest";
import { GraphHistoryManager } from "../../utils/GraphHistoryManager";

// Regression coverage for adding a node via node search and then undoing it.
//
// The node-search "pick a suggestion" path (ResultGraph.fetchAndAddPinnedEntity)
// records the addition as an 'add-connected-node' history command with
// sourceNodeId: null (there is no expanding source node — the entity is fetched
// by label+pk and dropped onto the canvas). These tests cover ONE thing: that
// the shared add-connected-node undo/redo handlers get the node/edge MEMBERSHIP
// right for the null-source (search-add) case — undo removes exactly the added
// node/edges and redo re-adds them — in BOTH the empty-canvas seed case and the
// additive-onto-an-existing-graph case.
//
// SCOPE / what this does NOT cover:
//   - The repo's vitest runs in the `node` environment (no jsdom, no G6), so the
//     handlers are exercised against a small in-memory stand-in for the G6 graph
//     that models only node/edge membership + the throw-on-unknown-id lookup the
//     component relies on. It deliberately does NOT reproduce the real methods'
//     counter bookkeeping (this.counters.*) or position-pinning (setting/
//     stripping fx/fy); those side effects are out of scope here.
//   - The actual bug fix — the keydown gate (ownsGraphShortcuts(this) &&
//     isGraphVisible()), which stops a Ctrl+Z from firing undo on every
//     mounted (or even every *visible*) ResultGraph instead of only the one
//     the user last interacted with — needs a real DOM (offsetParent,
//     pointerdown) and cannot run under this node-only harness. It is
//     verified in the browser / manually; the ownership half's claim/release
//     semantics are unit-tested in utils/GraphShortcutOwnership.test.js.
//     Reverting the gate would NOT fail this suite; these tests only guard
//     the add/remove/re-add membership contract the gate delivers a
//     correctly-targeted Ctrl+Z to.

// Minimal stand-in for the G6 graph. getNodeData()/getEdgeData() with no
// argument return the full list (what the diff + removal paths read); with an id
// they THROW on an unknown id, matching graphlib's behaviour the component
// guards against.
class FakeG6Graph {
  constructor() {
    this._nodes = [];
    this._edges = [];
  }
  getNodeData(id) {
    if (id === undefined) return this._nodes;
    const node = this._nodes.find((n) => n.id === id);
    if (!node) throw new Error(`node ${id} not found`);
    return node;
  }
  getEdgeData(id) {
    if (id === undefined) return this._edges;
    const edge = this._edges.find((e) => e.id === id);
    if (!edge) throw new Error(`edge ${id} not found`);
    return edge;
  }
  setData({ nodes, edges }) {
    this._nodes = nodes;
    this._edges = edges;
  }
  async render() {}
}

// A component-shaped harness carrying just the state + methods the
// add-connected-node undo/redo path reads. The method bodies model only the
// node/edge MEMBERSHIP changes of ResultGraph.vue's handlers — they omit the
// real counter bookkeeping and fx/fy position-pinning on purpose (see the
// file-header scope note).
function makeGraphHarness() {
  return {
    g6Graph: new FakeG6Graph(),
    counters: { node: {}, rel: {}, total: { node: 0, rel: 0 } },
    neighborCounts: {},
    neighborCountsLoading: new Set(),
    historyManager: new GraphHistoryManager(50, null),

    async render() {},

    // Models the membership half of ResultGraph.removeFromGraph: drop the target
    // nodes/edges and any edge whose endpoint went away, then re-set the
    // surviving data. (The real method also decrements this.counters.* and pins
    // survivors via fx/fy; not modelled here.)
    async removeFromGraph(nodeIdsToRemove, edgeIdsToRemove) {
      if (!this.g6Graph) return;
      if (nodeIdsToRemove.size === 0 && edgeIdsToRemove.size === 0) return;
      const currentNodes = this.g6Graph.getNodeData() || [];
      const currentEdges = this.g6Graph.getEdgeData() || [];
      const filteredNodes = currentNodes.filter((n) => !nodeIdsToRemove.has(n.id));
      const remainingNodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = currentEdges.filter(
        (e) =>
          !edgeIdsToRemove.has(e.id) &&
          remainingNodeIds.has(e.source) &&
          remainingNodeIds.has(e.target)
      );
      this.g6Graph.setData({ nodes: filteredNodes, edges: filteredEdges });
      await this.render();
    },

    // Models the membership half of ResultGraph.undoAddConnectedNode: null
    // sourceNodeId must be a no-op for the source-node cleanup, never a throw.
    async undoAddConnectedNode(data) {
      const nodeIdsToRemove = new Set(data.addedNodes.map((n) => n.id));
      const edgeIdsToRemove = new Set(data.addedEdges.map((e) => e.id));
      nodeIdsToRemove.forEach((nodeId) => {
        delete this.neighborCounts[nodeId];
        this.neighborCountsLoading.delete(nodeId);
      });
      if (data.sourceNodeId) {
        delete this.neighborCounts[data.sourceNodeId];
        this.neighborCountsLoading.delete(data.sourceNodeId);
      }
      await this.removeFromGraph(nodeIdsToRemove, edgeIdsToRemove);
    },

    // Models the membership half of ResultGraph.redoAddConnectedNode: re-add the
    // same nodes/edges. (The real method also re-increments this.counters.* and
    // resets fx/fy so the layout repositions the restored nodes; not modelled.)
    async redoAddConnectedNode(data) {
      if (data.sourceNodeId) {
        delete this.neighborCounts[data.sourceNodeId];
        this.neighborCountsLoading.delete(data.sourceNodeId);
      }
      const currentNodes = this.g6Graph.getNodeData() || [];
      const currentEdges = this.g6Graph.getEdgeData() || [];
      this.g6Graph.setData({
        nodes: currentNodes.concat(data.addedNodes),
        edges: currentEdges.concat(data.addedEdges),
      });
      await this.render();
    },

    // Route a command through the same switch ResultGraph.undo()/redo() use.
    async undo() {
      const cmd = this.historyManager.undo();
      if (!cmd) return;
      if (cmd.type === "add-connected-node") {
        await this.undoAddConnectedNode(cmd.data);
      }
    },
    async redo() {
      const cmd = this.historyManager.redo();
      if (!cmd) return;
      if (cmd.type === "add-connected-node") {
        await this.redoAddConnectedNode(cmd.data);
      }
    },
  };
}

// Reproduce ResultGraph.fetchAndAddPinnedEntity's diff-and-push: snapshot the
// canvas, add the searched node (+ any edge to an existing node), then push the
// 'add-connected-node' history entry with sourceNodeId: null for the nodes/edges
// that actually landed.
function addNodeViaSearch(harness, newNode, newEdges = []) {
  const nodesBefore = new Set(harness.g6Graph.getNodeData().map((n) => n.id));
  const edgesBefore = new Set(harness.g6Graph.getEdgeData().map((e) => e.id));

  harness.g6Graph.setData({
    nodes: harness.g6Graph.getNodeData().concat([newNode]),
    edges: harness.g6Graph.getEdgeData().concat(newEdges),
  });

  const addedNodes = harness.g6Graph.getNodeData().filter((n) => !nodesBefore.has(n.id));
  const addedEdges = harness.g6Graph.getEdgeData().filter((e) => !edgesBefore.has(e.id));

  if (addedNodes.length > 0 || addedEdges.length > 0) {
    harness.historyManager.push({
      type: "add-connected-node",
      data: {
        sourceNodeId: null,
        addedNodes: JSON.parse(JSON.stringify(addedNodes)),
        addedEdges: JSON.parse(JSON.stringify(addedEdges)),
      },
    });
  }
}

function searchNode(id) {
  return { id, style: { x: 1, y: 2 }, data: { properties: { _label: "Person", id } } };
}

describe("add node via node search -> undo/redo", () => {
  it("undo removes the node seeded onto an empty canvas, redo re-adds it", async () => {
    const harness = makeGraphHarness();
    // Empty-canvas seed: the searched entity is the first node on the canvas.
    addNodeViaSearch(harness, searchNode("Person_seed"));

    expect(harness.g6Graph.getNodeData().map((n) => n.id)).toEqual(["Person_seed"]);
    expect(harness.historyManager.canUndo()).toBe(true);

    await harness.undo();
    expect(harness.g6Graph.getNodeData()).toEqual([]);
    expect(harness.historyManager.canUndo()).toBe(false);
    expect(harness.historyManager.canRedo()).toBe(true);

    await harness.redo();
    expect(harness.g6Graph.getNodeData().map((n) => n.id)).toEqual(["Person_seed"]);
  });

  it("undo removes an additively-added node and its edge, leaving the pre-existing graph intact", async () => {
    const harness = makeGraphHarness();
    // Pre-existing graph from a prior query.
    harness.g6Graph.setData({
      nodes: [{ id: "Company_c1", style: { x: 0, y: 0 }, data: { properties: { _label: "Company", id: "c1" } } }],
      edges: [],
    });

    // Searched node lands additively, wired to the pre-existing node.
    addNodeViaSearch(harness, searchNode("Person_p1"), [
      { id: "Directorship_d1", source: "Person_p1", target: "Company_c1", data: { properties: { _label: "Directorship" } } },
    ]);

    expect(harness.g6Graph.getNodeData().map((n) => n.id).sort()).toEqual(["Company_c1", "Person_p1"]);
    expect(harness.g6Graph.getEdgeData().map((e) => e.id)).toEqual(["Directorship_d1"]);

    await harness.undo();
    // Only the pre-existing node remains; the added node AND its edge are gone.
    expect(harness.g6Graph.getNodeData().map((n) => n.id)).toEqual(["Company_c1"]);
    expect(harness.g6Graph.getEdgeData()).toEqual([]);

    await harness.redo();
    expect(harness.g6Graph.getNodeData().map((n) => n.id).sort()).toEqual(["Company_c1", "Person_p1"]);
    expect(harness.g6Graph.getEdgeData().map((e) => e.id)).toEqual(["Directorship_d1"]);
  });

  it("undo of a null-source add never throws (no silent 'Undo failed')", async () => {
    const harness = makeGraphHarness();
    addNodeViaSearch(harness, searchNode("Person_x"));
    // The history entry carries sourceNodeId: null; the undo handler must treat
    // the source-node cleanup as a no-op rather than dereferencing null.
    await expect(harness.undo()).resolves.toBeUndefined();
    expect(harness.g6Graph.getNodeData()).toEqual([]);
  });
});
