/**
 * GridWise LLM — Response Schema
 *
 * Zod schema for validating the outgoing POST /optimize-energy response.
 * Used internally to sanity-check our own output before sending.
 */

import { z } from "zod/v4";

const DirectiveInterpretationSchema = z.object({
  note_index: z.number().int().nonnegative(),
  applies: z.boolean(),
  directive_type: z.enum([
    "solar_reduction",
    "minimum_battery_reserve",
    "no_charge_window",
    "no_discharge_window",
    "max_grid_window",
    "no_op",
  ]),
  structured_adjustment: z.nullable(z.record(z.string(), z.unknown())),
  explanation: z.string(),
});

const HourlyPlanEntrySchema = z.object({
  hour: z.number().int().min(0).max(23),
  grid_kwh: z.number().nonnegative(),
  solar_used_kwh: z.number().nonnegative(),
  battery_action: z.enum(["charge", "discharge", "idle"]),
  battery_kwh: z.number().nonnegative(),
  battery_energy_after_kwh: z.number().nonnegative(),
});

export const OptimizeEnergyResponseSchema = z.object({
  scenario_id: z.string(),
  directive_interpretation: z.array(DirectiveInterpretationSchema),
  hourly_plan: z.array(HourlyPlanEntrySchema).length(24),
  total_grid_kwh: z.number().nonnegative(),
  total_cost_bdt: z.number().nonnegative(),
  peak_grid_kwh: z.number().nonnegative(),
  plan_summary: z.string(),
});
