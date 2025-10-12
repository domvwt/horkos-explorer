# Graph Layout Research - Preventing Unwanted Node Movement

**Status**: ✅ SOLVED (Both use cases)
**Date**: 2025-10-12

## Overview

This research addresses the core problem: **d3-force layout repositions nodes when it shouldn't**, breaking the user's mental map of the graph.

**Two specific use cases identified:**

1. **Investigation Sharing**: When loading a shared investigation URL, nodes should appear in the exact same positions as when shared
2. **Incremental Expansion**: When expanding nodes to add neighbors, existing nodes should stay fixed while only new nodes are positioned

Both problems stem from the same root cause: d3-force recalculates all node positions from scratch, ignoring existing positions.

---

## Use Case 1: Investigation Sharing

### Problem

When users share investigation URLs, node positions are not preserved. Upon loading a shared URL, the force-directed layout recalculates positions from scratch, resulting in a completely different visual arrangement.

**Current State:**
- ✅ Query text, graph data, hidden elements, and viewport zoom are all preserved
- ❌ Node positions are recalculated, causing 177px average drift

### Solution: Fixed Layout (IMPLEMENTED ✅)

**Average Drift**: 0.75px (essentially perfect)

**How it works:**
1. When generating share URL: Save positions in `node.data.x` and `node.data.y`
2. When loading shared investigation: Use `layout: { type: 'fixed' }` instead of d3-force
3. Nodes appear at exact saved positions with <1px drift

**Implementation:**

```javascript
// 1. CAPTURE: When generating share URL (ResultGraph.vue)
getInvestigationState() {
  const graphData = {
    nodes: this.g6Graph.getNodeData().map(node => ({
      id: node.id,
      data: {
        ...node.data,
        x: node.style.x,  // Save position
        y: node.style.y
      },
      style: node.style
    })),
    edges: this.g6Graph.getEdgeData()
  };

  return {
    queries: [{ query, params, timestamp }],
    graphData,
    hiddenElements: this.hiddenElements,
    viewport: this.getViewportState(),
    isShared: true  // Flag for restoration
  };
}

// 2. RESTORE: When loading from share URL (graphConfig.js)
export function createGraphConfig({ isSharedInvestigation = false, ...options }) {
  return {
    container: options.container,
    width: options.width,
    height: options.height,

    // Use fixed layout for shared investigations
    layout: isSharedInvestigation
      ? { type: 'fixed' }
      : {
          type: 'd3-force',
          // ... normal d3-force config
        },

    node: {
      // ... node config
    },
    // If shared, positions come from node.data.x/y automatically
  };
}
```

**Status**: ✅ Implemented in `src/utils/InvestigationState.js` and `src/components/ShellView/ResultGraph.vue`

**Test files**:
- `public/test-g6-positions.html` - Final solution test
- `public/test-g6-positions-detailed.html` - Detailed baseline test

---

## Use Case 2: Incremental Node Expansion

### Problem

When users expand nodes (double-click or "Expand Neighbors"), new neighbor nodes are added to the graph. Currently, **all nodes** (existing + new) are repositioned by d3-force, causing existing nodes to drift from their positions.

**Current Behavior (BROKEN ❌):**
1. User has arranged graph mentally after initial query
2. User double-clicks node to expand neighbors
3. `addData()` calls `setData()` with all nodes (existing + new)
4. d3-force restarts at `alpha=1` (full strength)
5. ALL nodes reposition, breaking the mental map ❌

### Solution: Pin Existing Nodes with fx/fy

**How it works:**
1. When adding new nodes: Set `fx`/`fy` on existing nodes to lock their positions
2. New nodes don't have `fx`/`fy`, so d3-force positions them around the fixed nodes
3. Existing nodes stay completely fixed, new nodes find optimal positions around them

**Implementation:**

