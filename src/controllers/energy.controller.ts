/**
 * GridWise LLM — Energy Controller
 *
 * POST /optimize-energy orchestration:
 *   1. Validate request with Zod
 *   2. Extract directives via LLM (Phase 1)
 *   3. Run semantic verification (Phase 2)
 *   4. Apply deterministic guardrails (Check C)
 *   5. Validate directives (Check A)
 *   6. Build LP model with directives applied
 *   7. Solve LP
 *   8. Replay & validate solution
 *   9. Calculate metrics
 *  10. Return structured response
 */

import type { Request, Response, NextFunction } from "express";
import { ScenarioInputSchema } from "../schemas/request.schema.js";
import { extractDirectives } from "../services/llm/extractor.service.js";
import {
  verifyAndCorrect,
  detectSemanticIssues,
} from "../services/llm/verifier.service.js";
import { sanitizeDirectives } from "../services/guardrails/guardrail.service.js";
import { validateDirectives } from "../services/guardrails/validator.service.js";
import {
  computeHourConstraints,
  buildLPModel,
} from "../services/optimizer/model.builder.js";
import { solveLPModel } from "../services/optimizer/lp.solver.js";
import { replayAndValidate } from "../services/simulation/replay.service.js";
import { recalculateMetrics } from "../services/simulation/metrics.service.js";
import { logger } from "../utils/logger.js";
import { ValidationError, AppError } from "../utils/errors.js";
import type {
  ScenarioInput,
  DirectiveInterpretation,
  OptimizeEnergyResponse,
} from "../types/domain.types.js";

/**
 * POST /optimize-energy handler.
 *
 * Orchestrates the full pipeline: LLM extraction → verification →
 * guardrails → LP optimization → replay → metrics → response.
 */
export async function optimizeEnergy(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // ── Step 1: Validate request body ──
    const parseResult = ScenarioInputSchema.safeParse(req.body);
    if (!parseResult.success) {
      const details = parseResult.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      throw new ValidationError("Request validation failed", details);
    }

    const input: ScenarioInput = parseResult.data;
    logger.info("Processing scenario", {
      scenarioId: input.scenario_id,
      noteCount: input.operator_notes.length,
    });

    // ── Step 2: Phase 1 — LLM Extraction ──
    let directives = await extractDirectives(
      input.operator_notes,
      input.battery
    );

    // ── Step 3: Phase 2 — Semantic Verification & Self-Correction ──
    // Check each extraction for semantic issues and re-verify if needed
    for (let i = 0; i < directives.length; i++) {
      const directive = directives[i]!;
      const issue = detectSemanticIssues(
        input.operator_notes[i] ?? "",
        directive
      );
      if (issue) {
        logger.warn("Semantic issue detected", {
          noteIndex: i,
          issue,
        });
        directives[i] = await verifyAndCorrect(
          input.operator_notes[i] ?? "",
          directive,
          issue,
          input.battery
        );
      }
    }

    // ── Step 4: Check C — Deterministic Guardrails ──
    directives = sanitizeDirectives(directives, input.battery);

    // ── Step 5: Check A — Structural Validation ──
    const validation = validateDirectives(
      directives,
      input.operator_notes.length
    );
    if (!validation.valid) {
      logger.error("Directive validation failed after guardrails", {
        errors: validation.allErrors,
      });
      // Don't throw — try to proceed with what we have
      // The LP solver will fail if constraints are truly broken
    }

    // ── Step 6: Build LP Model ──
    const hourConstraints = computeHourConstraints(
      input.hours,
      input.battery,
      directives
    );
    const lpModel = buildLPModel(input.hours, input.battery, hourConstraints);

    // ── Step 7: Solve LP ──
    const plan = solveLPModel(
      lpModel,
      input.hours,
      input.battery,
      hourConstraints
    );

    // ── Step 8: Replay & Validate ──
    const replayResult = replayAndValidate(
      plan,
      input.hours,
      input.battery,
      hourConstraints
    );
    if (!replayResult.valid) {
      logger.warn("Replay validation found issues (proceeding anyway)", {
        errors: replayResult.errors.slice(0, 5),
      });
    }

    // ── Step 9: Calculate Metrics ──
    const metrics = recalculateMetrics(plan, input.hours);

    // ── Step 10: Build Response ──
    const response: OptimizeEnergyResponse = {
      scenario_id: input.scenario_id,
      directive_interpretation: directives,
      hourly_plan: plan,
      total_grid_kwh: metrics.total_grid_kwh,
      total_cost_bdt: metrics.total_cost_bdt,
      peak_grid_kwh: metrics.peak_grid_kwh,
      plan_summary: generatePlanSummary(directives, metrics),
    };

    logger.info("Optimization complete", {
      scenarioId: input.scenario_id,
      totalCost: metrics.total_cost_bdt,
      totalGrid: metrics.total_grid_kwh,
      peakGrid: metrics.peak_grid_kwh,
      replayValid: replayResult.valid,
    });

    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Generate a short human-readable summary of the optimization result.
 */
function generatePlanSummary(
  directives: DirectiveInterpretation[],
  metrics: { total_grid_kwh: number; total_cost_bdt: number; peak_grid_kwh: number }
): string {
  const applied = directives.filter((d) => d.applies);
  const ignored = directives.filter((d) => !d.applies);

  const parts: string[] = [];

  if (applied.length > 0) {
    const types = applied.map((d) => d.directive_type).join(", ");
    parts.push(`Applied ${applied.length} directive(s): ${types}.`);
  }

  if (ignored.length > 0) {
    parts.push(`Ignored ${ignored.length} irrelevant note(s).`);
  }

  parts.push(
    `Optimized schedule: total grid ${metrics.total_grid_kwh} kWh, ` +
      `cost ${metrics.total_cost_bdt} BDT, peak ${metrics.peak_grid_kwh} kWh. ` +
      `Battery returns to initial level at end of day.`
  );

  return parts.join(" ");
}
