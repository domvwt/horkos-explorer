# G6 Position Persistence Test Results

**Date**: 2025-10-12
**Test File**: `/public/test-g6-position-research.html`
**G6 Version**: 5.0.49

## Executive Summary

**CRITICAL FINDING**: G6 v5's d3-force layout **does NOT expose** `layout.simulation` object. The original research assumptions were incorrect.

**GOOD NEWS**: Positions **ARE accessible** via `node.style.x` and `node.style.y` in the node data returned by `graph.getNodeData()`.

## Test Results

### Test 1: Access d3-force Simulation ❌ FAILED

**Attempted**: `graph.getLayout().simulation.nodes()`

**Result**: `layout.simulation is undefined`

**Available properties on layout object**:
- `type` (string)
- `link` (object)
- `collide` (object)
- `manyBody` (object)
- `alpha` (number)
- `alphaMin` (number)
- `alphaDecay` (number)
- `velocityDecay` (number)

**Conclusion**: The d3-force simulation is internal to G6 v5 and not exposed via the public API. We cannot directly access or manipulate `fx`/`fy` on simulation nodes.

### Test 2: Set fx/fy on Simulation ❌ FAILED

**Reason**: Cannot proceed without access to `layout.simulation.nodes()`

### Test 3: Check if getNodeData() Includes fx/fy ❌ FAILED (but see note)

**Result**: `fx`/`fy` properties are NOT present in node data.

**HOWEVER**: Positions ARE present in `node.style.x` and `node.style.y`!

**Example node data structure**:
```json
{
  "id": "person_1",
  "data": {
    "label": "John Smith",
    "type": "Person",
    "size": 50,
    "birth_year": 1975
  },
  "style": {
    "zIndex": 0,
    "x": 500.0838292930137,
    "y": 178.0595237786037,
    "z": 0
  }
}
```

**Conclusion**: G6 v5 stores positions in `node.style.x/y`, not `node.data.fx/fy`. This is actually better for our use case!

### Test 4: Manual Merge Positions ❌ FAILED

**Reason**: Cannot access simulation nodes to merge positions.

### Test 5: Recreate Graph with Fixed Positions ⏭️ SKIPPED

**Reason**: Depends on Test 4 passing.

## Key Findings

### 1. Position Data is Already Accessible ✅

G6 v5 automatically stores computed positions in `node.style.x` and `node.style.y`. This means:

- ✅ We can read positions with `graph.getNodeData()`
- ✅ Positions are already part of the node data structure
- ✅ No need to access internal d3-force simulation

### 2. d3-force Simulation is Private ❌

G6 v5 does not expose the d3-force simulation object. This means:

- ❌ Cannot set `fx`/`fy` directly on simulation nodes
- ❌ Cannot call `simulation.nodes()` to read/write positions
- ❌ Original research approach (manipulating simulation) won't work

### 3. Alternative Approach Required ⚠️

Since we can't use `fx`/`fy` to fix nodes, we need a different strategy:

**Option A: Use style.x and style.y as initial positions**
- Serialize `node.style.x/y` from shared graph
- Pass them as initial positions when recreating graph
- Let d3-force run from those starting points

**Option B: Switch to fixed layout**
- Use G6's `force` or `fixed` layout instead of `d3-force`
- Positions are fully controlled, no simulation drift

**Option C: Pin nodes after layout stabilizes**
- Research if G6 v5 has node pinning/fixing API
- May require diving into G6 source code

## Recommended Implementation

### Phase 1: Serialize with Current Positions ✅

```javascript
// In shareInvestigation()
function captureGraphState(graph) {
  const nodes = graph.getNodeData();
  const edges = graph.getEdgeData();

  // Positions are already in node.style.x and node.style.y!
  return { nodes, edges };
}
```

### Phase 2: Restore with style.x/y as Initial Positions ⚠️

```javascript
// When loading shared investigation
function restoreGraphState(graphData) {
  // Pass node data with style.x/y preserved
  graph.setData(graphData);
  graph.render();

  // QUESTION: Does G6 respect style.x/y as initial positions?
  // Or does d3-force override them immediately?
}
```

### Phase 3: Test Position Preservation 🔬

**Need to verify**:
1. Does `setData()` respect `node.style.x/y` values?
2. Does d3-force layout use them as starting positions?
3. How much drift occurs after layout stabilizes?

**If drift is minimal (<50px)**: Acceptable for investigation sharing
**If drift is large (>200px)**: Need Option B (fixed layout) or Option C (pinning API)

## Next Steps

### 1. Create Position Preservation Test

Create a new test file that:
- Captures `node.style.x/y` from a rendered graph
- Destroys the graph
- Creates new graph with captured positions in initial data
- Measures position drift after layout stabilization

### 2. Research G6 v5 Node Pinning

Check G6 v5 documentation and source code for:
- Node fixing/pinning API
- `node.style.fx/fy` properties
- Layout configuration to disable simulation after init
- Event hooks to freeze nodes after layout completes

### 3. Evaluate Layout Alternatives

If d3-force doesn't preserve positions well:
- Test `force` layout (G6's custom force-directed)
- Test `fixed` layout (no automatic positioning)
- Test `d3-force` with very low alpha/alphaDecay

## Code Changes Required

### Update `src/components/ShellView/ResultGraph.vue`

```javascript
// Method to capture current positions
captureNodePositions() {
  if (!this.graph) return null;

  const nodes = this.graph.getNodeData();
  const edges = this.graph.getEdgeData();

  // Positions are already in node.style.x/y
  return {
    nodes: nodes.map(n => ({
      id: n.id,
      data: n.data,
      style: {
        x: n.style.x,
        y: n.style.y
      }
    })),
    edges: edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      data: e.data
    }))
  };
}

// Method to restore positions
restoreGraphWithPositions(graphData) {
  // Create graph config with graphData that includes style.x/y
  this.createGraph(graphData);

  // TODO: Test if positions are preserved or need fixing
}
```

## Conclusion

The original research assumption (manipulating d3-force simulation directly) is not possible with G6 v5's public API. However, G6 already stores positions in an accessible format (`node.style.x/y`), which provides a simpler path forward.

**Next action**: Create a follow-up test to measure position drift when recreating graphs with `style.x/y` pre-populated.
