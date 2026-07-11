import { describe, it, expect, vi } from "vitest";

// The edge-integrity guard that lives inline in ResultGraph.vue's addData, just
// before `this.g6Graph.setData(newData)`. G6 v5's setData throws an uncaught
// "Node not found for id: <id>" when an edge references an endpoint node that is
// not in the node set — the intermittent crash this guards against. The guard is
// a pure predicate over (final node set, candidate edges): keep an edge only if
// BOTH its top-level .source and .target are in the final node-id set; otherwise
// drop it and console.warn (never swallow) so the drop is visible and ties back
// to the fetcher's `incomplete` signal.
//
// ResultGraph.vue is a large SFC that vitest does not compile cleanly (see the
// sibling ResultGraph.completeEdges.test.js, which tests pure logic rather than
// mounting the component). So this locks the guard's SEMANTICS with a DB-free
// reference implementation that mirrors the inline code exactly. If the inline
// predicate changes, this reference must change with it.
function integrityFilterEdges(finalNodes, candidateEdges) {
  const finalNodeIds = new Set(finalNodes.map((node) => node.id));
  return candidateEdges.filter((edge) => {
    if (finalNodeIds.has(edge.source) && finalNodeIds.has(edge.target)) {
      return true;
    }
    console.warn(
      `addData: dropping dangling edge ${edge.id} (source=${edge.source}, target=${edge.target}) — endpoint not in node set`
    );
    return false;
  });
}

const node = (id) => ({ id });
const edge = (id, source, target) => ({ id, source, target });

describe("addData edge-integrity guard (ResultGraph.vue)", () => {
  it("keeps edges whose source and target are both in the final node set", () => {
    const nodes = [node("A"), node("B"), node("C")];
    const edges = [edge("A-B", "A", "B"), edge("B-C", "B", "C")];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const kept = integrityFilterEdges(nodes, edges);

    expect(kept.map((e) => e.id)).toEqual(["A-B", "B-C"]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops an edge whose target node is missing (the crash case) and warns", () => {
    const nodes = [node("A"), node("B")];
    // A-Z references Z, which was never added (e.g. its row was dropped by a
    // partial shed). Feeding this to G6 setData is exactly the crash.
    const edges = [edge("A-B", "A", "B"), edge("A-Z", "A", "Z")];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const kept = integrityFilterEdges(nodes, edges);

    expect(kept.map((e) => e.id)).toEqual(["A-B"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("A-Z");
    warn.mockRestore();
  });

  it("drops an edge whose source node is missing and warns", () => {
    const nodes = [node("A"), node("B")];
    const edges = [edge("X-B", "X", "B")];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const kept = integrityFilterEdges(nodes, edges);

    expect(kept).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not swallow drops silently — one warn per dropped edge", () => {
    const nodes = [node("A")];
    const edges = [edge("A-Y", "A", "Y"), edge("Z-A", "Z", "A"), edge("Q-R", "Q", "R")];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const kept = integrityFilterEdges(nodes, edges);

    expect(kept).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("keeps a self-loop when its node is present, drops it when absent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(integrityFilterEdges([node("A")], [edge("A-A", "A", "A")])).toHaveLength(1);
    expect(integrityFilterEdges([node("B")], [edge("A-A", "A", "A")])).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("passes an empty edge list through unchanged", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(integrityFilterEdges([node("A")], [])).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
