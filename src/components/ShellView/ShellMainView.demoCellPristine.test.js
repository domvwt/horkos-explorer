import { describe, it, expect } from "vitest";

// The demo-cell pristine check that lives inline in ShellMainView.vue
// (getDemoCellText + upgradeDemoCell). Monaco is loaded on demand (see
// MonacoLoader.js), so the schema-arrival upgrade in upgradeDemoCell can run
// before CypherEditor's editor instance exists yet: the initial demo query
// written by loadDemoCell()/writeDemoCell() may still be sitting in
// CypherEditor's non-reactive `pendingEditorContent` buffer (see
// CypherEditor.pendingContent.test.js) rather than in a live Monaco model.
// getDemoCellText must consult that buffer when the editor isn't up yet, or
// the pristine check always sees null, treats the cell as "unreadable", and
// finalizes without ever applying the schema-derived upgrade.
//
// ShellMainView.vue is a large SFC that vitest does not compile (see
// ResultGraph.edgeIntegrity.test.js for the same repo-wide pattern), so this
// locks the check's SEMANTICS with a reference implementation that mirrors
// the inline code exactly. If getDemoCellText or upgradeDemoCell changes,
// this reference must change with it.
function makeShellHarness() {
  return {
    demoCellQuery: "",
    isDemoCellFinalized: false,
    cypherEditor: {
      editor: null,
      pendingEditorContent: undefined,
    },
    // Mirrors ShellMainView.getDemoCellText.
    getDemoCellText() {
      const cypherEditor = this.cypherEditor;
      if (!cypherEditor) {
        return null;
      }
      if (cypherEditor.editor) {
        return cypherEditor.editor.getValue();
      }
      return cypherEditor.pendingEditorContent !== undefined ? cypherEditor.pendingEditorContent : null;
    },
    // Mirrors ShellMainView.writeDemoCell, minus the hasSchemaForDemo() gate
    // (tests below drive isDemoCellFinalized explicitly).
    writeDemoCell(query) {
      // loadEditorFromHistory -> CypherEditor.setEditorContent: buffers when
      // no live editor exists yet, writes straight through otherwise.
      if (this.cypherEditor.editor) {
        this.cypherEditor.editor.setValue(query);
      } else {
        this.cypherEditor.pendingEditorContent = query;
      }
      this.demoCellQuery = query;
    },
    // Mirrors ShellMainView.upgradeDemoCell.
    upgradeDemoCell(nextQuery) {
      const current = this.getDemoCellText();
      const isPristine = current !== null && current === this.demoCellQuery;
      if (isPristine) {
        this.writeDemoCell(nextQuery);
      } else {
        this.isDemoCellFinalized = true;
      }
    },
    // Simulates CypherEditor.initMonacoEditor's flush of the pending buffer.
    createEditor() {
      this.cypherEditor.editor = {
        value: undefined,
        setValue(v) {
          this.value = v;
        },
        getValue() {
          return this.value;
        },
      };
      if (this.cypherEditor.pendingEditorContent !== undefined) {
        const pending = this.cypherEditor.pendingEditorContent;
        this.cypherEditor.pendingEditorContent = undefined;
        this.cypherEditor.editor.setValue(pending);
      }
    },
  };
}

describe("ShellMainView demo-cell pristine check", () => {
  it("reads the buffered fallback query when the editor has not been created yet", () => {
    const harness = makeShellHarness();
    harness.writeDemoCell("MATCH (n) RETURN n LIMIT 5;");

    expect(harness.cypherEditor.editor).toBeNull();
    expect(harness.getDemoCellText()).toBe("MATCH (n) RETURN n LIMIT 5;");
  });

  it("upgrades the pre-create buffer once a real schema arrives, staying pristine", () => {
    const harness = makeShellHarness();
    harness.writeDemoCell("MATCH (n) RETURN n LIMIT 5;");

    // Schema arrives (watch.schema fires) before Monaco has resolved.
    harness.upgradeDemoCell("MATCH (a)-[r:PersonOwnership]->(b) RETURN a, r, b LIMIT 5;");

    expect(harness.isDemoCellFinalized).toBe(false);
    expect(harness.cypherEditor.pendingEditorContent).toBe(
      "MATCH (a)-[r:PersonOwnership]->(b) RETURN a, r, b LIMIT 5;"
    );
  });

  it("does not clobber user edits typed into the buffer before the editor exists", () => {
    const harness = makeShellHarness();
    harness.writeDemoCell("MATCH (n) RETURN n LIMIT 5;");

    // User starts typing before Monaco/schema resolve; CypherEditor's own
    // setEditorContent path is bypassed here since the test drives the
    // buffer directly, mirroring an external edit landing in the same slot.
    harness.cypherEditor.pendingEditorContent = "MATCH (n:Person) RETURN n;";

    harness.upgradeDemoCell("MATCH (a)-[r:PersonOwnership]->(b) RETURN a, r, b LIMIT 5;");

    expect(harness.isDemoCellFinalized).toBe(true);
    expect(harness.cypherEditor.pendingEditorContent).toBe("MATCH (n:Person) RETURN n;");
  });

  it("still upgrades correctly once the editor has been created (unchanged live-editor path)", () => {
    const harness = makeShellHarness();
    harness.writeDemoCell("MATCH (n) RETURN n LIMIT 5;");
    harness.createEditor();

    expect(harness.getDemoCellText()).toBe("MATCH (n) RETURN n LIMIT 5;");

    harness.upgradeDemoCell("MATCH (a)-[r:PersonOwnership]->(b) RETURN a, r, b LIMIT 5;");

    expect(harness.isDemoCellFinalized).toBe(false);
    expect(harness.cypherEditor.editor.getValue()).toBe(
      "MATCH (a)-[r:PersonOwnership]->(b) RETURN a, r, b LIMIT 5;"
    );
  });

  it("finalizes without upgrading when the live editor content has been edited", () => {
    const harness = makeShellHarness();
    harness.writeDemoCell("MATCH (n) RETURN n LIMIT 5;");
    harness.createEditor();
    harness.cypherEditor.editor.setValue("MATCH (n:Company) RETURN n;");

    harness.upgradeDemoCell("MATCH (a)-[r:PersonOwnership]->(b) RETURN a, r, b LIMIT 5;");

    expect(harness.isDemoCellFinalized).toBe(true);
    expect(harness.cypherEditor.editor.getValue()).toBe("MATCH (n:Company) RETURN n;");
  });

  it("returns null when the cell/editor ref does not exist at all", () => {
    const harness = makeShellHarness();
    harness.cypherEditor = null;
    expect(harness.getDemoCellText()).toBeNull();
  });
});
