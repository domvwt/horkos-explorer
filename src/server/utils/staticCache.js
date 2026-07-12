/**
 * Cache-Control policy for the static build output (dist/), split by asset
 * kind so long-lived caching only applies to files that are safe to cache
 * forever.
 *
 * Three tiers:
 *  1. HTML (index.html, the SPA shell) - `no-cache`. It must always be
 *     revalidated, otherwise a client can get stuck on a stale shell that
 *     references JS/CSS chunks the server no longer has.
 *  2. Webpack-hashed assets (js/css emitted with a content hash in the
 *     filename, e.g. `app.4f3a9c21.js`) - `immutable, max-age=31536000`
 *     (1 year). Safe forever: any content change produces a new filename.
 *  3. Everything else (fonts, any unhashed worker files or copies) -
 *     `max-age=86400` (1 day). These can change
 *     across a deploy without their filename changing, so they get a much
 *     shorter ceiling than the hashed tier.
 */

// Matches a dot- or dash-delimited hex segment of 8+ chars immediately before
// the final extension, e.g. "app.4f3a9c21.js" or "chunk-vendors.0a1b2c3d.css".
// Anchored to require a `.`/`-` boundary on both sides of the hex run so a
// plain 8+ hex WORD embedded in an otherwise normal name (e.g.
// "deadbeef.worker.js", "abcdef12.js" with no other segment) still matches
// only when it sits in its own delimited segment - this deliberately treats
// any such isolated hex segment as "looks hashed" rather than trying to
// distinguish it from a real content hash, since webpack's own hashed output
// is exactly this shape.
const HASHED_SEGMENT_RE = /[.-][0-9a-f]{8,}\.[^./-]+$/i;

/**
 * @param {string} filename - basename of the static file (no directory).
 * @returns {boolean} true if the filename looks like it carries a webpack
 *   content hash and is therefore safe to cache immutably.
 */
function isHashedAsset(filename) {
  if (!filename) return false;
  return HASHED_SEGMENT_RE.test(filename);
}

/**
 * express.static `setHeaders` callback implementing the three-tier policy
 * above. ETags are left enabled (express.static default) for all tiers.
 *
 * @param {import('express').Response} res
 * @param {string} filePath - absolute path of the file being served.
 */
function setStaticCacheHeaders(res, filePath) {
  const filename = filePath.split(/[\\/]/).pop();
  if (/\.html$/i.test(filename)) {
    res.setHeader("Cache-Control", "no-cache");
  } else if (isHashedAsset(filename)) {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    res.setHeader("Cache-Control", "public, max-age=86400");
  }
}

module.exports = { isHashedAsset, setStaticCacheHeaders };
