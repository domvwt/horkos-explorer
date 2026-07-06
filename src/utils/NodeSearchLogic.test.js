import { describe, it, expect } from "vitest";
import { planSuggestionSelect } from "./NodeSearchLogic";

describe("planSuggestionSelect", () => {
  it("routes a suggestion with a cluster id to the additive select path", () => {
    const suggestion = { name: "Acme Ltd", clusterId: "cluster-42" };
    expect(planSuggestionSelect(suggestion, "Company")).toEqual({
      mode: "select",
      label: "Company",
      pk: "cluster-42",
    });
  });

  it("carries the currently selected node type as the label", () => {
    const suggestion = { name: "Jane Doe", clusterId: "p1" };
    expect(planSuggestionSelect(suggestion, "Person")).toEqual({
      mode: "select",
      label: "Person",
      pk: "p1",
    });
  });

  it("rejects a suggestion without a cluster id (no search fallback)", () => {
    // Legacy pre-contract search tables return cluster_id: null; there is no
    // pk to navigate by, so the pick is rejected for input feedback - it must
    // never fall back to a canvas-replacing search.
    expect(planSuggestionSelect({ name: "Legacy" }, "Person")).toEqual({
      mode: "reject",
    });
    expect(planSuggestionSelect({ name: "Legacy", clusterId: null }, "Person")).toEqual({
      mode: "reject",
    });
    expect(planSuggestionSelect({ name: "Legacy", clusterId: "" }, "Person")).toEqual({
      mode: "reject",
    });
  });

  it("treats a numeric-zero cluster id as a real, navigable id", () => {
    // 0 is a valid pk; only null / undefined / "" mean "no id".
    expect(planSuggestionSelect({ name: "Zero", clusterId: 0 }, "Company")).toEqual({
      mode: "select",
      label: "Company",
      pk: 0,
    });
  });

  it("rejects a missing suggestion", () => {
    expect(planSuggestionSelect(null, "Person")).toEqual({ mode: "reject" });
    expect(planSuggestionSelect(undefined, "Person")).toEqual({ mode: "reject" });
  });

  it("never returns a search mode for any input", () => {
    // The old contract had a canvas-replacing "search" fallback; the current
    // one is additive-select or reject-with-feedback only.
    const inputs = [
      { name: "A", clusterId: "c1" },
      { name: "B", clusterId: null },
      { name: "C" },
      null,
    ];
    for (const input of inputs) {
      const plan = planSuggestionSelect(input, "Company");
      expect(["select", "reject"]).toContain(plan.mode);
    }
  });
});