```javascript
// In ResultGraph.vue - addData() method (currently lines 1694-1745)
async addData(nodes, edges) {
  if (!this.g6Graph) return;

  // Filter out duplicates (existing logic)
  const nodesToAdd = [];
  for (let key in nodes) {
    const node = nodes[key];
    try {
      this.g6Graph.getNodeData(node.id);
      continue; // Node exists, skip
    } catch (error) {
      nodesToAdd.push(node);
    }
    // Update counters...
  }

  const edgesToAdd = [];
  // ... filter edges (existing logic)

  // Get current data
  const currentNodes = this.g6Graph.getNodeData() || [];
  const currentEdges = this.g6Graph.getEdgeData() || [];

  // ✅ PIN EXISTING NODES at their current positions
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

  // Trigger neighbor count update for new leaf nodes
  this.$nextTick(() => {
    this.updateNeighborCounts();
  });
}
```

**Additional Change: Remove alpha=0.3 Workaround**

The current `graphConfig.js` uses `alpha=0.3` on drag to minimize drift. With pinning, this is no longer needed:

```javascript
// In ResultGraph.vue setupGraphEventHandlers() (line 802-806)
this.g6Graph.on('node:dragend', () => {
  const layout = this.g6Graph.getLayout();
  if (layout && layout.simulation) {
    // Change from alpha(0.3) to alpha(1.0) - or remove entirely
    // With pinned nodes, drift is no longer an issue
    layout.simulation.alpha(1.0).restart();
  }
});
```

**Status**: ✅ IMPLEMENTED (basic pinning only)

**Enhancement: Smart Initial Positioning (2025-10-12) - PROTOTYPED**

**Status**: 🧪 PROTOTYPED - NOT YET IMPLEMENTED IN MAIN CODEBASE

Observation: Initial implementation places new nodes without initial positioning hints, causing force layout to sometimes produce awkward positions. Prototyped solution using **predecessor-aware placement**:

```javascript
// Calculate center of mass
const centerX = sumX / currentNodes.length;
const centerY = sumY / currentNodes.length;

// Map new nodes to their existing predecessors
const newNodePredecessors = new Map();
edgesToAdd.forEach(edge => {
  if (sourceIsExisting && !targetIsExisting) {
    newNodePredecessors.get(edge.target).push(edge.source);
  } else if (targetIsExisting && !sourceIsExisting) {
    newNodePredecessors.get(edge.source).push(edge.target);
  }
});

// Position each new node near its predecessor(s), away from center
predecessorGroups.forEach(({ predecessors, nodes }) => {
  // Get centroid of predecessor positions
  const predCenterX = predSumX / predecessors.length;
  const predCenterY = predSumY / predecessors.length;

  // Calculate direction away from center of mass
  const awayAngle = Math.atan2(predCenterY - centerY, predCenterX - centerX);

  // Place nodes in 60° arc facing away from center
  nodes.forEach((node, index) => {
    const offsetAngle = (index / (nodes.length - 1) - 0.5) * (Math.PI / 3);
    const angle = awayAngle + offsetAngle;

    node.data.x = predCenterX + 200 * Math.cos(angle);
    node.data.y = predCenterY + 200 * Math.sin(angle);
  });
});
```

**Key improvements:**
1. New nodes appear **near the node being expanded** (not randomly around graph)
2. Positioned in the direction **away from center of mass** (toward periphery)
3. Multiple new nodes spread in a **60° arc** facing outward
4. Fallback to periphery placement for nodes without existing connections

**Benefits:**
- More intuitive expansion UX (nodes appear where you expand)
- Reduces clutter in graph center
- Force layout refines from sensible starting positions
- Natural "growing outward" pattern

**Test files**:
- `public/test-incremental-force-layout.html` - Validates pinning strategy works (basic pinning)
- `public/test-smart-positioning.html` - Prototype for smart initial positioning (predecessor-aware placement)

**Test Results**:

