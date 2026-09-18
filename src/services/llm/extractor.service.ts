/**
 * GridWise LLM — Phase 1: LLM Structured Extraction Service
 *
 * Sends operator notes to the LLM with a detailed system prompt and few-shot
 * examples for all 6 directive types. Uses JSON mode to extract structured
 * directive interpretations.
 */

import { callLLM } from "./llm.client.js";
import { logger } from "../../utils/logger.js";
import { LLMError } from "../../utils/errors.js";
import type { BatterySpec, DirectiveInterpretation } from "../../types/domain.types.js";

/**
 * Build the system prompt with few-shot examples for all 6 directive types.
 */
function buildSystemPrompt(batterySpec: BatterySpec): string {
  return `You are an expert energy systems operator-note interpreter for a smart campus.

TASK: Given a list of operator notes and battery specifications, classify each note into exactly one of these directive types and extract its structured parameters.

SUPPORTED DIRECTIVE TYPES:
1. solar_reduction — Reduce usable solar during specific hours.
   structured_adjustment: {"hours": [integers 0-23], "factor": number}
   CRITICAL: "factor" is the REMAINING usable fraction, NOT the reduction percentage.
   - "Drop by 80%" → factor = 0.2 (only 20% remains)
   - "Reduced to 25%" → factor = 0.25
   - "Drop to about 20%" → factor = 0.2

2. minimum_battery_reserve — Keep battery energy at or above a required level during specific hours.
   structured_adjustment: {"hours": [integers 0-23], "minimum_energy_kwh": number}
   If the note says a percentage of capacity, compute the absolute kWh.
   Battery capacity is ${batterySpec.capacity_kwh} kWh.
   - "50% of capacity" → minimum_energy_kwh = ${batterySpec.capacity_kwh * 0.5}
   - "at least 120 kWh" → minimum_energy_kwh = 120

3. no_charge_window — Battery charging is unavailable during specific hours.
   structured_adjustment: {"hours": [integers 0-23]}

4. no_discharge_window — Battery discharging is unavailable during specific hours.
   structured_adjustment: {"hours": [integers 0-23]}

5. max_grid_window — Grid import may not exceed a stated amount during specific hours.
   structured_adjustment: {"hours": [integers 0-23], "max_grid_kwh": number}

6. no_op — The note does NOT affect today's 24-hour energy schedule (irrelevant/distractor).
   structured_adjustment: null

TIME CONVENTION:
- Use WHOLE-HOUR intervals. Start hour is INCLUDED, end hour is EXCLUDED.
- "1 PM to 3 PM" → hours [13, 14]
- "noon until 2 PM" → hours [12, 13]
- "2 AM until 5 AM" → hours [2, 3, 4]
- "6 PM until 9 PM" → hours [18, 19, 20]
- "6 PM until 8 PM" → hours [18, 19]
- Hours must be unique integers from 0 through 23, sorted ascending.

RULES:
- Return EXACTLY one interpretation per note, in order (note_index 0, 1, ...).
- For no_op: applies = false, directive_type = "no_op", structured_adjustment = null.
- For ALL other directives: applies = true.
- Do NOT invent new directive types, demand, solar, tariff, or battery values.
- Do NOT add notes that don't exist.
- If a note talks about future events, different departments, menus, schedules unrelated to today's energy/battery/solar/grid, mark it as no_op.

FEW-SHOT EXAMPLES:

Note: "Solar output will drop to about 20% from 1 PM to 3 PM."
→ {"note_index":0,"applies":true,"directive_type":"solar_reduction","structured_adjustment":{"hours":[13,14],"factor":0.2},"explanation":"Solar availability is reduced to 20% during the stated window."}

Note: "Expect an 80% reduction in rooftop solar during the 1-3 PM maintenance window."
→ {"note_index":0,"applies":true,"directive_type":"solar_reduction","structured_adjustment":{"hours":[13,14],"factor":0.2},"explanation":"80% reduction means only 20% of solar remains usable."}

Note: "Do not charge the battery between 2 PM and 4 PM."
→ {"note_index":0,"applies":true,"directive_type":"no_charge_window","structured_adjustment":{"hours":[14,15]},"explanation":"Battery charging is unavailable during the stated window."}

Note: "The battery charger will be isolated from 2 AM until 5 AM for electrical maintenance."
→ {"note_index":0,"applies":true,"directive_type":"no_charge_window","structured_adjustment":{"hours":[2,3,4]},"explanation":"Battery charging is unavailable during maintenance."}

Note: "Keep at least 120 kWh in reserve from 6 PM until 9 PM."
→ {"note_index":0,"applies":true,"directive_type":"minimum_battery_reserve","structured_adjustment":{"hours":[18,19,20],"minimum_energy_kwh":120},"explanation":"Battery energy must remain at or above 120 kWh during the window."}

Note: "Keep at least 50% of the battery capacity stored from 6 PM until 9 PM for emergency operations."
→ {"note_index":0,"applies":true,"directive_type":"minimum_battery_reserve","structured_adjustment":{"hours":[18,19,20],"minimum_energy_kwh":${batterySpec.capacity_kwh * 0.5}},"explanation":"50% of ${batterySpec.capacity_kwh} kWh capacity = ${batterySpec.capacity_kwh * 0.5} kWh reserve required."}

Note: "For protection testing, the battery must not discharge from 6 PM until 8 PM."
→ {"note_index":0,"applies":true,"directive_type":"no_discharge_window","structured_adjustment":{"hours":[18,19]},"explanation":"Battery discharge is disabled during the protection-test window."}

Note: "Limit grid import to no more than 150 kWh per hour from 6 PM to 10 PM."
→ {"note_index":0,"applies":true,"directive_type":"max_grid_window","structured_adjustment":{"hours":[18,19,20,21],"max_grid_kwh":150},"explanation":"Grid import is capped at 150 kWh per hour during the evening window."}

Note: "The cafeteria menu changes tomorrow."
→ {"note_index":0,"applies":false,"directive_type":"no_op","structured_adjustment":null,"explanation":"This note does not affect today's 24-hour energy schedule."}

Note: "The sports office moved next month's registration deadline."
→ {"note_index":0,"applies":false,"directive_type":"no_op","structured_adjustment":null,"explanation":"This note does not affect today's energy schedule."}

OUTPUT FORMAT:
Return a JSON array of interpretation objects, one per note.
Each object must have: note_index, applies, directive_type, structured_adjustment, explanation.`;
}

