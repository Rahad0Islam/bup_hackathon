/**
 * GridWise LLM — Structured Logger
 *
 * Provides structured JSON logging with level control.
 * CRITICAL: Never logs API keys, secrets, or full stack traces in production.
 */

import config from "../config/config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LEVEL: LogLevel = config.NODE_ENV === "production" ? "info" : "debug";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[CURRENT_LEVEL];
}

/**
 * Sanitize an object to remove sensitive fields before logging.
 * Removes any keys that contain 'key', 'secret', 'password', 'token' (case-insensitive).
 */
function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = /key|secret|password|token|authorization/i;
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (sensitiveKeys.test(k)) {
      result[k] = "[REDACTED]";
    } else {
      result[k] = v;
    }
  }
  return result;
}

function formatMessage(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
): string {
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  if (meta) {
    entry.meta = sanitize(meta);
  }
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("debug")) {
      console.debug(formatMessage("debug", message, meta));
    }
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("info")) {
      console.info(formatMessage("info", message, meta));
    }
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", message, meta));
    }
  },

  error(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog("error")) {
      // In production, strip stack traces from meta
      const safeMeta = meta ? { ...meta } : undefined;
      if (safeMeta && config.NODE_ENV === "production") {
        delete safeMeta.stack;
      }
      console.error(formatMessage("error", message, safeMeta));
    }
  },
};