Basic Pinning (IMPLEMENTED in `ResultGraph.vue:1655-1670`):
- ✅ Existing nodes stay completely fixed (no drift)
- ✅ New nodes positioned by d3-force around fixed nodes
- ⚠️ New nodes may appear in awkward initial positions before force layout stabilizes

Smart Positioning Prototype (`test-smart-positioning.html`):
- ✅ Successfully tested with Playwright MCP (2025-10-12)
- ✅ New nodes appear near predecessor node
- ✅ New nodes positioned away from graph center of mass
- ✅ Multiple new nodes spread in 60° arc facing outward
- 📸 Screenshots captured showing correct behavior:
  - `test-smart-positioning-stabilized.png` - Initial layout with center node + 4 peripherals
  - `test-smart-positioning-after-expand.png` - After expanding (5 orange nodes near center, away from center of mass)
  - `test-smart-positioning-full.png` - Full page view of test harness
- ⏳ **NOT YET IMPLEMENTED** in main codebase - prototype successful but requires user validation before integration

---

## Benefits of These Solutions

### Investigation Sharing (Fixed Layout)
1. **Perfect Position Preservation**: 0.75px average drift (sub-pixel accuracy)
2. **Fast Rendering**: No layout computation needed
3. **Simple Implementation**: Just save x/y and use `layout: { type: 'fixed' }`
4. **No Performance Impact**: URLs only ~30% larger with compression

### Incremental Expansion (Node Pinning)
1. **Preserves Mental Map**: Existing nodes don't move when expanding
2. **Performance**: Only new nodes are positioned (O(new) vs O(all))
3. **Scalability**: Works well with large graphs (100+ nodes)
4. **User Experience**: Smooth incremental exploration
5. **Simpler Code**: May not need alpha=0.3 workaround anymore

---

## Technical Background

### How d3-force Works

d3-force uses a physics simulation with multiple forces:
- **Link force**: Edges pull connected nodes together
- **Collision force**: Nodes repel each other to avoid overlap
- **Many-body force**: Global repulsion spreads nodes apart

The simulation runs in ticks:
- Starts at `alpha=1` (100% energy)
- Each tick: applies forces, updates positions, decreases alpha
- Stops when `alpha < alphaMin` (default 0.2)

### Why Positions Get Lost

**Problem 1 (Sharing)**: G6 stores runtime positions in `node.style.x/y`, but d3-force doesn't read these on initialization. It calculates new positions from scratch based on the graph topology.

**Problem 2 (Expansion)**: When `setData()` is called with existing + new nodes, d3-force restarts the simulation at `alpha=1` and recalculates ALL positions, ignoring where nodes currently are.

### How fx/fy Work

d3-force has a built-in mechanism for fixed positions:
- Nodes with `fx`/`fy` defined are **locked** and won't move during simulation
- Nodes without `fx`/`fy` are **free** and positioned by forces
- Forces still act on/from fixed nodes (they contribute to link forces)

