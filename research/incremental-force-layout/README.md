# Incremental Force Layout Research

**Goal**: Pin existing nodes when adding new nodes to the graph, so only new nodes are positioned by d3-force.

## Context

When users expand nodes in Horkos Explorer, new neighbors are added to the graph. Currently, all nodes (existing + new) are re-positioned by the force layout, causing existing nodes to drift from their positions. This breaks the user's mental map of the graph.

## Problem Statement

### Current Behavior (addData in ResultGraph.vue:1623-1671)

1. Get current nodes and edges from graph
2. Filter out duplicates
3. Call `setData()` with ALL nodes (existing + new)
4. Force layout recalculates positions for ALL nodes
5. Existing nodes drift from their previous positions

### Desired Behavior

1. Get current nodes and edges
2. **Pin existing nodes** at their current positions (using `fx`/`fy` properties)
3. Add new nodes WITHOUT `fx`/`fy` (allowing force to position them)
4. Force layout only moves new nodes, existing nodes stay fixed
5. After stabilization, optionally unpin all nodes for dragging

## Solution: d3-force Fixed Positions

d3-force supports pinning nodes via `fx` and `fy` properties:
- Nodes with `fx`/`fy` defined are **fixed** and won't move during simulation
- Nodes without `fx`/`fy` are **free** and positioned by forces

Source: [d3-force documentation](https://d3js.org/d3-force/simulation)

### Implementation Strategy

```javascript
async addData(nodes, edges) {
  // ... existing duplicate filtering code ...

  const currentNodes = this.g6Graph.getNodeData() || [];
  const currentEdges = this.g6Graph.getEdgeData() || [];

  // PIN EXISTING NODES: Add fx/fy to freeze their positions
  const pinnedExistingNodes = currentNodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      fx: node.style.x,  // Fix x position
      fy: node.style.y   // Fix y position
    }
  }));

  // New nodes DON'T have fx/fy, so force will position them
  const newData = {
    nodes: pinnedExistingNodes.concat(nodesToAdd),
    edges: currentEdges.concat(edgesToAdd),
  };

  this.g6Graph.setData(newData);
  await this.render();

  // Optional: After layout stabilizes, unpin all nodes to allow dragging
  setTimeout(() => {
    this.unpinAllNodes();
  }, 2000);
}

unpinAllNodes() {
  const nodes = this.g6Graph.getNodeData().map(n => ({
    ...n,
    data: { ...n.data, fx: undefined, fy: undefined }
  }));
  this.g6Graph.setData({
    nodes,
    edges: this.g6Graph.getEdgeData()
  });
}
```

## Benefits

1. **Preserves Mental Map**: Existing nodes don't move when expanding
2. **Performance**: Only new nodes are positioned (O(new) vs O(all))
3. **Scalability**: Works well with large graphs (100+ nodes)
4. **User Experience**: Smooth incremental exploration
5. **Simpler Low-Alpha Workaround**: May not need alpha=0.3 hack if existing nodes are pinned

## Testing Plan

1. Create test HTML page with G6 + d3-force layout
2. Initial graph with 5-10 nodes
3. Button to add 1-3 new nodes
4. Verify existing nodes stay fixed
5. Verify new nodes position correctly relative to fixed nodes
6. Test unpinning after stabilization

## Questions to Investigate

1. ✅ Does G6 v5 pass through `fx`/`fy` to d3-force? (Answer: Yes, confirmed by d3-force docs)
2. ⏳ Do we still need `alpha=0.3` if existing nodes are pinned?
3. ⏳ What's the optimal timeout for unpinning? (2000ms? Based on layout stabilization?)
4. ⏳ Should we unpin at all, or leave nodes fixed until user manually drags?
5. ⏳ How does this interact with saved positions (localStorage/URL state)?

## Related Files

- `src/components/ShellView/ResultGraph.vue:1623-1671` - `addData()` method
- `src/components/ShellView/ResultGraph.vue:1540-1580` - `createForceLayoutConfig()` - alpha=0.3 workaround
- `src/components/ShellView/ResultGraph.vue:1468-1500` - Position restoration from saved state

## Next Steps

1. Create test HTML page (`public/test-incremental-force-layout.html`)
2. Implement pinning strategy in test
3. Validate behavior with different graph sizes
4. Document findings and update `ResultGraph.vue` if successful
5. Consider removing alpha=0.3 workaround if pinning solves the drift problem

## References

- [d3-force simulation docs](https://d3js.org/d3-force/simulation) - fx/fy fixed positions
- [G6 v5 d3-force plugin](https://g6-next.antv.antgroup.com/en/apis/layout/d3-force) - G6's d3-force integration
