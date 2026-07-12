<template>
  <div class="main-layout">
    <!-- Top Header -->
    <header ref="header" class="main-layout__header">
      <div class="main-layout__header-content">
        <a
          class="horkos-brand"
          :href="homeUrl"
        >
<span class="brand-text">horkos</span>
        </a>

        <div class="main-layout__header-actions">
          <a
            href="#privacy"
            class="header-link"
            @click.prevent="navigateTo('privacy')"
          >
            <i class="fa-solid fa-shield-halved" />
            <span>Privacy</span>
          </a>
          <button
            class="header-link"
            @click="showSettingsModal()"
          >
            <i class="fa-solid fa-cog" />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </header>

    <!-- Main Container -->
    <div class="wrapper">
      <!-- Notebook: persistent, collapsible left rail (owned by the app shell,
           present on all main views). Graph actions delegate through
           ShellMainView to the active cell's ResultGraph. -->
      <NotebookSidebar
        ref="notebookSidebar"
        @select-entity="handleNotebookSelectEntity"
        @save-view="handleNotebookSaveView"
        @restore-view="handleNotebookRestoreView"
        @open-shared-view="handleOpenSharedView"
      />
      <div class="main-layout__main-container">
        <div class="container-fluid">
          <SchemaViewMain
            v-show="showSchema"
            ref="schemaView"
            :schema="schema"
            :navbar-height="0"
            :is-visible="showSchema"
            @reload-schema="reloadSchema"
            @add-placeholder-node-table="addPlaceholderNodeTable"
            @add-placeholder-rel-table="addPlaceholderRelTable"
            @update-placeholder-node-table-label="updatePlaceholderNodeTable"
            @update-placeholder-rel-table="updatePlaceholderRelTable"
            @set-placeholder="setPlaceholder"
            @unset-placeholder="unsetPlaceholder"
          />
          <ShellMainView
            v-show="showShell"
            ref="shellView"
            :schema="schema"
            :navbar-height="headerHeight"
            @reload-schema="reloadSchema"
          />
          <SettingsMainView
            v-if="showSettings"
            ref="settings"
            :schema="schema"
            @ready="handleSettingsReady"
            @settingsSaved="handleSettingsSaved"
          />
          <ImporterMainView
            v-show="showImporter"
            :schema="schema"
            @reload-schema="reloadSchema"
          />
          <PrivacyView
            v-show="showPrivacy"
            :visible="showPrivacy"
            @dismiss="dismissPrivacy"
          />
        </div>
      </div>
    </div>

    <div
      ref="modal"
      class="modal"
      tabindex="-1"
    >
      <div class="modal-dialog">
        <div class="modal-content">
          <div
            v-if="modeStore.isDemo"
            class="modal-header"
          >
            <h5 class="modal-title">
              Welcome to Horkos Explorer!
            </h5>
          </div>
          <div class="modal-body">
            <div v-if="modeStore.isDemo">
              <p>
                This WebAssembly-powered demo lets you import and query graph data using openCypher.
                <br><br>
                Note: Data is not saved between sessions.
              </p>
              <hr>
              <div
                v-if="!isKuzuWasmInitialized"
                class="d-flex align-items-center"
              >
                <strong class="text-primary">Initializing WebAssembly module...</strong>
                <div
                  class="spinner-border text-primary ms-auto"
                  role="status"
                />
              </div>
              <div
                v-else
                class="d-flex align-items-center"
              >
                <strong class="text-success">
                  <i class="fa-solid fa-check" />&nbsp; WebAssembly is ready—start exploring!
                </strong>
              </div>
            </div>
            <p v-if="modeStore.isReadOnly">
              Horkos Explorer is running in read-only mode. In this mode, you cannot load a
              dataset, modify the schema, or execute write queries. If you want to make
              changes to the database, please restart your Horkos Explorer Docker image in
              read-write mode.
            </p>
          </div>
          <div class="modal-footer">
            <button
              type="button"
              class="btn btn-primary"
              @click="accessModeModal.hide()"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="js">