/**
 * Build the user prompt containing the actual operator notes.
 */
function buildUserPrompt(notes: string[]): string {
  const noteList = notes
    .map((note, i) => `Note ${i}: "${note}"`)
    .join("\n");

  return `Interpret the following ${notes.length} operator note(s). Return a JSON array with exactly ${notes.length} interpretation object(s), one per note, in note_index order (0, 1, ...).

${noteList}

Return ONLY the JSON array, no other text.`;
}

/**
 * Phase 1: Extract directive interpretations from operator notes via LLM.
 *
 * @param notes - Array of 1-3 operator notes
 * @param batterySpec - Battery specification (needed for percentage calculations)
 * @returns Raw LLM-extracted directive interpretations (not yet validated)
 */
export async function extractDirectives(
  notes: string[],
  batterySpec: BatterySpec
): Promise<DirectiveInterpretation[]> {
  const systemPrompt = buildSystemPrompt(batterySpec);
  const userPrompt = buildUserPrompt(notes);

  logger.info("Phase 1: Extracting directives via LLM", {
    noteCount: notes.length,
  });

  const response = await callLLM({
    systemPrompt,
    userPrompt,
    jsonMode: true,
  });

  // Parse the JSON response
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    logger.error("LLM returned invalid JSON", { text: response.text.slice(0, 500) });
    throw new LLMError("LLM returned invalid JSON for directive extraction");
  }

  // Expect an array
  if (!Array.isArray(parsed)) {
    // Sometimes LLM wraps in an object like { "interpretations": [...] }
    const obj = parsed as Record<string, unknown>;
    const possibleArray = obj.interpretations ?? obj.directive_interpretation ?? obj.directives ?? obj.results;
    if (Array.isArray(possibleArray)) {
      parsed = possibleArray;
    } else {
      throw new LLMError("LLM did not return an array of directive interpretations");
    }
  }

  logger.info("Phase 1: LLM extraction complete", {
    extractedCount: (parsed as unknown[]).length,
  });

  return parsed as DirectiveInterpretation[];
}
