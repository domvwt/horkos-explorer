# Investigation Sharing - Node Position Persistence

## ✅ SOLUTION FOUND

**Status**: Complete working solution with <1px position drift
**Date**: 2025-10-12
**See**: [SOLUTION.md](./SOLUTION.md) for complete implementation guide

**Quick Summary**: Use `fixed` layout type when loading shared investigations, with saved x/y positions passed via `node.data.x/y`. Achieves 0.75px average drift (essentially perfect).

---

## Problem Statement

When users share investigation URLs, the graph node positions are not preserved. Upon loading a shared URL, the force-directed layout recalculates positions from scratch, resulting in a completely different visual arrangement than what the original user saw.

**Goal**: Preserve exact node positions when sharing investigation URLs so recipients see the same graph layout.

## Current State (As of Session Start)

### What Works
- ✅ Query text is saved and restored
- ✅ Complete graph data (nodes and edges with properties) is saved
- ✅ Hidden elements state is preserved
- ✅ Viewport zoom level is saved
- ✅ URL compression via LZ-String works

### What Doesn't Work
- ❌ Node positions are not captured when generating share URLs
- ❌ Force layout recalculates positions on restore, creating different layouts

### Current Implementation

**Files involved:**
- `src/components/ShellView/ResultGraph.vue` - Graph visualization component
- `src/utils/InvestigationState.js` - State serialization/deserialization

**Current approach:**
```javascript
// getInvestigationState() in ResultGraph.vue (lines ~1918-1923)
graphData = {
  nodes: this.g6Graph.getNodeData() || [],  // Missing positions!
  edges: this.g6Graph.getEdgeData() || [],
};
```

The problem: `getNodeData()` returns the base node configuration but **not** the runtime positions calculated by the d3-force simulation.

## Technical Context

### G6 v5 + d3-force Layout

**Key facts:**
1. **G6 v5.0.49** is used for graph visualization
2. **d3-force layout** handles node positioning via physics simulation
3. **Positions are runtime state** in the force simulation, not in G6's node data
4. **fx/fy convention**: d3-force uses `fx` and `fy` properties to mark nodes as having "fixed" positions that shouldn't move

### Where Positions Live

```
graph.getData()           // Returns base config (no positions)
graph.getNodeData(id)     // Returns node config (no positions)
graph.getLayout()         // Returns layout controller
  .simulation             // d3-force simulation object
    .nodes()              // Array of simulation nodes with x, y, fx, fy
```

