// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useModeStore } from "./ModeStore";
import { MODES } from "../utils/Constants";

function freshStore() {
  setActivePinia(createPinia());
  return useModeStore();
}

describe("fail-closed boot default", () => {
  // Until /api/mode resolves, every write-gated surface must see the session
  // as read-only, or READ_ONLY deployments flash write-mode UI on launch.
  it("boots as READ_ONLY before any setMode call", () => {
    const store = freshStore();
    expect(store.currentMode).toBe(MODES.READ_ONLY);
    expect(store.isReadOnly).toBe(true);
    expect(store.isReadWrite).toBe(false);
    expect(store.isDemo).toBe(false);
    expect(store.isWasm).toBe(false);
  });
});

describe("setMode", () => {
  it("switches to READ_WRITE when the server says so", () => {
    const store = freshStore();
    store.setMode(MODES.READ_WRITE);
    expect(store.isReadOnly).toBe(false);
    expect(store.isReadWrite).toBe(true);
    expect(store.isWasm).toBe(false);
  });

  it("treats DEMO as writable wasm", () => {
    const store = freshStore();
    store.setMode(MODES.DEMO);
    expect(store.isDemo).toBe(true);
    expect(store.isWasm).toBe(true);
    expect(store.isReadWrite).toBe(true);
    expect(store.isReadOnly).toBe(false);
  });

  it("treats WASM as writable wasm, not demo", () => {
    const store = freshStore();
    store.setMode(MODES.WASM);
    expect(store.isDemo).toBe(false);
    expect(store.isWasm).toBe(true);
    expect(store.isReadWrite).toBe(true);
  });

  it("falls back to READ_ONLY on an unrecognised mode", () => {
    const store = freshStore();
    store.setMode(MODES.READ_WRITE);
    store.setMode("BANANA");
    expect(store.currentMode).toBe(MODES.READ_ONLY);
    expect(store.isReadOnly).toBe(true);
    expect(store.isReadWrite).toBe(false);
  });

  it("falls back to READ_ONLY on undefined", () => {
    const store = freshStore();
    store.setMode(undefined);
    expect(store.isReadOnly).toBe(true);
    expect(store.isReadWrite).toBe(false);
  });
});
