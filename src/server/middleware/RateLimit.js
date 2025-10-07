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

// General API rate limiter (applies to most endpoints)
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute window
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || (isDevelopment ? 1000 : 60), // Relaxed in dev
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
  windowMs: parseInt(process.env.QUERY_RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute window
  max: parseInt(process.env.QUERY_RATE_LIMIT_MAX_REQUESTS) || (isDevelopment ? 500 : 30), // Relaxed in dev
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
  skip: (req) => {
    // Could check if query is in cache and skip rate limit
    return false;
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

// Log rate limit configuration on startup
if (process.env.NODE_ENV !== 'test') {
  logger.info('Rate limiting configuration:');
  logger.info(`  API limit: ${apiLimiter.max} requests per ${apiLimiter.windowMs / 1000}s`);
  logger.info(`  Query limit: ${queryLimiter.max} queries per ${queryLimiter.windowMs / 1000}s`);
}

module.exports = {
  apiLimiter,
  queryLimiter,
  authLimiter
};
