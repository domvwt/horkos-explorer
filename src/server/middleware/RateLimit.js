const rateLimit = require('express-rate-limit');
const logger = require("../utils/Logger");

/**
 * Rate Limiting Middleware
 *
 * Protects API endpoints from abuse by limiting the number of requests
 * per IP address within a time window.
 */

// Use higher limits in development to avoid issues with hot-reloading
const isDevelopment = process.env.NODE_ENV === 'development';

// Compute effective config values up front so they can be both passed into
// the middleware AND logged/validated below — express-rate-limit v8 does not
// expose windowMs/max back on the returned middleware object.
const apiWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000; // 1 minute window
const apiMax = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || (isDevelopment ? 1000 : 60); // Relaxed in dev
const queryWindowMs = parseInt(process.env.QUERY_RATE_LIMIT_WINDOW_MS) || 60 * 1000; // 1 minute window
const queryMax = parseInt(process.env.QUERY_RATE_LIMIT_MAX_REQUESTS) || (isDevelopment ? 500 : 30); // Relaxed in dev
const suggestWindowMs = parseInt(process.env.SUGGEST_RATE_LIMIT_WINDOW_MS) || 60 * 1000; // 1 minute window
const suggestMax = parseInt(process.env.SUGGEST_RATE_LIMIT_MAX_REQUESTS) || (isDevelopment ? 2000 : 120); // Relaxed in dev

// General API rate limiter (applies to most endpoints)
const apiLimiter = rateLimit({
  windowMs: apiWindowMs,
  max: apiMax,
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  message: {
    error: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// Stricter rate limiter for query endpoints (more resource-intensive)
const queryLimiter = rateLimit({
  windowMs: queryWindowMs,
  max: queryMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many queries from this IP, please try again in a minute.',
    code: 'QUERY_RATE_LIMIT_EXCEEDED'
  },
  handler: (req, res) => {
    logger.warn(`Query rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many queries from this IP, please try again in a minute.',
      code: 'QUERY_RATE_LIMIT_EXCEEDED',
      retryAfter: req.rateLimit.resetTime
    });
  },
  // Skip rate limiting for successful cached queries (if implemented)
  skip: () => {
    // Could check if query is in cache and skip rate limit
    return false;
  }
});

// Dedicated rate limiter for the autocomplete endpoint. /api/suggest is the
// highest-frequency public surface (one request per keystroke, staged fast +
// rank), so it gets its own generous bucket rather than sharing the general API
// limit — otherwise a normal typing burst would exhaust the shared apiLimiter.
const suggestLimiter = rateLimit({
  windowMs: suggestWindowMs,
  max: suggestMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many autocomplete requests from this IP, please slow down.',
    code: 'SUGGEST_RATE_LIMIT_EXCEEDED'
  },
  handler: (req, res) => {
    logger.warn(`Suggest rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many autocomplete requests from this IP, please slow down.',
      code: 'SUGGEST_RATE_LIMIT_EXCEEDED',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

// Authentication endpoint rate limiter (prevent brute force if auth is added)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute window
  max: 5, // 5 login attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many authentication attempts, please try again later.',
    code: 'AUTH_RATE_LIMIT_EXCEEDED'
  },
  skipSuccessfulRequests: true // Don't count successful authentications
});

// Warn if an env override has effectively disabled a rate limiter, so a
// misconfiguration doesn't silently remove a security control.
function checkLimiterBounds(name, windowMs, max) {
  if (!Number.isFinite(max) || max <= 0) {
    logger.warn(`${name} rate limit is misconfigured (max=${max}) — this disables the limit; requests will not be throttled.`);
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    logger.warn(`${name} rate limit window is misconfigured (windowMs=${windowMs}) — this disables the limit; requests will not be throttled.`);
  }
}

checkLimiterBounds('API', apiWindowMs, apiMax);
checkLimiterBounds('Query', queryWindowMs, queryMax);
checkLimiterBounds('Suggest', suggestWindowMs, suggestMax);

// Log rate limit configuration on startup
if (process.env.NODE_ENV !== 'test') {
  logger.info('Rate limiting configuration:');
  logger.info(`  API limit: ${apiMax} requests per ${apiWindowMs / 1000}s`);
  logger.info(`  Query limit: ${queryMax} queries per ${queryWindowMs / 1000}s`);
  logger.info(`  Suggest limit: ${suggestMax} requests per ${suggestWindowMs / 1000}s`);
}

module.exports = {
  apiLimiter,
  queryLimiter,
  suggestLimiter,
  authLimiter
};
