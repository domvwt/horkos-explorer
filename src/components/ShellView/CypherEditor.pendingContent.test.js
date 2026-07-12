import { describe, it, expect } from "vitest";

// The pending-content buffer that lives inline in CypherEditor.vue. Monaco is
// loaded via dynamic import(), so the editor instance is created only after
// the chunk resolves; an external write in that window (the startup demo-cell
// or history load in ShellMainView.mounted) used to hit a null editor. The
// buffer stashes the latest write on the instance and initMonacoEditor flushes
// it through the same setEditorContent path right after Monaco.editor.create.
//
// The repo's vitest runs in the `node` environment with no Vue SFC
// compilation (see ResultGraph.edgeIntegrity.test.js for the same pattern),
// so this locks the buffer's SEMANTICS with a reference implementation that
// mirrors the inline code exactly. If setEditorContent or the flush block in
// initMonacoEditor changes, this reference must change with it.
function makeEditorHarness() {
  return {
    editor: null,
    pendingEditorContent: undefined,
    isUnmounted: false,
    refExists: true,
    // Mirrors CypherEditor.setEditorContent.
    setEditorContent(content) {
      if (!this.editor) {
        this.pendingEditorContent = content;
        return;
      }
      this.editor.setValue(content);
    },
    // Mirrors the async shape of CypherEditor.initMonacoEditor: the await is
    // the dynamic-import boundary, then the unmount/ref bail, then editor
    // creation, then the pending flush.
    async initMonacoEditor() {
      await Promise.resolve();
      if (this.isUnmounted || !this.refExists) {
        return;
      }
      this.editor = {
        value: undefined,
        setValue(v) {
          this.value = v;
        },
        getValue() {
          return this.value;
        },
      };
      if (this.pendingEditorContent !== undefined) {
        const pending = this.pendingEditorContent;
        this.pendingEditorContent = undefined;
        this.setEditorContent(pending);
      }
    },
  };
}

describe("CypherEditor pending-content buffer", () => {
  it("buffers a write that arrives before the editor exists", () => {
    const harness = makeEditorHarness();
    harness.setEditorContent("MATCH (n) RETURN n");
    expect(harness.editor).toBeNull();
    expect(harness.pendingEditorContent).toBe("MATCH (n) RETURN n");
  });

  it("flushes the buffered write once init completes, then clears it", async () => {
    const harness = makeEditorHarness();
    harness.setEditorContent("MATCH (n) RETURN n");
    await harness.initMonacoEditor();
    expect(harness.editor.getValue()).toBe("MATCH (n) RETURN n");
    expect(harness.pendingEditorContent).toBeUndefined();
  });

  it("applies a buffered empty string (undefined sentinel, not truthiness)", async () => {
    const harness = makeEditorHarness();
    harness.setEditorContent("");
    await harness.initMonacoEditor();
    expect(harness.editor.getValue()).toBe("");
  });

  it("keeps only the latest of several pre-init writes", async () => {
    const harness = makeEditorHarness();
    harness.setEditorContent("first");
    harness.setEditorContent("second");
    await harness.initMonacoEditor();
    expect(harness.editor.getValue()).toBe("second");
  });

  it("writes straight through once the editor exists", async () => {
    const harness = makeEditorHarness();
    await harness.initMonacoEditor();
    harness.setEditorContent("direct");
    expect(harness.editor.getValue()).toBe("direct");
    expect(harness.pendingEditorContent).toBeUndefined();
  });

  it("drops a pending write when the component unmounts before the chunk lands", async () => {
    const harness = makeEditorHarness();
    harness.setEditorContent("never applied");
    harness.isUnmounted = true;
    await harness.initMonacoEditor();
    expect(harness.editor).toBeNull();
  });
});
