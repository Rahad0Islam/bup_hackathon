/**
 * GridWise LLM — Guardrail Service
 *
 * Deterministic sanitization pipeline applied post-LLM and post-verification.
 * Performs Check C: deduplication, clamping, normalization of all directive parameters.
 */

import type {
  DirectiveInterpretation,
  BatterySpec,
  StructuredAdjustment,
} from "../../types/domain.types.js"
import { logger } from "../../utils/logger.js";

/**
 * Sanitize and normalize a single directive interpretation.  
 * This is the final deterministic pass before the optimizer receives the directives.
 */
function sanitizeDirective(
  directive: DirectiveInterpretation,
  battery: BatterySpec
): DirectiveInterpretation {
  const result = { ...directive };

  // Rule: no_op must have applies=false and structured_adjustment=null
  if (result.directive_type === "no_op") {
    result.applies = false;
    result.structured_adjustment = null;
    return result;
  }

  // Rule: all non-no_op directives must have applies=true
  result.applies = true;

  if (!result.structured_adjustment) {
    // Non-no_op with null adjustment — can't fix deterministically, leave as-is
    // The validator will catch this
    return result;
  }

  const adj = result.structured_adjustment as unknown as Record<string, unknown>;

  // Sanitize hours array (present in all non-no_op directives)
  if ("hours" in adj && Array.isArray(adj.hours)) {
    let hours = (adj.hours as unknown[])
      .map(Number)
      .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
    // Deduplicate
    hours = [...new Set(hours)];
    // Sort ascending
    hours.sort((a, b) => a - b);
    adj.hours = hours;
  }

  // Type-specific clamping
  switch (result.directive_type) {
    case "solar_reduction": {
      // Clamp factor to [0.0, 1.0]
      if ("factor" in adj) {
        adj.factor = Math.max(0, Math.min(1, Number(adj.factor) || 0));
      }
      break;
    }

    case "minimum_battery_reserve": {
      // Clamp minimum_energy_kwh to [battery.minimum_energy_kwh, battery.capacity_kwh]
      if ("minimum_energy_kwh" in adj) {
        const val = Number(adj.minimum_energy_kwh) || 0;
        adj.minimum_energy_kwh = Math.max(
          battery.minimum_energy_kwh,
          Math.min(battery.capacity_kwh, val)
        );
      }
      break;
    }

    case "max_grid_window": {
      // Clamp max_grid_kwh >= 0
      if ("max_grid_kwh" in adj) {
        adj.max_grid_kwh = Math.max(0, Number(adj.max_grid_kwh) || 0);
      }
      break;
    }

    case "no_charge_window":
    case "no_discharge_window":
      // No additional numeric fields to clamp
      break;
  }

  result.structured_adjustment = adj as unknown as StructuredAdjustment;
  return result;
}

/**
 * Apply deterministic sanitization to all directive interpretations.
 *
 * @param directives - Raw LLM-extracted + verified directives
 * @param battery - Battery spec for clamping ranges
 * @returns Sanitized directives ready for the optimizer
 */
export function sanitizeDirectives(
  directives: DirectiveInterpretation[],
  battery: BatterySpec
): DirectiveInterpretation[] {
  logger.info("Guardrail: Sanitizing directives", {
    count: directives.length,
  });

  const sanitized = directives.map((d) => sanitizeDirective(d, battery));

  // Ensure sequential note_index assignment (0 .. N-1)
  sanitized.forEach((d, i) => {
    d.note_index = i;
  });

  logger.info("Guardrail: Sanitization complete", {
    count: sanitized.length,
  });

  return sanitized;
}
