/**
 * GridWise LLM — API Routes
 *
 * Route declarations for the GridWise energy optimization API.
 * Exactly two endpoints as required by the judge harness:
 *   - GET /health
 *   - POST /optimize-energy
 */

import { Router } from "express";
import { healthCheck } from "../controllers/health.controller.js";
import { optimizeEnergy } from "../controllers/energy.controller.js";

const router = Router();

/** GET /health — Returns { "status": "ok" } when the service is ready. */
router.get("/health", healthCheck);

/** POST /optimize-energy — Accepts a scenario and returns the optimized plan. */
router.post("/optimize-energy", optimizeEnergy);

export default router;
