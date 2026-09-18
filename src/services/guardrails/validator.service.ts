/**
 * GridWise LLM — Validator Service
 *
 * Schema & invariant validation for LLM-extracted directives.
 * Implements Check A (Syntactic Audit) from the two-phase pipeline.
 * Validates each directive against its Zod schema and structural invariants.
 */

import type { DirectiveInterpretation } from "../../types/domain.types.js";
import {
  DirectiveSchemaMap,
  SolarReductionSchema,
  MinimumBatteryReserveSchema,
  WindowSchema,
  MaxGridWindowSchema,
} from "../../schemas/directive.schema.js";
import { logger } from "../../utils/logger.js";

/** Validation result for a single directive. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a single directive interpretation against structural rules and Zod schemas.
 */
function validateDirective(
  directive: DirectiveInterpretation,
  expectedIndex: number,
  totalNotes: number
): ValidationResult {
  const errors: string[] = [];

  // Check A.1: note_index must match expected sequential index
  if (directive.note_index !== expectedIndex) {
    errors.push(
      `note_index is ${directive.note_index}, expected ${expectedIndex}`
    );
  }

  // Check A.2: applies / no_op consistency
  if (directive.directive_type === "no_op") {
    if (directive.applies !== false) {
      errors.push("no_op directive must have applies = false");
    }
    if (directive.structured_adjustment !== null) {
      errors.push("no_op directive must have structured_adjustment = null");
    }
    // no_op passes — no schema to validate
    return { valid: errors.length === 0, errors };
  }

  // For non-no_op directives
  if (directive.applies !== true) {
    errors.push(
      `Non-no_op directive (${directive.directive_type}) must have applies = true`
    );
  }

  if (directive.structured_adjustment === null) {
    errors.push(
      `Non-no_op directive (${directive.directive_type}) must have non-null structured_adjustment`
    );
    return { valid: false, errors };
  }

  // Check A.3: directive_type must be a known type
  const knownTypes = Object.keys(DirectiveSchemaMap);
  if (!knownTypes.includes(directive.directive_type)) {
    errors.push(
      `Unknown directive_type: "${directive.directive_type}". Supported: ${knownTypes.join(", ")}`
    );
    return { valid: false, errors };
  }

  // Check A.4: Validate structured_adjustment against the type-specific Zod schema
  let schema;
  switch (directive.directive_type) {
    case "solar_reduction":
      schema = SolarReductionSchema;
      break;
    case "minimum_battery_reserve":
      schema = MinimumBatteryReserveSchema;
      break;
    case "no_charge_window":
    case "no_discharge_window":
      schema = WindowSchema;
      break;
    case "max_grid_window":
      schema = MaxGridWindowSchema;
      break;
    default:
      errors.push(`No schema defined for directive_type: "${directive.directive_type}"`);
      return { valid: false, errors };
  }

  const parsed = schema.safeParse(directive.structured_adjustment);
  if (!parsed.success) {
    const zodErrors = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );
    errors.push(
      `Schema validation failed for ${directive.directive_type}: ${zodErrors.join("; ")}`
    );
  }

  // Check A.5: explanation must be non-empty
  if (!directive.explanation || directive.explanation.trim().length === 0) {
    errors.push("explanation must be a non-empty string");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate all directive interpretations.
 * Returns true if all pass, false with aggregated errors otherwise.
 *
 * @param directives - Post-guardrail directive interpretations
 * @param noteCount - Expected number of operator notes
 */
export function validateDirectives(
  directives: DirectiveInterpretation[],
  noteCount: number
): { valid: boolean; allErrors: Array<{ noteIndex: number; errors: string[] }> } {
  const allErrors: Array<{ noteIndex: number; errors: string[] }> = [];

  // Check: array length must match note count
  if (directives.length !== noteCount) {
    logger.error("Validator: directive count mismatch", {
      expected: noteCount,
      received: directives.length,
    });
    return {
      valid: false,
      allErrors: [
        {
          noteIndex: -1,
          errors: [
            `Expected ${noteCount} directive(s), got ${directives.length}`,
          ],
        },
      ],
    };
  }

  let allValid = true;

  for (let i = 0; i < directives.length; i++) {
    const directive = directives[i]!;
    const result = validateDirective(directive, i, noteCount);
    if (!result.valid) {
      allValid = false;
      allErrors.push({ noteIndex: i, errors: result.errors });
      logger.warn("Validator: directive validation failed", {
        noteIndex: i,
        errors: result.errors,
      });
    }
  }

  if (allValid) {
    logger.info("Validator: all directives passed validation");
  }

  return { valid: allValid, allErrors };
}