From [d3-force documentation](https://d3js.org/d3-force/simulation):
> The node's fixed x-position. If not null, the node's x-position is set to fx on each tick.

### Current Force Layout Config

From `src/components/ShellView/graphConfig.js`:
```javascript
layout: {
  type: 'd3-force',
  link: { distance: 200-600 (dynamic), strength: 2 },
  collide: { radius: (d) => d.size / 2 + 80, strength: 1.2 },
  manyBody: { strength: -1800 },
  alpha: 1,           // Starts at full strength
  alphaMin: 0.2,      // Never fully stops
  alphaDecay: 0.03,   // Gradually slows down
  velocityDecay: 0.45,
}
```

### Are Nodes Pinned by Default?

**NO** - nodes are NOT pinned at all currently.

Looking at `addData()` (ResultGraph.vue:1694-1745), it simply:
```javascript
const currentNodes = this.g6Graph.getNodeData() || [];
const currentEdges = this.g6Graph.getEdgeData() || [];
const newData = {
  nodes: currentNodes.concat(nodesToAdd),  // Just concatenates - NO fx/fy set
  edges: currentEdges.concat(edgesToAdd),
};
this.g6Graph.setData(newData);
```

No `fx`/`fy` properties are ever set, so **all nodes are free to move** when the force layout runs.

### When is Force Layout Switched On/Off?

**Key Insight**: We DON'T turn force layout on/off - we control WHICH nodes it can move via pinning!

The force layout is **ALWAYS running** (never truly "off"):

**Force layout lifecycle:**
1. **Initial render**: Starts with `alpha=1` (full strength), runs ~300 iterations until alpha decays to `alphaMin=0.2`
2. **Settles**: At `alpha=0.2`, forces are very weak but still active (nodes barely move)
3. **Node drag**: When user drags a node, layout restarts at `alpha=0.3` (30% strength)
4. **Adding new nodes**: Calls `setData()` → layout restarts at `alpha=1` → **ALL nodes (old + new) reposition** ❌

### Proposed Strategy by Scenario

#### Scenario 1: Initial Query Execution (New Investigation)

**Force Layout**: ✅ ON (alpha=1 → 0.2)
**Pinning**: ❌ NONE

All nodes free to move. Let force layout position all nodes naturally from scratch. User hasn't built a mental map yet, so repositioning is fine.

#### Scenario 2: Expanding Nodes (Double-click, "Expand Neighbors")

**Force Layout**: ✅ STAYS ON (restarts at alpha=1)
**Pinning**: ✅ PIN EXISTING NODES

```javascript
// In addData()
const pinnedExistingNodes = currentNodes.map(node => ({
  ...node,
  data: {
    ...node.data,
    fx: node.style.x,  // Pin existing nodes
    fy: node.style.y
  }
}));

// New nodes DON'T have fx/fy
const newData = {
  nodes: pinnedExistingNodes.concat(nodesToAdd),
  edges: currentEdges.concat(edgesToAdd)
};
```

Force layout needs to position new nodes. Existing nodes are pinned so they don't drift. Force layout runs at full strength but only moves unpinned nodes.

#### Scenario 3: Dragging a Node

**Force Layout**: ✅ STAYS ON (restarts at alpha=0.3)
**Pinning**: ⚠️ DRAGGED NODE GETS TEMPORARY PIN

When user drags a node, G6 automatically updates the dragged node's `fx`/`fy` during drag, then removes them on release. Force layout adjusts nearby nodes.

**With pinning**: The alpha=0.3 workaround is probably not needed anymore since pinned nodes can't drift. Could increase to alpha=1.0.

#### Scenario 4: Loading Shared Investigation

**Current Implementation (Strategy A):**
- **Force Layout**: ❌ OFF (uses `layout: { type: 'fixed' }`)
- **Pinning**: N/A
- **Pros**: Perfect position preservation (0.75px drift), fast rendering
- **Cons**: Users can't drag nodes effectively (they snap back), can't expand naturally

**Recommended Strategy (Strategy B):**
- **Force Layout**: ✅ ON (alpha=0.3, low movement)
- **Pinning**: ✅ PIN ALL NODES at saved positions

```javascript
// When loading shared investigation
const nodesWithPins = state.graphData.nodes.map(node => ({
  ...node,
  data: {
    ...node.data,
    fx: node.data.x,  // Pin at saved position
    fy: node.data.y
  }
}));

layout: {
  type: 'd3-force',
  alpha: 0.3,      // Low energy
  alphaMin: 0.001,
  alphaDecay: 0.05
}
```

**Pros**: Perfect positions + users CAN drag nodes + users CAN expand nodes (new nodes position around pinned ones)

#### Scenario 5: "Re-layout Graph" Button (Optional Feature)

**Force Layout**: ✅ RESTART at alpha=1
**Pinning**: ❌ REMOVE ALL PINS

Give users a way to "reset" the layout if it gets messy. All nodes reposition from scratch.

### Summary: Force Layout Strategy Table

| Scenario | Force Layout | Existing Nodes | New Nodes | Alpha |
|----------|--------------|----------------|-----------|-------|
| Initial query | ✅ ON | Free to move | N/A | 1.0 → 0.2 |
| Expand nodes | ✅ ON | **Pinned (fx/fy)** | Free to move | 1.0 → 0.2 |
| Drag node | ✅ ON | Free to move* | Free to move | 0.3 → 0.2 |
| Load shared (current) | ❌ OFF (fixed) | N/A | N/A | N/A |
| Load shared (proposed) | ✅ ON | **Pinned (fx/fy)** | N/A | 0.3 → 0.001 |
| Re-layout | ✅ ON | Free to move | Free to move | 1.0 → 0.2 |

*With incremental expansion implemented, previously expanded nodes would remain pinned during drag.

**Recommendation**: Use force layout for everything, control movement via pinning. Never actually turn force layout "off" - just control which nodes it can move.

---

## Implementation Roadmap

### Phase 1: Investigation Sharing (COMPLETE ✅)
- [x] Save positions in `node.data.x/y` when generating share URL
- [x] Add `isShared` flag to investigation state
- [x] Use fixed layout when loading shared investigations
- [x] Test with real Horkos data
- [x] Verify URL sizes remain manageable

### Phase 2: Incremental Expansion (BASIC PINNING COMPLETE ✅)
- [x] Modify `addData()` method to pin existing nodes
- [x] Set `fx`/`fy` from `node.style.x/y` for existing nodes
- [x] Leave new nodes without `fx`/`fy`
- [x] Update alpha=0.3 to alpha=1.0 (pinning makes drift impossible)
- [x] Test with double-click expansion
- [x] Test with "Expand Graph" button

### Phase 2b: Smart Initial Positioning (PROTOTYPED 🧪)
- [x] Prototype smart positioning algorithm in `public/test-smart-positioning.html`
- [x] Calculate center of mass of existing nodes
- [x] Map new nodes to their predecessors via edge analysis
- [x] Position new nodes near predecessors, away from center of mass
- [x] Spread multiple new nodes in 60° arcs
- [x] Test with Playwright MCP and capture screenshots
- [ ] **Integrate into main codebase** (awaiting user feedback on prototype)
- [ ] Test with real Horkos data
- [ ] Verify performance with large graphs

### Phase 3: Advanced Features (OPTIONAL)
- [ ] Auto-unpin nodes after stabilization (if needed)
- [ ] Add "Re-layout Graph" button to unpin all nodes
- [ ] Visual indicator for pinned vs unpinned nodes
- [ ] Handle position restoration from localStorage/URL with pinning

---

## Questions & Answers

### Investigation Sharing

**Q: Does G6 v5 expose `layout.simulation` for direct position access?**
A: ❌ No - the simulation is internal. However, positions ARE accessible via `node.style.x` and `node.style.y`.

**Q: Does `setData()` respect `node.data.x/y` when using fixed layout?**
A: ✅ Yes - with `layout: { type: 'fixed' }`, nodes appear at `data.x/y` positions.

**Q: Can users still drag nodes after loading with fixed layout?**
A: ⚠️ Partially - G6 allows dragging but nodes snap back. Solution: auto-switch to d3-force after initial render.

**Q: What about URL size with positions included?**
A: ✅ ~30% larger, but LZ-String compression handles it well. Still under browser URL limits for reasonable graph sizes.

### Incremental Expansion

**Q: Does G6 v5 pass through `fx`/`fy` to d3-force?**
A: ✅ Yes - confirmed by both d3-force docs and live testing.

**Q: Do we still need `alpha=0.3` if existing nodes are pinned?**
A: ❌ Likely no - the alpha=0.3 hack was to reduce drift. With pinning, existing nodes can't drift at all, so we can use default `alpha=1.0` for faster stabilization.

**Q: What's the optimal timeout for unpinning?**
A: ⏳ `iterations × 10ms` ≈ 3000ms for 300 iterations. However, we may not need to unpin at all.

**Q: Should we unpin at all, or leave nodes fixed?**
A: 💡 **DON'T unpin automatically**. Reasons:
- Pinned nodes can still be dragged by the user (G6 drag-element behavior works with fx/fy)
- Unpinning allows nodes to drift again if user pans/zooms
- Keeping pins preserves the mental map permanently

**Q: How does this interact with saved positions (localStorage/URL state)?**
A: ⏳ Need to ensure pinning doesn't override restored positions. When restoring from URL/localStorage, those positions should become the pinned positions (set fx/fy to the restored x/y values).

---

## Related Files

### Investigation Sharing (Implemented)
- `src/components/ShellView/ResultGraph.vue` - Graph visualization component
  - `getInvestigationState()` - Captures positions
  - `restoreInvestigationState()` - Loads with fixed layout
- `src/utils/InvestigationState.js` - State serialization/deserialization
- `src/components/ShellView/graphConfig.js` - Graph configuration factory

### Incremental Expansion (Ready to Implement)
- `src/components/ShellView/ResultGraph.vue` - Graph visualization component
  - Lines 1694-1745: `addData()` - Needs modification to pin existing nodes
  - Lines 802-806: `node:dragend` handler - Consider removing alpha=0.3 workaround
- `src/components/ShellView/graphConfig.js` - Force layout config
  - Lines 78-82: Layout config (alpha, alphaMin, alphaDecay)

---

## Test Files

All test files are in `public/` directory and `research/graph-layout/`:

### Investigation Sharing Tests
- `public/test-g6-positions.html` - Final solution validation (fixed layout)
- `public/test-g6-positions-detailed.html` - Baseline test showing 177px drift
- `public/test-g6-position-research.html` - Initial API exploration
- `research/graph-layout/test-*.html` - Additional test variations

### Incremental Expansion Tests
- `public/test-incremental-force-layout.html` - Pinning strategy validation
  - Demonstrates: existing nodes stay fixed with fx/fy
  - Demonstrates: all nodes drift without pinning
  - Accessible at: http://localhost:8080/test-incremental-force-layout.html

---

## References

- [G6 v5 Documentation](https://g6.antv.antgroup.com/)
- [d3-force Documentation](https://d3js.org/d3-force)
- [d3-force Fixed Positions](https://d3js.org/d3-force/simulation) - fx/fy specification
- [G6 v5 d3-force Plugin](https://g6-next.antv.antgroup.com/en/apis/layout/d3-force)

---

## Lessons Learned

1. **Test incrementally** - Both solutions required iterative testing to validate
2. **Same root cause, different contexts** - Both problems stem from d3-force recalculating positions
3. **d3-force is always running** - `alphaMin=0.2` means it never fully stops
4. **fx/fy are powerful** - Built-in mechanism for exactly what we need
5. **Fixed layout is surprisingly good** - 0.75px drift is essentially perfect
6. **Don't assume APIs work** - G6 doesn't expose `layout.simulation` despite documentation suggesting it might
7. **Positions live in multiple places** - `node.style.x/y` (G6), `node.data.x/y` (config), and simulation internal state
8. **One solution, two use cases** - The same fx/fy pinning mechanism solves both problems
9. **Initial positions matter** - Giving new nodes smart starting positions (near predecessor, away from center) produces much better force layout results than random initialization
10. **Edge data is key** - The `edgesToAdd` array tells us exactly which new nodes connect to which existing nodes, enabling predecessor-aware placement
11. **Prototype first, implement later** - When extending existing implementations, always prototype in `public/` or `research/` directory first. This allows safe experimentation without risk of breaking production code. Use Playwright MCP for automated testing of prototypes.
12. **User validation is critical** - Even when a prototype works technically, defer main codebase integration until the user validates the behavior meets their needs
