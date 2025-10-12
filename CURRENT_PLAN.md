# Graph Layout Implementation: Node Position Preservation

## Overview
Implement Phase 2 (Incremental Expansion) from research/graph-layout/README.md and improve Phase 1 (Investigation Sharing) to ensure perfect integration between shared investigations and incremental node expansion.

## Problem Statement
1. **Incremental Expansion**: When users expand nodes (double-click or "Expand Neighbors"), ALL nodes reposition, breaking the mental map
2. **Investigation Sharing**: Currently uses fixed layout which prevents effective dragging and expansion after loading

## Solution: Universal Node Pinning Strategy
Use d3-force's `fx`/`fy` properties to pin nodes in place while keeping the force layout active, enabling both position preservation AND interactive features (drag, expand).

---

## Changes Required

### 1. Modify `addData()` - Incremental Expansion (Phase 2)
**File**: `src/components/ShellView/ResultGraph.vue` (lines 1661-1666)

**Current Code:**
```javascript
const currentNodes = this.g6Graph.getNodeData() || [];
const currentEdges = this.g6Graph.getEdgeData() || [];
const newData = {
  nodes: currentNodes.concat(nodesToAdd),
  edges: currentEdges.concat(edgesToAdd),
};
```

**New Code:**
```javascript
const currentNodes = this.g6Graph.getNodeData() || [];
const currentEdges = this.g6Graph.getEdgeData() || [];

// PIN existing nodes at their current positions
const pinnedExistingNodes = currentNodes.map(node => ({
  ...node,
  data: {
    ...node.data,
    fx: node.style.x,  // Fix x position
    fy: node.style.y   // Fix y position
  }
}));

// New nodes don't have fx/fy, so force layout will position them
const newData = {
  nodes: pinnedExistingNodes.concat(nodesToAdd),
  edges: currentEdges.concat(edgesToAdd),
};
```

---

### 2. Improve `restoreInvestigationState()` - Investigation Sharing (Phase 1)
**File**: `src/components/ShellView/ResultGraph.vue` (around line 1997)

**Current Approach:**
- Uses `layout: { type: 'fixed' }` via `initializeEmptyGraph()`
- Nodes can't be dragged effectively
- Expansion doesn't work naturally

**New Approach:**
- Use d3-force layout with ALL nodes pinned at saved positions
- Enables dragging and expansion while preserving exact positions

**Change in `restoreInvestigationState()`:**
```javascript
// Around line 1997, replace the addData call
const nodesWithPins = state.graphData.nodes.map(node => ({
  ...node,
  data: {
    ...node.data,
    fx: node.data.x,  // Pin at saved position
    fy: node.data.y   // Pin at saved position
  }
}));

this.g6Graph.addData({
  nodes: nodesWithPins,  // ✅ Pinned nodes instead of unpinned
  edges: state.graphData.edges,
});
```

---

### 3. Update `initializeEmptyGraph()` - Remove Fixed Layout Strategy
**File**: `src/components/ShellView/ResultGraph.vue` (lines 691-716)

**Current:**
- Used only for investigation restoration
- May use fixed layout based on `isSharedInvestigation` flag

**Change:**
- Remove special fixed layout handling
- Always use d3-force layout (pinning will handle position preservation)
- Ensure `createGraphConfig()` is called with normal d3-force config

**OR** Update `graphConfig.js` if it has special `isSharedInvestigation` handling to remove fixed layout path.

---

### 4. Optional: Update `node:dragend` Handler
**File**: `src/components/ShellView/ResultGraph.vue` (lines 802-806)

**Current Workaround:**
```javascript
this.g6Graph.on('node:dragend', () => {
  const layout = this.g6Graph.getLayout();
  if (layout && layout.simulation) {
    layout.simulation.alpha(0.3).restart();  // Low energy to minimize drift
  }
});
```

**With Pinning:**
```javascript
this.g6Graph.on('node:dragend', () => {
  const layout = this.g6Graph.getLayout();
  if (layout && layout.simulation) {
    layout.simulation.alpha(1.0).restart();  // Full energy - pinned nodes can't drift
  }
});
```

---

### 5. Check `graphConfig.js` for Investigation Sharing Logic
**File**: `src/components/ShellView/graphConfig.js`

**Verify:**
- No `isSharedInvestigation` parameter that switches to fixed layout
- Research doc shows this pattern (lines 66-85 in research doc) but may not be implemented yet

**If found, remove:**
```javascript
// REMOVE this conditional if present:
layout: isSharedInvestigation
  ? { type: 'fixed' }
  : { type: 'd3-force', ... }
```

---

## Integration Flow

### Scenario 1: Initial Query (New Investigation)
1. Execute query → `drawGraph()` called
2. All nodes unpinned (no fx/fy)
3. Force layout positions everything naturally
4. ✅ Works as before

### Scenario 2: Load Shared Investigation
1. Load URL → `restoreInvestigationState()` called
2. All nodes pinned at saved x/y positions (fx/fy set)
3. Force layout runs but nodes stay fixed
4. User can drag nodes ✅
5. User can expand nodes → triggers Scenario 3 ✅

### Scenario 3: Expand Node (Incremental)
1. Double-click or "Expand Neighbors" → `addData()` called
2. Existing nodes pinned at current positions
3. New nodes added without fx/fy
4. Force layout positions new nodes around pinned ones
5. Existing nodes never move ✅
6. Mental map preserved ✅

### Scenario 4: Drag Node
1. User drags node → G6 temporarily sets fx/fy during drag
2. On release → `node:dragend` fires, alpha restarts
3. Pinned nodes stay fixed, unpinned nodes adjust slightly
4. ✅ Works naturally

---

## Testing Strategy

### Manual Testing
1. **Incremental Expansion**
   - Execute initial query
   - Double-click node → verify existing nodes don't move
   - Expand multiple times → verify cumulative stability
   - Try with "Expand Graph" button

2. **Investigation Sharing**
   - Generate share URL from multi-hop exploration
   - Load in new tab → verify positions match exactly
   - Drag a node → verify it moves smoothly
   - Expand a node → verify existing stay fixed, new ones position naturally

3. **Performance**
   - Test with graphs of 50, 100, 200+ nodes
   - Monitor render times
   - Check force layout convergence speed

### Reference Test
- `public/test-incremental-force-layout.html` validates the pinning strategy

---

## Benefits

### Phase 1 (Investigation Sharing) Improvements
- ✅ Perfect position preservation (0.75px drift maintained)
- ✅ Users CAN drag nodes after loading
- ✅ Users CAN expand nodes after loading
- ✅ Fully interactive shared investigations

### Phase 2 (Incremental Expansion)
- ✅ Existing nodes stay fixed during expansion
- ✅ Mental map preserved
- ✅ Better performance (O(new) vs O(all))
- ✅ Scales to large graphs
- ✅ Natural layout for new nodes

### Combined Benefits
- ✅ Seamless integration between sharing and expansion
- ✅ Consistent pinning strategy across all scenarios
- ✅ Simpler code (may eliminate alpha=0.3 workaround)

---

## Implementation Steps

1. ✅ Write this plan to `CURRENT_PLAN.md`
2. Modify `addData()` to pin existing nodes
3. Modify `restoreInvestigationState()` to pin loaded nodes
4. Check/update `graphConfig.js` if needed
5. Optionally update `node:dragend` alpha
6. Test all scenarios
7. Update research doc to mark Phase 2 as complete
