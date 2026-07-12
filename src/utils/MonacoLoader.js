// monaco-editor is heavy, so it is loaded on demand instead of in the initial
// bundle. Both CypherEditor (the query editor) and ResultCode (the read-only
// JSON viewer) need the same dynamic chunk, and previously only CypherEditor
// awaited it — ResultCode read `window.Monaco` synchronously and threw
// "Monaco is not initialized." if it mounted before CypherEditor's import()
// resolved. This module gives every caller a single-flight promise of the
// same chunk: the first call kicks off `import("monaco-editor")`, every
// subsequent call (including ones that arrive before the first resolves)
// gets the same in-flight promise back, and the resolved module is cached
// module-level so later calls are instant.
let monacoPromise = null;

/**
 * Resolve to the monaco-editor module, loading it on first use. Safe to call
 * from multiple components/instances concurrently — everyone shares the one
 * underlying dynamic import. A failed load clears the cache so the next
 * caller retries instead of inheriting a permanently rejected promise (a
 * transient chunk-load failure would otherwise disable the editor for the
 * rest of the session).
 *
 * @param {() => Promise<typeof import("monaco-editor")>} [importer] test seam
 * @returns {Promise<typeof import("monaco-editor")>}
 */
export function loadMonaco(importer = () => import("monaco-editor")) {
  if (!monacoPromise) {
    monacoPromise = importer().catch((err) => {
      monacoPromise = null;
      throw err;
    });
  }
  return monacoPromise;
}
