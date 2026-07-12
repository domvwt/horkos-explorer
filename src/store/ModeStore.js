import { defineStore } from "pinia";
import { MODES } from "../utils/Constants";

export const useModeStore = defineStore("mode", {
  state: () => ({
    // Fail-closed boot default, mirroring the server's MODE parsing: until
    // /api/mode resolves, every write-gated surface must treat the session as
    // read-only, otherwise READ_ONLY deployments flash write-mode UI on launch.
    currentMode: MODES.READ_ONLY,
    theme: "vs-light",
  }),

  getters: {
    mode(state) {
      return state.currentMode;
    },

    isReadOnly(state) {
      return state.currentMode === MODES.READ_ONLY;
    },

    isDemo(state) {
      return state.currentMode === MODES.DEMO;
    },

    isReadWrite(state) {
      return state.currentMode === MODES.READ_WRITE || state.currentMode === MODES.WASM || state.currentMode === MODES.DEMO;
    },

    isWasm(state) {
      return state.currentMode === MODES.WASM || state.currentMode === MODES.DEMO;
    }
  },

  actions: {
    setMode(mode) {
      // Fail closed on anything unrecognised, same as the server's MODE parsing.
      this.currentMode = Object.values(MODES).includes(mode) ? mode : MODES.READ_ONLY;
    },
    toggleTheme() {
      this.theme = this.theme === 'vs-dark' ? 'vs-light' : 'vs-dark';
      document.documentElement.setAttribute(
        'data-bs-theme',
        this.theme === 'vs-dark' ? 'dark' : 'light'
      );
      if (window.Monaco?.editor) {
        window.Monaco.editor.setTheme(this.theme);
      }
    },
    setTheme(theme) {
      this.theme = theme;
      document.documentElement.setAttribute(
        'data-bs-theme',
        theme === 'vs-dark' ? 'dark' : 'light'
      );
      if (window.Monaco?.editor) {
        window.Monaco.editor.setTheme(theme);
      }
    },
  },
});
