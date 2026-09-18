/**
 * GridWise LLM — Express App Assembly
 *
 * Configures middleware, mounts routes, and sets up error handling.
 * The error handler sanitizes all responses to prevent credential/stack trace leakage.
 */

import express from "express";
import type { Application, Request, Response, NextFunction } from "express";
import cors from "cors";
import apiRoutes from "./routes/api.routes.js";
import { AppError, ValidationError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";
import config from "./config/config.js";

const app: Application = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.debug("Incoming request", {
    method: req.method,
    url: req.url,
    ip: req.ip,
  });
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use("/", apiRoutes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: "Not Found",
    message: "The requested endpoint does not exist.",
  });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
// CRITICAL: Never leak API keys, stack traces, or internal details in responses.

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Log the full error internally
  logger.error("Unhandled error", {
    message: err.message,
    stack: err.stack,
    name: err.name,
  });

  // Determine status code and response message
  if (err instanceof AppError) {
    const body: Record<string, unknown> = {
      error: err.name,
      message: err.message,
    };

    // Include validation details for 400 errors
    if (err instanceof ValidationError && err.details) {
      body.details = err.details;
    }

    res.status(err.statusCode).json(body);
    return;
  }

  // Unknown errors — sanitize completely
  const isProduction = config.NODE_ENV === "production";
  res.status(500).json({
    error: "Internal Server Error",
    message: isProduction
      ? "An unexpected error occurred. Please try again."
      : err.message,
  });
});

export default app;
