import { describe, it, expect } from "vitest";
import { nodeCellPinMeta } from "./NodeCellPin";

// Beautified property lists as ResultTable receives them: the label is a
// display-only "Entity Type" row, the raw `_label` rides on the raw value.
const companyProps = [
  { name: "Entity Type", value: "Company", isLabel: true, isPrimaryKey: false },
  { name: "name", value: "Acme Ltd", isPrimaryKey: false },
  { name: "id", value: "c-42", isPrimaryKey: true },
];

describe("nodeCellPinMeta", () => {
  it("keeps the RAW _label (not the display name) so pins key like graph nodes", () => {
    const meta = nodeCellPinMeta({ _label: "Company" }, companyProps);
    expect(meta).toEqual({ label: "Company", pk: "c-42", name: "Acme Ltd" });
  });

  it("derives pk from the primary-key property", () => {
    const meta = nodeCellPinMeta({ _label: "Person" }, [
      { name: "name", value: "Jane" },
      { name: "cluster", value: "p-1", isPrimaryKey: true },
    ]);
    expect(meta.pk).toBe("p-1");
  });

  it("falls back to the id property when no property is flagged primary key", () => {
    const meta = nodeCellPinMeta({ _label: "Person" }, [
      { name: "name", value: "Jane" },
      { name: "id", value: "p-9" },
    ]);
    expect(meta.pk).toBe("p-9");
  });

  it("coerces a non-string pk value to a string", () => {
    const meta = nodeCellPinMeta({ _label: "Person" }, [
      { name: "id", value: 7, isPrimaryKey: true },
    ]);
    expect(meta.pk).toBe("7");
  });

  it("prefers the full property for name when there is no name (addresses)", () => {
    const meta = nodeCellPinMeta({ _label: "Address" }, [
      { name: "full", value: "1 High St", isPrimaryKey: false },
      { name: "id", value: "a-1", isPrimaryKey: true },
    ]);
    expect(meta.name).toBe("1 High St");
  });

  it("falls back to pk for the display name when neither name nor full exists", () => {
    const meta = nodeCellPinMeta({ _label: "Person" }, [
      { name: "id", value: "p-3", isPrimaryKey: true },
    ]);
    expect(meta.name).toBe("p-3");
  });

  it("returns null when the raw value carries no label", () => {
    expect(nodeCellPinMeta({}, companyProps)).toBeNull();
    expect(nodeCellPinMeta({ _label: "" }, companyProps)).toBeNull();
  });

  it("returns null when no pk can be derived", () => {
    const meta = nodeCellPinMeta({ _label: "Company" }, [
      { name: "name", value: "Acme Ltd" },
    ]);
    expect(meta).toBeNull();
  });

  it("returns null for a missing or malformed raw value", () => {
    expect(nodeCellPinMeta(null, companyProps)).toBeNull();
    expect(nodeCellPinMeta("Company", companyProps)).toBeNull();
  });

  it("returns null when properties is not an array", () => {
    expect(nodeCellPinMeta({ _label: "Company" }, null)).toBeNull();
  });
});