import { defineAsyncComponent } from "vue";
import NotebookSidebar from "./NotebookSidebar.vue";
import Axios from "@/utils/AxiosWrapper";
import { useSettingsStore } from "../store/SettingsStore";
import { useModeStore } from "../store/ModeStore";
import { useNotebookStore } from "../store/NotebookStore";
import { mapActions, mapStores } from 'pinia'
import { Modal } from 'bootstrap';

// The five top-level views carry the heavy frontend deps (Monaco, G6, WASM
// glue), so load each as its own async chunk instead of the initial bundle.
// Quiet loading: no spinner, the container is simply empty until the chunk
// arrives.
const SchemaViewMain = defineAsyncComponent(() => import("./SchemaView/SchemaViewMain.vue"));
const ShellMainView = defineAsyncComponent(() => import("./ShellView/ShellMainView.vue"));
const SettingsMainView = defineAsyncComponent(() => import("./SettingsView/SettingsMainView.vue"));
const ImporterMainView = defineAsyncComponent(() => import("./ImporterView/ImporterMainView.vue"));
const PrivacyView = defineAsyncComponent(() => import("./PrivacyView/PrivacyView.vue"));


export default {
  name: "MainLayout",
  components: {
    SchemaViewMain,
    ShellMainView,
    SettingsMainView,
    ImporterMainView,
    PrivacyView,
    NotebookSidebar,
  },
  data: () => ({
    accessModeModal: null,
    showSchema: false,
    showImporter: false,
    showShell: true,
    showSettings: false,
    showPrivacy: false,
    schema: null,
    isKuzuWasmInitialized: false,
    headerHeight: 0,
    // View to restore when the privacy panel is dismissed by clicking away.
    previousView: 'shell',
  }),
  computed: {
    ...mapStores(useModeStore, useNotebookStore),
    homeUrl() {
      const search = window.location.search;
      return search ? `/${search}#shell` : '/#shell';
    },
  },
  mounted() {
    this.accessModeModal = new Modal(this.$refs.modal);
    this.$nextTick(() => {
      this.measureHeaderHeight();
    });
    window.addEventListener("hashchange", this.handleHashChange);
    // Handle initial hash on page load
    this.handleHashChange();
  },
  beforeUnmount() {
    this.accessModeModal.dispose();
    window.removeEventListener("hashchange", this.handleHashChange);
  },
  async created() {
    // Hydrate the client-side notebooks (pins / notes / page / saved views)
    // from localStorage before any view renders.
    this.notebookStore.load();
    await this.getMode();
    // Read theme preference from cookie and apply it
    const savedTheme = this.getCookie('themePreference');
    if (savedTheme) {
      this.modeStore.setTheme(savedTheme); // Assuming a setTheme action/mutation exists
    }

    if (this.modeStore.isWasm) {
      this.isKuzuWasmInitialized = false;
      const Kuzu = (await import('../utils/KuzuWasm')).default;
      await Kuzu.init();
      this.isKuzuWasmInitialized = true;
    }

    const res = await Promise.all([this.getSchema(), this.getStoredSettings()])
    let storedSettings = res[1];
    if (!storedSettings || Object.keys(storedSettings).length === 0) {
      storedSettings = this.loadSettingsFromLocalStorage();
    }
    this.initSettings(this.schema, storedSettings);
    if (this.$refs.schemaView && this.showSchema) {
      this.$nextTick(() => {
        this.$refs.schemaView.initializeGraph();
      });
    }

  },
  methods: {
    measureHeaderHeight() {
      if (this.$refs.header) {
        this.headerHeight = this.$refs.header.offsetHeight;
      }
    },
    // The URL hash is the single source of truth for which container view is
    // shown. Nav actions call navigateTo(), which updates the hash; the browser
    // hashchange event (and the initial call in mounted) routes through here to
    // perform the actual view switch. Keeping the mutation one-directional
    // (hash -> view, never view -> hash inside the toggles) avoids re-entrancy.
    handleHashChange() {
      const hash = window.location.hash.substring(1);
      switch (hash) {
        case 'shell':
        case 'query':
          this.toggleShell();
          break;
        case 'schema':
          this.toggleSchema();
          break;
        case 'importer':
          this.toggleImporter(true);
          break;
        case 'privacy':
          // Remember the view we came from so a click-away can restore it.
          if (!this.showPrivacy) {
            this.previousView = this.currentView();
          }
          this.togglePrivacy();
          break;
        // Settings modal is handled separately as it's a modal, not a view in the main container
        // case 'settings':
        //   this.showSettingsModal();
        //   break;
        default:
          // If no valid hash, default to shell view
          if (!this.showSchema && !this.showImporter && !this.showSettings && !this.showPrivacy) {
            this.toggleShell();
          }
          break;
      }
    },
    // Navigate to a container view by making the hash reflect it. Because the
    // toggle happens in handleHashChange, this keeps the hash and the visible
    // view in sync. If the hash already equals the target no hashchange event
    // fires, so we invoke handleHashChange directly to re-show the view (this is
    // what makes re-clicking the active nav item work).
    navigateTo(view) {
      if (window.location.hash.substring(1) === view) {
        this.handleHashChange();
      } else {
        window.location.hash = view;
      }
    },
    // Identify the currently visible container view (for previousView tracking).
    currentView() {
      if (this.showSchema) return 'schema';
      if (this.showImporter) return 'importer';
      if (this.showPrivacy) return 'privacy';
      return 'shell';
    },
    // Click-away handler for the privacy panel: return to the view we came from
    // (falling back to shell), keeping the hash in sync via navigateTo.
    dismissPrivacy() {
      const target = this.previousView === 'privacy' ? 'shell' : this.previousView;
      this.navigateTo(target || 'shell');
    },
    async getSchema() {
      let schema;
      if (this.modeStore.isWasm) {
        const Kuzu = (await import('../utils/KuzuWasm')).default;
        schema = await Kuzu.getSchema();
      }
      else {
        // Without the schema every graph draw fails, and the boot-time fetch
        // can be dropped by a flaky connection or busy dev server, so retry
        // briefly before giving up.
        const maxAttempts = 4;
        for (let attempt = 1; ; attempt++) {
          try {
            const response = await Axios.get("/api/schema");
            schema = response.data;
            break;
          } catch (error) {
            if (attempt >= maxAttempts) {
              throw error;
            }
            console.warn(`getSchema: attempt ${attempt} failed, retrying:`, error.message);
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
          }
        }
      }
      this.schema = schema;
    },
    async getMode() {
      const response = await Axios.get("/api/mode");
      const mode = response.data.mode;
      this.modeStore.setMode(mode);
      this.$nextTick(() => {
        // Check if WASM modal has been seen. If in demo mode and not seen,
        // show the modal and set the cookie.
        const wasmModalSeen = this.getCookie('wasmModalSeen');
        if (this.modeStore.isDemo && !wasmModalSeen) {
          this.accessModeModal.show();
          this.setCookie('wasmModalSeen', 'true', 365); // Set cookie for 365 days
          this.navigateTo('importer');
        } else if (this.modeStore.isDemo) {
          // If in demo mode but WASM modal has been seen, still go to importer view
          this.navigateTo('importer');
        }
      });
    },
    async getStoredSettings() {
      if (this.modeStore.isWasm) {
        return {};
      }
      try {
        return (await Axios.get("/api/session/settings")).data;
      } catch (error) {
        // Session endpoint not available (DISABLE_SESSION_DB=true) - return empty
        // Settings will be loaded from localStorage instead
        console.debug('Server-side settings not available, using localStorage');
        return {};
      }
    },
    async reloadSchema() {
      await this.getSchema();
      this.handleSchemaReload(this.schema);
      this.$refs.schemaView.redrawGraph(true);
    },
    addPlaceholderNodeTable(tableName) {
      this.schema.nodeTables.push({
        name: tableName,
        properties: [],
        isPlaceholder: true,
      });
    },
    addPlaceholderRelTable(tableName) {
      this.schema.relTables.push({
        name: tableName,
        connectivity: [],
        properties: [],
        isPlaceholder: true,
      });
    },
    updatePlaceholderNodeTable(name) {
      const table = this.schema.nodeTables.find((t) => t.isPlaceholder);
      table.name = name;
    },
    updatePlaceholderRelTable(newTable) {
      const table = this.schema.relTables.find((t) => t.isPlaceholder);
      if (!table) {
        console.error("Placeholder relationship table not found in schema.");
        return;
      }
      if (newTable.name) {
        table.name = newTable.name;
      }
      if (newTable.connectivity) {
        table.connectivity = newTable.connectivity;
      }
    },
    setPlaceholder({ name, isNode }) {
      if (isNode) {
        const table = this.schema.nodeTables.find((t) => t.name === name);
        if (table) {
          table.isPlaceholder = true;
          this.setPlaceholderNodeTable(name);
          return;
        }
      } else {
        const table = this.schema.relTables.find((t) => t.name === name);
        if (table) {
          table.isPlaceholder = true;
          this.setPlaceholderRelTable(name);
        }
      }
    },
    unsetPlaceholder({ originalLabel, isNode }) {
      let table;
      if (isNode) {
        table = this.schema.nodeTables.find((t) => t.isPlaceholder);
      } else {
        table = this.schema.relTables.find((t) => t.isPlaceholder);
      }
      if (table) {
        table.isPlaceholder = false;
        table.name = originalLabel;
      }
      if (isNode) {
        this.unsetPlaceholderNodeTable(originalLabel);
      } else {
        this.unsetPlaceholderRelTable(originalLabel);
      }
      this.$nextTick(() => {
        this.$refs.schemaView.redrawGraph();
      });
    },
    hideAll() {
      this.showSchema = false;
      this.showShell = false;
      this.showImporter = false;
      this.showPrivacy = false;
    },
    togglePrivacy() {
      this.hideAll();
      this.showPrivacy = true;
    },
    toggleSchema() {
      this.hideAll();
      this.showSchema = true;
      this.$nextTick(() => {
        if (this.$refs.schemaView) {
          this.$refs.schemaView.handleResize();
        }
      });
    },
    toggleShell() {
      this.hideAll();
      this.showShell = true;
    },
    toggleImporter(force = false) {
      if (force || !this.showImporter) {
        this.hideAll();
        this.showImporter = true;
      }
    },
    showSettingsModal() {
      // showSettings is never reset to false (hideAll leaves it alone), so the
      // settings view mounts once and stays mounted: every open after the
      // first finds the ref and shows the modal directly.
      if (this.$refs.settings) {
        this.$refs.settings.showModal();
        return;
      }
      // First open: flip the v-if to mount the async settings component. Its
      // 'ready' event completes the open once the chunk arrives — a nextTick
      // here would race the chunk load and find the ref still undefined.
      this.showSettings = true;
    },
    handleSettingsReady() {
      if (this.$refs.settings) {
        this.$refs.settings.showModal();
      }
    },
    ...mapActions(useSettingsStore, [
      'initSettings',
      'loadSettingsFromLocalStorage',
      'handleSchemaReload',
      'setPlaceholderNodeTable',
      'setPlaceholderRelTable',
      'unsetPlaceholderNodeTable',
      'unsetPlaceholderRelTable',
    ]),
    // Manual cookie handling methods
    setCookie(name, value, days) {
      let expires = "";
      if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
      }
      document.cookie = name + "=" + (value || "") + expires + "; path=/";
    },
    getCookie(name) {
      const nameEQ = name + "=";
      const ca = document.cookie.split(';');
      for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
      }
      return null;
    },
    // Handle settings saved from settings modal - redraw graphs
    handleSettingsSaved() {
      if (this.$refs.shellView) {
        this.$refs.shellView.redrawAllGraphs();
      }
    },
    // Open a shared view (parsed HKS state) from the notebook sidebar's
    // "Open now" action: restore it into the active cell.
    handleOpenSharedView(state) {
      // Ensure we're on the shell view (and that the hash reflects it, so a
      // subsequent Privacy click always registers as a hash change).
      if (!this.showShell) {
        this.navigateTo('shell');
      }
      // Delegate to ShellMainView to restore the shared view into a cell.
      this.$nextTick(() => {
        if (this.$refs.shellView) {
          this.$refs.shellView.handleImportInvestigation(state);
        }
      });
    },
    // ---- Notebook sidebar delegation ------------------------------------
    // The sidebar is owned by the shell but its graph actions must act on the
    // live canvas inside a shell cell. Mirror the handleOpenSharedView
    // path: ensure we're on the shell view, then delegate to ShellMainView,
    // which reaches the active cell's ResultGraph. Each delegation returns
    // { ok, reason }; hand that back to the sidebar so a miss (e.g. the active
    // cell shows a table, or no query has run) surfaces feedback instead of
    // silently doing nothing.
    notebookDelegate(action, invoke) {
      if (!this.showShell) {
        this.navigateTo('shell');
      }
      // Async: select/restore may stub-mount an empty canvas before acting.
      // A rejected delegate (e.g. the stub-mount throwing mid-setup) must still
      // hand an outcome back to the sidebar, or the "+ Save current" editor
      // stays open with no feedback — treat a throw as a no-graph miss.
      this.$nextTick(async () => {
        let result;
        try {
          result = (await invoke(this.$refs.shellView)) || { ok: false, reason: "no-graph" };
        } catch (e) {
          result = { ok: false, reason: "no-graph" };
        }
        this.$refs.notebookSidebar?.handleDelegateResult(action, result);
      });
    },
    handleNotebookSelectEntity({ label, pk }) {
      this.notebookDelegate("select-entity", (shell) =>
        shell?.selectNotebookEntity({ label, pk })
      );
    },
    handleNotebookSaveView(name) {
      this.notebookDelegate("save-view", (shell) =>
        shell?.saveNotebookView(name)
      );
    },
    handleNotebookRestoreView(view) {
      this.notebookDelegate("restore-view", (shell) =>
        shell?.restoreNotebookView(view)
      );
    },
  },
};
</script>

