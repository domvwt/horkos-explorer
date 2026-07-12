import { describe, it, expect, beforeEach } from "vitest";
import {
  claimGraphShortcuts,
  ownsGraphShortcuts,
  releaseGraphShortcuts,
} from "./GraphShortcutOwnership";

// Module state is shared across tests: reset by claiming a sentinel and
// releasing it, which nulls the owner whatever the previous test left behind.
beforeEach(() => {
  const sentinel = {};
  claimGraphShortcuts(sentinel);
  releaseGraphShortcuts(sentinel);
});

describe("graph shortcut ownership", () => {
  it("no instance owns the shortcuts before any claim", () => {
    expect(ownsGraphShortcuts({})).toBe(false);
  });

  it("claiming makes exactly the claimant the owner", () => {
    const a = {};
    const b = {};
    claimGraphShortcuts(a);
    expect(ownsGraphShortcuts(a)).toBe(true);
    expect(ownsGraphShortcuts(b)).toBe(false);
  });

  it("a later claim transfers ownership", () => {
    const a = {};
    const b = {};
    claimGraphShortcuts(a);
    claimGraphShortcuts(b);
    expect(ownsGraphShortcuts(a)).toBe(false);
    expect(ownsGraphShortcuts(b)).toBe(true);
  });

  it("claiming a null/undefined instance leaves the current owner in place", () => {
    const a = {};
    claimGraphShortcuts(a);
    claimGraphShortcuts(null);
    claimGraphShortcuts(undefined);
    expect(ownsGraphShortcuts(a)).toBe(true);
  });

  it("null/undefined never owns the shortcuts, even with no owner set", () => {
    expect(ownsGraphShortcuts(null)).toBe(false);
    expect(ownsGraphShortcuts(undefined)).toBe(false);
  });

  it("release by the owner clears ownership", () => {
    const a = {};
    claimGraphShortcuts(a);
    releaseGraphShortcuts(a);
    expect(ownsGraphShortcuts(a)).toBe(false);
  });

  it("release by a non-owner is a no-op (unmounting an old cell keeps the current claim)", () => {
    const a = {};
    const b = {};
    claimGraphShortcuts(a);
    releaseGraphShortcuts(b);
    expect(ownsGraphShortcuts(a)).toBe(true);
  });
});
