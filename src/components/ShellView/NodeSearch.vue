<template>
  <div class="node-search__wrapper">
    <GraphToast
      :message="toastMessage"
      @dismiss="dismissToast"
    />
    <div class="node-search__form" @keydown.enter.prevent="executeSearch">
      <!-- Name Filter and Entity Type -->
      <div class="row g-2 mb-1">
        <div class="col-6">
          <label class="form-label-sm">{{ nameFieldLabel }}</label>
          <div class="position-relative">
            <input
              ref="nameInput"
              v-model="filters.name"
              type="text"
              class="form-control form-control-sm"
              :placeholder="nameFieldPlaceholder"
              autocomplete="off"
              @input="onNameInput"
              @keydown="onNameKeydown"
              @focus="showSuggestionsOnFocus"
              @blur="hideSuggestionsDelayed"
            >
            <!-- Teleported to body so the panel's overflow-y: auto can't clip it -->
            <Teleport to="body">
              <AutocompleteDropdown
                v-if="showSuggestions && suggestions.length > 0"
                :suggestions="suggestions"
                :selected-index="selectedSuggestionIndex"
                :position="dropdownPosition"
                @select="onSuggestionSelect"
                @hover="selectedSuggestionIndex = $event"
              />
            </Teleport>
          </div>
        </div>
        <div class="col-6">
          <label class="form-label-sm">Entity Type</label>
          <select v-model="selectedType" class="form-select form-select-sm" @change="onEntityTypeChange">
            <option value="Person">Person</option>
            <option value="Company">Company</option>
            <option value="Address">Address</option>
          </select>
        </div>
      </div>

      <!-- Company-Specific Filters -->
      <div v-if="selectedType === 'Company'" class="row g-2 mb-1">
        <div class="col-6">
          <label class="form-label-sm">Company Number</label>
          <input
            v-model="filters.companyNumber"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g., 12345678"
          >
        </div>
        <div class="col-6">
          <label class="form-label-sm">Jurisdiction</label>
          <select v-model="filters.jurisdiction" class="form-select form-select-sm">
            <option value="">Any</option>
            <option value="GB">United Kingdom (GB)</option>
            <option value="CYM">Cayman Islands (CYM)</option>
            <option value="JEY">Jersey (JEY)</option>
            <option value="GGY">Guernsey (GGY)</option>
            <option value="BMU">Bermuda (BMU)</option>
            <option value="VGB">British Virgin Islands (VGB)</option>
          </select>
        </div>
      </div>

      <!-- Address-Specific Filters -->
      <div v-if="selectedType === 'Address'" class="row g-2 mb-1">
        <div class="col-6">
          <label class="form-label-sm">Post Code</label>
          <input
            v-model="filters.postCode"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g., SW1A"
          >
        </div>
        <div class="col-6">
          <label class="form-label-sm">City</label>
          <input
            v-model="filters.city"
            type="text"
            class="form-control form-control-sm"
            placeholder="e.g., London"
          >
        </div>
      </div>

      <!-- Search Row: Limit and Button -->
      <div class="row g-2 mb-0">
        <div class="col-6">
          <label class="form-label-sm">Limit</label>
          <select v-model="resultLimit" class="form-select form-select-sm">
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="500">500</option>
          </select>
        </div>
        <div class="col-6">
          <label class="form-label-sm">&nbsp;</label>
          <button
            class="btn btn-primary btn-sm w-100"
            :disabled="!hasFilters"
            @click="executeSearch"
          >
            <i class="fa-solid fa-search me-1" />
            Search
          </button>
        </div>
      </div>

      <!-- Generated Query Display (Expandable) -->
      <div v-if="generatedQuery" class="generated-query-section">
        <div class="d-flex justify-content-between align-items-center">
          <button
            class="btn btn-link btn-sm p-0 text-decoration-none query-toggle"
            @click="showQuery = !showQuery"
          >
            <i :class="showQuery ? 'fa-chevron-down' : 'fa-chevron-right'" class="fa-solid me-1" />
            <span class="query-label">Show Generated Query</span>
          </button>
          <button
            v-if="showQuery"
            class="btn btn-sm py-0"
            :class="copiedToClipboard ? 'btn-success' : 'btn-outline-secondary'"
            @click="copyQuery"
          >
            <i class="fa-solid" :class="copiedToClipboard ? 'fa-check' : 'fa-copy'" />
            <span v-if="copiedToClipboard" class="ms-1" style="font-size: 0.7rem;">Copied!</span>
          </button>
        </div>
        <div v-if="showQuery" class="generated-query mt-1">
          <code>{{ displayQuery }}</code>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from "@/utils/AxiosWrapper";
