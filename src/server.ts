/**
 * GridWise LLM — Server Entry Point
 *
 * Starts the HTTP server with graceful shutdown handling.
 * Logs startup information and handles uncaught exceptions/rejections.
 */

import app from "./app.js";
import config from "./config/config.js";
import { logger } from "./utils/logger.js";

const PORT = config.PORT;

const server = app.listen(PORT, () => {
  logger.info(`🚀 GridWise LLM server running`, {
    port: PORT,
    environment: config.NODE_ENV,
    llmProvider: config.LLM_PROVIDER,
    model: config.GEMINI_MODEL,
  });
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`Optimize:     POST http://localhost:${PORT}/optimize-energy`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function gracefulShutdown(signal: string): void {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    logger.info("Server closed. Exiting.");
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    logger.error("Forced exit after timeout");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ─── Uncaught Error Handlers ─────────────────────────────────────────────────

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", {
    reason: String(reason),
  });
  process.exit(1);
});
