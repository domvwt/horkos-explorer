import { describe, it, expect, vi, beforeEach } from "vitest";

// monaco-editor is a heavy, DOM-dependent package; mock it so this test
// exercises MonacoLoader's single-flight promise logic without pulling in
// the real editor. Note: a dynamic import() resolves to a module namespace
// object wrapping the mock, not the mock's own identity, so the "same
// module" assertions below compare content (toEqual) against monacoModule
// but compare identity (toBe) between loadMonaco() calls themselves - that's
// the actual single-flight property under test.
const monacoModule = { marker: "monaco-editor-mock" };
vi.mock("monaco-editor", () => monacoModule);

describe("MonacoLoader.loadMonaco", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves to the monaco-editor module", async () => {
    const { loadMonaco } = await import("./MonacoLoader");
    const Monaco = await loadMonaco();
    expect(Monaco).toEqual(monacoModule);
  });

  it("returns the same in-flight promise to concurrent callers (single-flight)", async () => {
    const { loadMonaco } = await import("./MonacoLoader");
    const p1 = loadMonaco();
    const p2 = loadMonaco();
    expect(p1).toBe(p2);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(r1).toEqual(monacoModule);
  });

  it("caches the resolved module so a later call doesn't re-trigger the loader", async () => {
    const { loadMonaco } = await import("./MonacoLoader");
    const first = await loadMonaco();
    const second = await loadMonaco();
    expect(first).toBe(second);
    expect(second).toEqual(monacoModule);
  });

  it("a caller that arrives after resolution still gets the resolved module, not a new import", async () => {
    const { loadMonaco } = await import("./MonacoLoader");
    const first = await loadMonaco();
    const late = await loadMonaco();
    expect(late).toBe(first);
    expect(late).toEqual(monacoModule);
  });

  it("clears the cache on load failure so the next caller retries", async () => {
    const { loadMonaco } = await import("./MonacoLoader");
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error("chunk load failed"))
      .mockResolvedValue(monacoModule);
    await expect(loadMonaco(importer)).rejects.toThrow("chunk load failed");
    const retried = await loadMonaco(importer);
    expect(retried).toEqual(monacoModule);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("does not re-import after a failure once a retry has succeeded", async () => {
    const { loadMonaco } = await import("./MonacoLoader");
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(monacoModule);
    await expect(loadMonaco(importer)).rejects.toThrow("boom");
    await loadMonaco(importer);
    const third = await loadMonaco(importer);
    expect(third).toEqual(monacoModule);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