**d3-force simulation nodes have:**
- `id`: Node identifier
- `x`, `y`: Current calculated position (changes during simulation)
- `fx`, `fy`: Fixed position (if set, node won't move)
- Other physics properties (vx, vy, etc.)

### Current Force Layout Config

From `src/components/ShellView/graphConfig.js`:
```javascript
layout: {
  type: 'd3-force',
  link: { distance: 100-500, strength: 2 },
  collide: { radius: (d) => d.size / 2 + 80, strength: 1.2 },
  manyBody: { strength: -1800 },
  alpha: 1,
  alphaMin: 0.2,
  alphaDecay: 0.03,
  velocityDecay: 0.45,
}
```

## Investigation Session Notes

### Attempts Made (All Failed)

1. **Direct position extraction from simulation**
   - Tried accessing `layout.simulation.nodes()` and extracting `x/y`
   - Stored as `fx/fy` in node data
   - **Issue**: Unclear if this actually worked - needs testing

2. **Pre-fixing positions before capture**
   - Modified simulation nodes to set `fx = x`, `fy = y`
   - Called `layout.simulation.nodes(modifiedNodes)`
   - **Issue**: Didn't test if this actually persisted

3. **Multiple G6 API attempts**
   - `getNodeDisplayModel()` - doesn't exist in v5
   - `getElementPosition()` - doesn't exist or doesn't return data
   - `getData()` - returns base config only

### Why We Failed

**Root cause**: We kept adding complexity without testing intermediate steps. We need to:
1. Verify positions can be extracted from simulation
2. Verify positions can be saved to node data
3. Verify d3-force respects fx/fy on restore
4. Test each step independently

## Proposed Solution

### Approach 1: Fix Positions on Share (Simplest)

When user clicks "Share Investigation":

```javascript
// In generateShareUrl()
const layout = this.g6Graph.getLayout();
const simNodes = layout.simulation.nodes();

// Set fx/fy to lock current positions
simNodes.forEach(node => {
  if (node.x !== undefined && node.y !== undefined) {
    node.fx = node.x;
    node.fy = node.y;
  }
});

// Update simulation
layout.simulation.nodes(simNodes);

// Now capture state - positions should be in node data
const state = this.getInvestigationState();
```

**Pros:**
- Simple, direct approach
- Uses d3-force's built-in fixed position mechanism
- Stops layout from moving after share

**Cons:**
- Graph stops moving after clicking "Share" (might be good UX?)
- Need to verify fx/fy are included in node data from getNodeData()

### Approach 2: Extract and Store Separately

Capture positions separately and merge during serialization:

```javascript
// In getInvestigationState()
const nodeData = this.g6Graph.getNodeData();
const layout = this.g6Graph.getLayout();
const simNodes = layout.simulation.nodes();

// Create position map
const positions = {};
simNodes.forEach(node => {
  positions[node.id] = { x: node.x, y: node.y };
});

// Merge positions into node data
const nodesWithPositions = nodeData.map(node => ({
  ...node,
  data: {
    ...node.data,
    fx: positions[node.id]?.x,
    fy: positions[node.id]?.y,
  }
}));
```

**Pros:**
- Doesn't modify running simulation
- Clear separation of concerns

**Cons:**
- More complex
- Need to ensure fx/fy survive serialization

### Approach 3: Use Different Layout on Restore

Keep force layout for initial positioning, but switch to fixed layout when restoring shared investigations:

```javascript
// In restoreInvestigationState()
const graphConfig = createGraphConfig({
  // ... other config
  layout: {
    type: 'fixed',  // Use fixed layout instead of d3-force
  }
});
```

**Pros:**
- Simple - no position extraction needed
- Nodes just stay where they're placed

**Cons:**
- Need to verify fixed layout exists in G6 v5
- Loses ability to re-run layout on shared graphs
- User can't drag nodes to re-optimize

## Next Steps

### ✅ Test File Created

A comprehensive test suite has been created: **`/test-g6-position-research.html`**

**How to run the tests:**

1. Start the dev server: `npm run serve`
2. Open in browser: http://localhost:8080/test-g6-position-research.html
3. Click "Run All Tests" button
4. Watch the graph visualization and read the detailed log output

**What the tests do:**

1. **Test 1**: Verify `layout.simulation.nodes()` returns actual position data (x, y, fx, fy)
2. **Test 2**: Set `fx`/`fy` on simulation nodes and verify they persist
3. **Test 3**: Check if `getNodeData()` includes `fx`/`fy` after setting them
4. **Test 4**: Manually merge simulation positions into node data for serialization
5. **Test 5**: Destroy and recreate graph to verify positions are preserved

**Expected outcomes:**
- Tests 1-2 should PASS (simulation APIs work)
- Test 3 likely FAILS (G6 doesn't auto-sync simulation state to node data)
- Test 4 should PASS (manual merge approach works)
- Test 5 reveals if d3-force honors fx/fy on graph recreation

### Implementation Plan (Once Verified)

1. **Phase 1**: Implement Approach 1 (fix on share)
2. **Phase 2**: Add console logging to verify capture
3. **Phase 3**: Test share URL generation
4. **Phase 4**: Test URL restoration
5. **Phase 5**: Remove debug logging

### ✅ Questions Answered - See TEST-RESULTS.md

- [x] ❌ Does `layout.simulation.nodes()` return actual position data? **NO - simulation not exposed**
- [x] ❌ Does setting `fx/fy` persist to G6's internal node data? **N/A - cannot access simulation**
- [x] ❌ Does `getNodeData()` include `fx/fy` after setting them? **NO - but includes style.x/y**
- [x] ✅ Does `getNodeData()` include position data? **YES - in node.style.x and node.style.y**
- [x] ⚠️ Does `setData()` respect `node.style.x/y` in node data? **NEEDS FOLLOW-UP TESTING**

**KEY FINDING**: G6 v5 does NOT expose `layout.simulation` - the d3-force simulation is internal. However, positions ARE accessible via `node.style.x` and `node.style.y` in the data returned by `graph.getNodeData()`. See `TEST-RESULTS.md` for full findings and revised implementation plan.

## References

- [G6 v5 Documentation](https://g6.antv.antgroup.com/)
- [d3-force Documentation](https://github.com/d3/d3-force)
- [d3-force Fixed Positions](https://github.com/d3/d3-force#simulation_nodes)
- G6 v5 TypeScript definitions: `node_modules/@antv/g6/lib/runtime/viewport.d.ts`

## Lessons Learned

1. **Don't assume APIs work** - test them first
2. **Add logging before changing logic** - understand what's happening
3. **Test incrementally** - verify each step works
4. **Read documentation** - but don't trust it completely for edge cases
5. **Create isolated tests** - don't debug in production code
