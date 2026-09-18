/**
 * GridWise LLM — Request Schema
 *
 * Zod validation schema for the incoming POST /optimize-energy request body.
 * Enforces exactly 24 unique hours (0-23), valid battery specs, and 1-3 operator notes.
 */

import { z } from "zod/v4";

/** Single hour entry in the scenario. */
const HourDataSchema = z.object({
  hour: z.number().int().min(0).max(23),
  demand_kwh: z.number().nonnegative(),
  solar_kwh: z.number().nonnegative(),
  tariff_bdt_per_kwh: z.number().nonnegative(),
});

/** Battery energy storage system specification. */
const BatterySpecSchema = z.object({
  capacity_kwh: z.number().positive(),
  initial_energy_kwh: z.number().nonnegative(),
  minimum_energy_kwh: z.number().nonnegative(),
  max_charge_kwh_per_hour: z.number().nonnegative(),
  max_discharge_kwh_per_hour: z.number().nonnegative(),
});

/** Full request body for POST /optimize-energy. */
export const ScenarioInputSchema = z
  .object({
    scenario_id: z.string().min(1),
    operator_notes: z
      .array(z.string().min(1))
      .min(1)
      .max(3),
    hours: z
      .array(HourDataSchema)
      .length(24),
    battery: BatterySpecSchema,
  })
  .refine(
    (data) => {
      // Verify all 24 unique hours 0-23 are present
      const hourSet = new Set(data.hours.map((h) => h.hour));
      if (hourSet.size !== 24) return false;
      for (let i = 0; i < 24; i++) {
        if (!hourSet.has(i)) return false;
      }
      return true;
    },
    { message: "hours must contain exactly 24 unique entries for hours 0 through 23" }
  )
  .refine(
    (data) => {
      // initial_energy must be within [minimum, capacity]
      return (
        data.battery.initial_energy_kwh >= data.battery.minimum_energy_kwh &&
        data.battery.initial_energy_kwh <= data.battery.capacity_kwh
      );
    },
    { message: "initial_energy_kwh must be between minimum_energy_kwh and capacity_kwh" }
  );

export type ScenarioInputParsed = z.infer<typeof ScenarioInputSchema>;
