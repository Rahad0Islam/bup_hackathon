/**
 * GridWise LLM — Health Controller
 *
 * Simple health check endpoint for the judge harness.
 * GET /health → { "status": "ok" }
 */

import type { Request, Response } from "express";

/**
 * Health check handler.
 * Returns 200 OK when the service is ready to accept requests.
 */
export function healthCheck(_req: Request, res: Response): void {
  res.status(200).json({ status: "ok" });
}
