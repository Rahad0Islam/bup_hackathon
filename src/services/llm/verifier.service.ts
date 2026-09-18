/**
 * GridWise LLM — Phase 2: LLM Self-Audit Verifier Service
 *
 * Performs a secondary LLM verification pass on questionable extractions.
 * This is Check B (Semantic Verification) from the two-phase pipeline.
 *
 * When deterministic checks in the guardrail/validator layer flag issues
 * (e.g., ambiguous factor values, empty hours for non-no_op), this service
 * re-queries the LLM with a focused critique prompt for self-correction.
 */

import { callLLM } from "./llm.client.js";
import { logger } from "../../utils/logger.js";
import type { DirectiveInterpretation, BatterySpec } from "../../types/domain.types.js";

/**
 * Run a secondary LLM verification pass on a specific directive interpretation
 * that was flagged as questionable.
 *
 * @param originalNote - The original operator note text
 * @param extraction - The Phase 1 extraction result
 * @param issueDescription - What was flagged (e.g., "factor may be inverted")
 * @param batterySpec - Battery spec for percentage calculations
 * @returns Corrected interpretation, or the original if the LLM confirms it
 */
export async function verifyAndCorrect(
  originalNote: string,
  extraction: DirectiveInterpretation,
  issueDescription: string,
  batterySpec: BatterySpec
): Promise<DirectiveInterpretation> {
  logger.info("Phase 2: Running LLM self-audit", {
    noteIndex: extraction.note_index,
    issue: issueDescription,
  });

  const systemPrompt = `You are a quality auditor for energy operator-note interpretation.

You are reviewing an extracted directive interpretation that may contain an error.

CRITICAL RULES:
- For solar_reduction, "factor" is the REMAINING usable fraction, NOT the reduction amount.
  "Drop by 80%" → factor = 0.2 (20% remains)
  "Reduced to 25%" → factor = 0.25
  "About one-fifth remains" → factor = 0.2

- For minimum_battery_reserve with percentage: compute absolute kWh from capacity.
  Battery capacity = ${batterySpec.capacity_kwh} kWh.
  "50% of capacity" → minimum_energy_kwh = ${batterySpec.capacity_kwh * 0.5}

- Time windows: start-inclusive, end-exclusive.
  "1 PM to 3 PM" → [13, 14]
  "6 PM until 9 PM" → [18, 19, 20]

- Hours must be unique integers 0-23 in ascending order.
- no_op must have applies=false and structured_adjustment=null.
- All other directives must have applies=true.

Return ONLY the corrected JSON object (not an array).`;

  const userPrompt = `Original operator note: "${originalNote}"

Current extraction:
${JSON.stringify(extraction, null, 2)}

Issue flagged: ${issueDescription}

Please verify and return the corrected interpretation as a single JSON object with fields: note_index, applies, directive_type, structured_adjustment, explanation.`;

  try {
    const response = await callLLM({
      systemPrompt,
      userPrompt,
      jsonMode: true,
    });

    const corrected = JSON.parse(response.text) as DirectiveInterpretation;

    // Preserve the original note_index
    corrected.note_index = extraction.note_index;

    logger.info("Phase 2: Self-audit correction applied", {
      noteIndex: extraction.note_index,
      originalType: extraction.directive_type,
      correctedType: corrected.directive_type,
    });

    return corrected;
  } catch (err) {
    // If the self-audit fails, fall back to the original extraction
    logger.warn("Phase 2: Self-audit failed, keeping original extraction", {
      noteIndex: extraction.note_index,
      error: err instanceof Error ? err.message : String(err),
    });
    return extraction;
  }
}

/**
 * Check if an extraction has semantic issues that warrant a self-audit.
 * Returns a description of the issue, or null if no issues found.
 */
export function detectSemanticIssues(
  note: string,
  extraction: DirectiveInterpretation
): string | null {
  const { directive_type, structured_adjustment, applies } = extraction;

  // Check 1: no_op consistency
  if (directive_type === "no_op" && applies) {
    return "no_op directive has applies=true; should be false";
  }
  if (directive_type !== "no_op" && !applies) {
    return `Non-no_op directive (${directive_type}) has applies=false; should be true`;
  }

  // Check 2: non-no_op with null adjustment
  if (directive_type !== "no_op" && structured_adjustment === null) {
    return `${directive_type} has null structured_adjustment; must have valid adjustment`;
  }

  // Check 3: solar_reduction factor sanity
  if (directive_type === "solar_reduction" && structured_adjustment) {
    const adj = structured_adjustment as { factor?: number; hours?: number[] };

    // If factor > 0.5 and note mentions "reduction" or "drop", it might be inverted
    if (adj.factor !== undefined && adj.factor > 0.5) {
      const noteLower = note.toLowerCase();
      if (
        noteLower.includes("reduction") ||
        noteLower.includes("drop") ||
        noteLower.includes("decrease") ||
        noteLower.includes("reduce")
      ) {
        // Check if the note mentions a specific percentage
        const percentMatch = noteLower.match(/(\d+)\s*%/);
        if (percentMatch) {
          const pct = Number(percentMatch[1]);
          if (pct > 50 && adj.factor > 0.5) {
            return `Solar factor ${adj.factor} may be inverted — note mentions ${pct}% reduction, so factor should likely be ${(1 - pct / 100).toFixed(2)}`;
          }
        }
      }
    }

    // Empty hours for solar_reduction
    if (!adj.hours || adj.hours.length === 0) {
      return "solar_reduction has empty hours array";
    }
  }

  // Check 4: minimum_battery_reserve sanity
  if (directive_type === "minimum_battery_reserve" && structured_adjustment) {
    const adj = structured_adjustment as { minimum_energy_kwh?: number; hours?: number[] };
    if (!adj.hours || adj.hours.length === 0) {
      return "minimum_battery_reserve has empty hours array";
    }
    if (adj.minimum_energy_kwh !== undefined && adj.minimum_energy_kwh <= 0) {
      return "minimum_battery_reserve has non-positive minimum_energy_kwh";
    }
  }

  // Check 5: window directives with empty hours
  if (
    (directive_type === "no_charge_window" ||
      directive_type === "no_discharge_window" ||
      directive_type === "max_grid_window") &&
    structured_adjustment
  ) {
    const adj = structured_adjustment as { hours?: number[] };
    if (!adj.hours || adj.hours.length === 0) {
      return `${directive_type} has empty hours array`;
    }
  }

  return null;
}