<style>
/* Scrollbar styling */
body {
  scrollbar-gutter: stable both-edges;
  scrollbar-width: thin;
  scrollbar-color: var(--bs-body-text-secondary) var(--bs-body-bg);
  overflow-x: hidden;
}

.result-container__side-panel,
.schema_side-panel__wrapper,
.code-block {
  padding-right: 0 !important;
  margin-right: 0 !important;
}

.main-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.main-layout__header {
  background-color: var(--bs-body-bg-secondary);
  border-bottom: 1px solid var(--bs-body-inactive);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  position: relative;
}

.main-layout__header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.4rem 1rem;
  max-width: 100%;
}

.horkos-brand {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--bs-body-text) !important;
  text-decoration: none !important;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.7;
  }
}

.horkos-brand .brand-text {
  font-family: "Lexend", sans-serif;
  letter-spacing: 0.05em;
}

.main-layout__header-actions {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.header-link {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--bs-body-text);
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.5rem;
  transition: opacity 0.2s;
  font-size: 0.95rem;

  &:hover {
    opacity: 0.7;
  }

  i {
    font-size: 1rem;
  }
}

.wrapper {
  flex: 1;
  overflow: hidden;
  display: flex;
  /* Notebook sidebar (left) + main container (right), docked side by side so
     the sidebar pushes the canvas rather than overlaying it. */
  flex-direction: row;
  position: relative;
}

.main-layout__main-container {
  flex: 1;
  min-width: 0;
  height: 100%;
  position: relative;
  overflow: hidden;

  .container-fluid {
    height: 100%;
    padding: 0;
  }
}

/* Default badge: accent chip with white ink. Deliberately NOT !important —
   entity-type chips override both via an inline chipStyle() binding that
   computes a legible ink for their canvas colour (utils/ChipContrast.js). */
.badge {
  margin-left: 4px;
  margin-top: 4px;
  background-color: var(--bs-body-bg-accent);
  color: white;
}
</style>
