/**
 * GridWise LLM — Directive Schemas
 *
 * Internal Zod schemas for each directive type's structured_adjustment.
 * Used by the guardrail/validator layer to verify LLM output conformity.
 */

import { z } from "zod/v4";

/** solar_reduction: reduce usable solar during specific hours. */
export const SolarReductionSchema = z.object({
  hours: z.array(z.number().int().min(0).max(23)).min(1),
  factor: z.number().min(0).max(1),
});

/** minimum_battery_reserve: keep battery at or above a required level. */
export const MinimumBatteryReserveSchema = z.object({
  hours: z.array(z.number().int().min(0).max(23)).min(1),
  minimum_energy_kwh: z.number().positive(),
});

/** no_charge_window / no_discharge_window: block charge or discharge. */
export const WindowSchema = z.object({
  hours: z.array(z.number().int().min(0).max(23)).min(1),
});

/** max_grid_window: cap grid import during specific hours. */
export const MaxGridWindowSchema = z.object({
  hours: z.array(z.number().int().min(0).max(23)).min(1),
  max_grid_kwh: z.number().nonnegative(),
});

/**
 * Map of directive type to its expected schema.
 * no_op has no structured_adjustment (must be null).
 */
export const DirectiveSchemaMap: Record<
  string,
  z.ZodType | null
> = {
  solar_reduction: SolarReductionSchema,
  minimum_battery_reserve: MinimumBatteryReserveSchema,
  no_charge_window: WindowSchema,
  no_discharge_window: WindowSchema,
  max_grid_window: MaxGridWindowSchema,
  no_op: null, // structured_adjustment must be null
};