import AutocompleteDropdown from "./AutocompleteDropdown.vue";
import GraphToast from "./GraphToast.vue";
import { planSuggestionSelect } from "@/utils/NodeSearchLogic";

// The Limit dropdown offers exactly these values. resultLimit is interpolated
// UNESCAPED into the LIMIT clause, and loadFromUrl auto-executes the search, so
// a crafted ?limit=... link could otherwise inject Cypher with no click. Every
// path that can set resultLimit is coerced back to one of these integers.
const ALLOWED_LIMITS = [10, 25, 50, 100, 500];
const DEFAULT_LIMIT = 25;

// Coerce an arbitrary value (URL param, stored string) to one of the allowed
// integer limits, falling back to the default for anything not whitelisted.
function sanitizeLimit(value) {
  const n = parseInt(value, 10);
  return ALLOWED_LIMITS.includes(n) ? n : DEFAULT_LIMIT;
}

export default {
  name: "NodeSearch",
  components: {
    AutocompleteDropdown,
    GraphToast,
  },
  emits: ["executeQuery", "select-entity"],
  data() {
    return {
      selectedType: "Person",
      filters: {
        name: "",
        companyNumber: "",
        jurisdiction: "",
        postCode: "",
        city: "",
      },
      resultLimit: "25",
      generatedQuery: "",
      queryParams: {},
      showQuery: false,
      copiedToClipboard: false,
      // Autocomplete state
      suggestions: [],
      showSuggestions: false,
      selectedSuggestionIndex: -1,
      autocompleteAvailable: true,
      debounceTimer: null,
      autocompleteRequestId: 0,
      // AbortController for the in-flight /api/suggest request(s). A newer
      // keystroke (or an emptied/cleared input) aborts the superseded request
      // so a slow BM25 scan is not just discarded on arrival but cancelled on
      // the wire. The monotonic requestId above remains the stale-response
      // backstop for any response that lands before the abort takes effect.
      suggestAbortController: null,
      // Suggestion the user explicitly picked; enables navigation by node
      // id instead of name matching. Cleared as soon as the name is edited.
      selectedSuggestion: null,
      // Viewport coordinates for the body-teleported dropdown
      dropdownPosition: { top: 0, left: 0, width: 0, maxHeight: 260 },
      // Input-feedback toast (same GraphToast surface the graph canvas uses)
      toastMessage: null,
      toastTimeout: null,
    };
  },
  computed: {
    hasFilters() {
      return Object.values(this.filters).some((v) => v !== "");
    },
    nameFieldLabel() {
      if (this.selectedType === 'Address') {
        return 'Address';
      }
      return 'Name';
    },
    nameFieldPlaceholder() {
      if (this.selectedType === 'Address') {
        return 'Search by address...';
      }
      return 'Search by name...';
    },
    displayQuery() {
      // Substitute parameter values into the query for copy-paste
      let query = this.generatedQuery;

      if (this.queryParams && Object.keys(this.queryParams).length > 0) {
        for (const [key, value] of Object.entries(this.queryParams)) {
          const paramPlaceholder = `$${key}`;
          // Escape single quotes in the value and wrap in quotes
          const escapedValue = String(value).replace(/'/g, "\\'");
          query = query.replace(new RegExp(`\\${paramPlaceholder}`, 'g'), `'${escapedValue}'`);
        }
      }

      return query;
    },
  },
  watch: {
    showSuggestions(isShown) {
      if (isShown) {
        this.updateDropdownPosition();
      }
    },
  },
  mounted() {
    // Delay loading from URL to ensure schema is ready
    this.$nextTick(() => {
      // Wait for schema to load before auto-executing URL searches
      setTimeout(() => {
        this.loadFromUrl();
      }, 500);
    });
    // Capture-phase scroll catches scrolling of any ancestor panel, keeping
    // the body-teleported dropdown anchored to the input
    window.addEventListener("scroll", this.onViewportChange, true);
    window.addEventListener("resize", this.onViewportChange);
  },
  beforeUnmount() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    window.removeEventListener("scroll", this.onViewportChange, true);
    window.removeEventListener("resize", this.onViewportChange);
  },
  methods: {
    loadFromUrl() {
      const params = new URLSearchParams(window.location.search);

      // Check if we have search parameters
      const type = params.get('type');
      if (!type) return;

      // Restore entity type
      this.selectedType = type;

      // Restore filters
      const name = params.get('name');
      const companyNumber = params.get('companyNumber');
      const jurisdiction = params.get('jurisdiction');
      const postCode = params.get('postCode');
      const city = params.get('city');
      const limit = params.get('limit');

      if (name) this.filters.name = name;
      if (companyNumber) this.filters.companyNumber = companyNumber;
      if (jurisdiction) this.filters.jurisdiction = jurisdiction;
      if (postCode) this.filters.postCode = postCode;
      if (city) this.filters.city = city;
      // Whitelist the URL-supplied limit: a non-allowed value (or injection
      // payload like "1 UNION MATCH (m) RETURN m") falls back to the default
      // rather than being stored and later interpolated into the query.
      if (limit) this.resultLimit = String(sanitizeLimit(limit));

      // Restore node-id navigation from a shared/bookmarked suggestion pick
      const id = params.get('id');
      if (id && name) {
        this.selectedSuggestion = { clusterId: id, name, canonicalName: null, detail: "" };
      }

      // Auto-execute search if we loaded from URL
      if (this.hasFilters) {
        this.$nextTick(() => {
          this.executeSearch();
        });
      }
    },
    updateUrl() {
      const params = new URLSearchParams();

      // Always include entity type
      params.set('type', this.selectedType);

      // Add filters if they have values
      if (this.filters.name) params.set('name', this.filters.name);
      if (this.selectedSuggestion?.clusterId && this.filters.name === this.selectedSuggestion.name) {
        params.set('id', this.selectedSuggestion.clusterId);
      }
      if (this.filters.companyNumber) params.set('companyNumber', this.filters.companyNumber);
      if (this.filters.jurisdiction) params.set('jurisdiction', this.filters.jurisdiction);
      if (this.filters.postCode) params.set('postCode', this.filters.postCode);
      if (this.filters.city) params.set('city', this.filters.city);

      // Add limit if not default
      if (this.resultLimit !== "25") {
        params.set('limit', this.resultLimit);
      }

      // Update URL without page reload
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.pushState({}, '', newUrl);
    },
    resetFilters() {
      this.filters = {
        name: "",
        companyNumber: "",
        jurisdiction: "",
        postCode: "",
        city: "",
      };
      this.generatedQuery = "";
      this.queryParams = {};
      this.selectedSuggestion = null;
      // Clear URL parameters
      window.history.pushState({}, '', window.location.pathname);
    },
    /**
     * Parse name filter for exact match syntax.
     * Returns { value, exactMatch } where:
     *   - value: The name without quotes (escaped quotes unescaped)
     *   - exactMatch: true if wrapped in double quotes
     */
    parseNameFilter(nameFilter) {
      const trimmed = nameFilter?.trim() || "";
      if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length > 2) {
        // Remove outer quotes and unescape any escaped quotes
        const inner = trimmed.slice(1, -1).replace(/\\"/g, '"');
        return {
          value: inner,
          exactMatch: true,
        };
      }
      return {
        value: trimmed,
        exactMatch: false,
      };
    },
    generateQuery() {
      const type = this.selectedType;
      const conditions = [];
      const params = {};
      let nodeLabel = "";

      // A picked autocomplete suggestion navigates by node id - exact and
      // unambiguous even when many entities share the name. Only honoured
      // while the input still shows the picked name.
      const picked = this.selectedSuggestion;
      const useNodeId = Boolean(
        picked?.clusterId && this.filters.name === picked.name
      );
      if (useNodeId) {
        conditions.push(`n.id = $id`);
        params.id = picked.clusterId;
      }

      if (type === "Person") {
        nodeLabel = ":Person";
        if (!useNodeId && this.filters.name) {
          const { value, exactMatch } = this.parseNameFilter(this.filters.name);
          if (exactMatch) {
            conditions.push(`n.name = $name`);
          } else {
            conditions.push(`toLower(n.name) CONTAINS toLower($name)`);
          }
          params.name = value;
        }
      } else if (type === "Company") {
        nodeLabel = ":Company";
        if (!useNodeId && this.filters.name) {
          const { value, exactMatch } = this.parseNameFilter(this.filters.name);
          if (exactMatch) {
            conditions.push(`n.name = $name`);
          } else {
            conditions.push(`toLower(n.name) CONTAINS toLower($name)`);
          }
          params.name = value;
        }
        if (this.filters.companyNumber) {
          conditions.push(`toLower(n.company_number) = toLower($companyNumber)`);
          params.companyNumber = this.filters.companyNumber;
        }
        if (this.filters.jurisdiction) {
          conditions.push(`n.jurisdiction = $jurisdiction`);
          params.jurisdiction = this.filters.jurisdiction;
        }
      } else if (type === "Address") {
        nodeLabel = ":Address";
        if (!useNodeId && this.filters.name) {
          const { value, exactMatch } = this.parseNameFilter(this.filters.name);
          if (exactMatch) {
            conditions.push(`n.full = $address`);
          } else {
            conditions.push(`toLower(n.full) CONTAINS toLower($address)`);
          }
          params.address = value;
        }
        if (this.filters.postCode) {
          conditions.push(`toLower(n.post_code) CONTAINS toLower($postCode)`);
          params.postCode = this.filters.postCode;
        }
        if (this.filters.city) {
          conditions.push(`toLower(n.city) CONTAINS toLower($city)`);
          params.city = this.filters.city;
        }
      }

      let query = `MATCH (n${nodeLabel})`;
      if (conditions.length > 0) {
        query += `\nWHERE ${conditions.join(' AND\n      ')}`;
      }
      // Defence in depth: interpolate a sanitised integer, never the raw
      // resultLimit. Even if resultLimit were somehow set to a hostile string,
      // the LIMIT clause can only ever be one of the allowed integers.
      const safeLimit = sanitizeLimit(this.resultLimit);
      query += `\nRETURN n\nLIMIT ${safeLimit}`;

      return { query, params };
    },
    executeSearch() {
      // Close autocomplete
      this.showSuggestions = false;
      this.suggestions = [];

      const { query, params } = this.generateQuery();
      this.generatedQuery = query;
      this.queryParams = params;
      this.updateUrl();
      this.$emit("executeQuery", { query, params });
    },
    copyQuery() {
      // Copy the query with values substituted
      navigator.clipboard.writeText(this.displayQuery);
      this.copiedToClipboard = true;
      setTimeout(() => {
        this.copiedToClipboard = false;
      }, 2000);
    },
    // Autocomplete methods
    updateDropdownPosition() {
      const input = this.$refs.nameInput;
      if (!input) return;
      const rect = input.getBoundingClientRect();
      this.dropdownPosition = {
        top: rect.bottom + 2,
        left: rect.left,
        width: rect.width,
        // Never extend past the bottom of the viewport
        maxHeight: Math.max(120, Math.min(260, window.innerHeight - rect.bottom - 10)),
      };
    },
    onViewportChange() {
      if (this.showSuggestions) {
        this.updateDropdownPosition();
      }
    },
    onNameInput() {
      // Typing invalidates any previously picked suggestion
      this.selectedSuggestion = null;

      // Clear any pending debounce
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      const query = this.filters.name?.trim();
      if (!this.autocompleteAvailable || !query || query.length < 2) {
        this.abortInflightSuggest();
        this.suggestions = [];
        this.showSuggestions = false;
        return;
      }

      // Don't fetch if already using exact match syntax (quoted)
      if (query.startsWith('"')) {
        this.abortInflightSuggest();
        this.suggestions = [];
        this.showSuggestions = false;
        return;
      }

      // Debounce the API call
      this.debounceTimer = setTimeout(() => {
        this.fetchSuggestions(query);
      }, 300);
    },
    // Abort any in-flight /api/suggest request. Called before a new keystroke
    // fetches and whenever the input empties/clears, so a superseded request is
    // cancelled rather than left running.
    abortInflightSuggest() {
      if (this.suggestAbortController) {
        this.suggestAbortController.abort();
        this.suggestAbortController = null;
      }
    },

    // True for an axios cancellation (aborted via AbortController). Such errors
    // are expected and must be swallowed silently. The default export is an
    // axios instance (no static isCancel), so key on the CanceledError code,
    // falling back to the static helper only when it exists.
    isAbortError(err) {
      return (
        err?.code === "ERR_CANCELED" ||
        (typeof axios.isCancel === "function" && axios.isCancel(err))
      );
    },

    async fetchSuggestions(query) {
      // Supersede any in-flight request from the previous keystroke, then open a
      // fresh controller whose signal both staged calls share.
      this.abortInflightSuggest();
      this.suggestAbortController = new AbortController();

      // One request id per keystroke. BOTH staged requests (fast + rank) are
      // tagged with it, and every response - fast OR rank - is dropped unless
      // its id still matches the latest keystroke. This is what stops a slow
      // keystroke-N rank response from overwriting keystroke-(N+1)'s
      // suggestions (AC#4): typing again bumps autocompleteRequestId, so any
      // in-flight staged response for the old keystroke is discarded on arrival.
      const requestId = ++this.autocompleteRequestId;

      // Stage 1 (fast): cheap LIKE-prefix query. Rendered immediately so the
      // dropdown never lags behind typing while BM25 runs. Blocks stage 2 on
      // failure/404, so a broken endpoint disables autocomplete just as before.
      const fastOk = await this.fetchSuggestionStage(query, "fast", requestId);
      if (!fastOk) {
        return;
      }

      // Stage 2 (rank): BM25 upgrade, fired only if this keystroke is still the
      // latest one. Superseding rather than queueing bounds the number of
      // in-flight BM25 scans on DuckDB's single shared connection - a burst of
      // keystrokes issues at most one rank query for the final keystroke.
      if (requestId !== this.autocompleteRequestId) {
        return;
      }
      await this.fetchSuggestionStage(query, "rank", requestId);
    },
    /**
     * Fetch one suggestion stage and, if it is still the latest keystroke,
     * merge its rows into the dropdown.
     *
     * The `rank` stage is an upgrade: an empty rank result (no BM25 matches
     * beyond what the fast stage already showed) leaves the fast suggestions
     * in place rather than blanking the dropdown. The `fast` stage always
     * applies its result (it is the baseline).
     *
     * @returns {Promise<boolean>} false if the endpoint is unavailable/errored
     *   for a still-current request (caller should stop staging), true otherwise.
     */
    async fetchSuggestionStage(query, stage, requestId) {
      try {
        const response = await axios.get("/api/suggest", {
          params: {
            q: query,
            type: this.selectedType,
            limit: 10,
            stage,
          },
          signal: this.suggestAbortController?.signal,
        });

        // Drop stale responses: a newer keystroke has superseded this one.
        if (requestId !== this.autocompleteRequestId) {
          return false;
        }

        const mapped = (response.data || []).map((item) => ({
          name: item.name,
          clusterId: item.cluster_id || null,
          canonicalName: item.canonical_name || null,
          detail: this.suggestionDetail(item),
        }));

        // A rank upgrade with no rows keeps the fast baseline visible.
        if (stage === "rank" && mapped.length === 0) {
          return true;
        }

        this.suggestions = mapped;
        this.showSuggestions = this.suggestions.length > 0;
        this.selectedSuggestionIndex = -1;
        return true;
      } catch (err) {
        // Silently swallow cancellations: a superseded request being aborted is
        // expected, not an error, and must not disable autocomplete or blank
        // the dropdown.
        if (this.isAbortError(err)) {
          return false;
        }

        // Ignore errors from stale requests.
        if (requestId !== this.autocompleteRequestId) {
          return false;
        }

        if (err.response?.status === 404) {
          // Autocomplete not available - disable future requests.
          this.autocompleteAvailable = false;
        }

        // A failed rank upgrade must not clear the fast baseline already shown;
        // only the fast (baseline) stage blanks the dropdown on error.
        if (stage !== "rank") {
          this.suggestions = [];
          this.showSuggestions = false;
        }
        return false;
      }
    },
    /**
     * Build the muted one-line disambiguator shown under a suggestion.
     * Homonym clusters are common - these details (plus the canonical
     * name when a non-canonical variant matched) are what tell two
     * "John Smith" rows apart.
     */
    suggestionDetail(item) {
      const d = item.disambiguators || {};
      const parts = [];
      if (item.canonical_name && item.canonical_name !== item.name) {
        parts.push(`→ ${item.canonical_name}`);
      }
      if (this.selectedType === "Person") {
        if (d.birth_date) parts.push(`b. ${d.birth_date}`);
        if (d.nationality) parts.push(d.nationality);
        if (d.record_count > 1) parts.push(`${d.record_count} records`);
      } else if (this.selectedType === "Company") {
        if (d.company_number) parts.push(`No. ${d.company_number}`);
        if (d.status) parts.push(d.status);
      } else if (this.selectedType === "Address") {
        if (d.post_code) parts.push(d.post_code);
        if (d.city) parts.push(d.city);
      }
      return parts.join(" · ");
    },
    onSuggestionSelect(suggestion) {
      const plan = planSuggestionSelect(suggestion, this.selectedType);
      this.suggestions = [];
      this.showSuggestions = false;
      this.selectedSuggestionIndex = -1;
      if (plan.mode === "select") {
        // Additive navigation: route the picked entity to the active cell's
        // graph so it is added to / focused on the existing canvas (like a pin
        // click) instead of replacing it. Navigating by node id is unambiguous
        // even when many entities share the picked name.
        this.filters.name = suggestion.name;
        this.selectedSuggestion = suggestion;
        this.$emit("select-entity", { label: plan.label, pk: plan.pk });
        return;
      }
      // A suggestion without a cluster id (legacy pre-contract search tables)
      // cannot be navigated to. Surface input feedback and do nothing else -
      // same guard pattern as the graph's connection picker. The Search button
      // and Enter-to-search remain available for plain name searches.
      this.selectedSuggestion = null;
      this.showToast("Couldn't identify the selected entity.", 4000);
    },
    // Same minimal auto-dismiss pattern as ResultGraph's showToast, rendered
    // through the shared GraphToast component.
    showToast(message, duration = 5000) {
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
      }
      this.toastMessage = message;
      this.toastTimeout = setTimeout(() => {
        this.dismissToast();
      }, duration);
    },
    dismissToast() {
      this.toastMessage = null;
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
        this.toastTimeout = null;
      }
    },
    onNameKeydown(event) {
      if (!this.showSuggestions || this.suggestions.length === 0) {
        return;
      }

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          this.selectedSuggestionIndex = Math.min(
            this.selectedSuggestionIndex + 1,
            this.suggestions.length - 1
          );
          break;
        case "ArrowUp":
          event.preventDefault();
          this.selectedSuggestionIndex = Math.max(
            this.selectedSuggestionIndex - 1,
            -1
          );
          break;
        case "Enter":
          if (this.selectedSuggestionIndex >= 0) {
            event.preventDefault();
            event.stopPropagation();
            this.onSuggestionSelect(this.suggestions[this.selectedSuggestionIndex]);
          }
          break;
        case "Escape":
          event.preventDefault();
          this.showSuggestions = false;
          this.suggestions = [];
          this.selectedSuggestionIndex = -1;
          break;
      }
    },
    showSuggestionsOnFocus() {
      // Show existing suggestions on focus
      if (this.suggestions.length > 0) {
        this.showSuggestions = true;
      }
    },
    hideSuggestionsDelayed() {
      // Delay hiding to allow click events to fire
      setTimeout(() => {
        this.showSuggestions = false;
      }, 200);
    },
    onEntityTypeChange() {
      // The name field means different things per type (Person/Company name
      // vs full address), so clear it along with suggestions; bump the
      // request id so any in-flight fetch for the previous type is discarded
      this.autocompleteRequestId++;
      this.abortInflightSuggest();
      this.filters.name = "";
      this.suggestions = [];
      this.showSuggestions = false;
      this.selectedSuggestionIndex = -1;
      this.selectedSuggestion = null;
    },
  },
};
</script>

<style lang="scss" scoped>
.node-search__wrapper {
  position: relative;
  padding: 0.5rem 0.75rem;
  height: 100%;
  overflow-y: auto;
}

.node-search__form {
  max-width: 100%;
}

.form-label-sm {
  font-size: 0.75rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  display: block;
}

.generated-query-section {
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--bs-body-inactive);
}

.query-toggle {
  color: var(--bs-body-color);

  &:hover {
    color: var(--bs-primary);
  }
}

.query-label {
  font-size: 0.75rem;
  font-weight: 500;
}

.generated-query {
  padding: 0.5rem;
  background-color: var(--bs-body-bg-secondary);
  border: 1px solid var(--bs-body-inactive);
  border-radius: 0.25rem;
  font-family: "Monaco", "Menlo", "Ubuntu Mono", "Consolas", "source-code-pro", monospace;
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow-y: auto;

  code {
    display: block;
  }
}

button:disabled {
  cursor: not-allowed;
}
</style>
