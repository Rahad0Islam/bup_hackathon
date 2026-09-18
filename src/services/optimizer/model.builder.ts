/**
 * GridWise LLM — LP Model Builder
 *
 * Builds the Linear Programming formulation for the 24-hour energy dispatch
 * problem using `javascript-lp-solver` format.
 *
 * Decision Variables (per hour h = 0..23):
 *   grid_h, solar_used_h, charge_h, discharge_h, battery_energy_after_h
 *
 * Constraints:
 *   1. Energy balance: grid_h + solar_used_h + discharge_h - charge_h = demand_h
 *   2. Solar cap: solar_used_h <= effective_solar_h
 *   3. Charge/discharge rate limits + window blocks
 *   4. Grid cap windows
 *   5. Battery dynamic balance (linking hours)
 *   6. Battery energy bounds
 *   7. End-of-day neutrality: battery_energy_after_23 = initial_energy_kwh
 *
 * Objective: Minimize SUM(grid_h * tariff_h)
 */

import type {
  HourData,
  BatterySpec,
  DirectiveInterpretation,
  HourConstraints,
} from "../../types/domain.types.js";
import { logger } from "../../utils/logger.js";

/**
 * Compute per-hour constraints by applying all applicable directives
 * to the base scenario data.
 */
export function computeHourConstraints(
  hours: HourData[],
  battery: BatterySpec,
  directives: DirectiveInterpretation[]
): HourConstraints[] {
  // Sort hours by hour number for consistent indexing
  const sorted = [...hours].sort((a, b) => a.hour - b.hour);

  // Initialize base constraints
  const constraints: HourConstraints[] = sorted.map((h) => ({
    effective_solar_kwh: h.solar_kwh,
    min_battery_energy_kwh: battery.minimum_energy_kwh,
    max_charge_kwh: battery.max_charge_kwh_per_hour,
    max_discharge_kwh: battery.max_discharge_kwh_per_hour,
    max_grid_kwh: Infinity,
  }));

  // Apply each directive to modify constraints
  for (const d of directives) {
    if (!d.applies || d.directive_type === "no_op" || !d.structured_adjustment) {
      continue;
    }

    const adj = d.structured_adjustment as Record<string, unknown>;
    const dHours = (adj.hours as number[]) ?? [];

    switch (d.directive_type) {
      case "solar_reduction": {
        const factor = adj.factor as number;
        for (const h of dHours) {
          if (h >= 0 && h <= 23) {
            constraints[h]!.effective_solar_kwh =
              sorted[h]!.solar_kwh * factor;
          }
        }
        break;
      }

      case "minimum_battery_reserve": {
        const reserve = adj.minimum_energy_kwh as number;
        for (const h of dHours) {
          if (h >= 0 && h <= 23) {
            // Take the max of base minimum and directive reserve
            constraints[h]!.min_battery_energy_kwh = Math.max(
              constraints[h]!.min_battery_energy_kwh,
              reserve
            );
          }
        }
        break;
      }

      case "no_charge_window": {
        for (const h of dHours) {
          if (h >= 0 && h <= 23) {
            constraints[h]!.max_charge_kwh = 0;
          }
        }
        break;
      }

      case "no_discharge_window": {
        for (const h of dHours) {
          if (h >= 0 && h <= 23) {
            constraints[h]!.max_discharge_kwh = 0;
          }
        }
        break;
      }

      case "max_grid_window": {
        const cap = adj.max_grid_kwh as number;
        for (const h of dHours) {
          if (h >= 0 && h <= 23) {
            constraints[h]!.max_grid_kwh = Math.min(
              constraints[h]!.max_grid_kwh,
              cap
            );
          }
        }
        break;
      }
    }
  }

  return constraints;
}

/**
 * Build the LP model in javascript-lp-solver format.
 *
 * The model uses the "constraints → variables → optimize" format:
 * - Each constraint name maps to { min, max, equal }
 * - Each variable maps to its coefficients + cost contribution
 */
export function buildLPModel(
  hours: HourData[],
  battery: BatterySpec,
  hourConstraints: HourConstraints[]
): Record<string, unknown> {
  const sorted = [...hours].sort((a, b) => a.hour - b.hour);

  const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {};
  const variables: Record<string, Record<string, number>> = {};

  // Variable naming: grid_0 .. grid_23, solar_0, charge_0, discharge_0, batt_0
  for (let h = 0; h < 24; h++) {
    const hourData = sorted[h]!;
    const hc = hourConstraints[h]!;

    const gridVar = `grid_${h}`;
    const solarVar = `solar_${h}`;
    const chargeVar = `charge_${h}`;
    const dischargeVar = `discharge_${h}`;
    const battVar = `batt_${h}`;

    // ────────── Constraint 1: Energy Balance ──────────
    // grid_h + solar_h + discharge_h - charge_h = demand_h
    const balanceName = `balance_${h}`;
    constraints[balanceName] = { equal: hourData.demand_kwh };

    // ────────── Constraint 2: Solar Cap ──────────
    const solarCapName = `solar_cap_${h}`;
    constraints[solarCapName] = { max: hc.effective_solar_kwh };

    // ────────── Constraint 3: Charge Rate Limit ──────────
    const chargeCapName = `charge_cap_${h}`;
    constraints[chargeCapName] = { max: hc.max_charge_kwh };

    // ────────── Constraint 4: Discharge Rate Limit ──────────
    const dischargeCapName = `discharge_cap_${h}`;
    constraints[dischargeCapName] = { max: hc.max_discharge_kwh };

    // ────────── Constraint 5: Grid Cap ──────────
    if (hc.max_grid_kwh !== Infinity) {
      const gridCapName = `grid_cap_${h}`;
      constraints[gridCapName] = { max: hc.max_grid_kwh };
      // grid variable participates in this constraint
      if (!variables[gridVar]) variables[gridVar] = {};
      variables[gridVar]![gridCapName] = 1;
    }

    // ────────── Constraint 6: Battery Energy Bounds ──────────
    const battMinName = `batt_min_${h}`;
    const battMaxName = `batt_max_${h}`;
    constraints[battMinName] = { min: hc.min_battery_energy_kwh };
    constraints[battMaxName] = { max: battery.capacity_kwh };

    // ────────── Constraint 7: Battery Dynamic Balance ──────────
    // batt_h = batt_{h-1} + charge_h - discharge_h
    // Rewritten: batt_h - charge_h + discharge_h = batt_{h-1}  (or initial for h=0)
    const dynName = `dyn_${h}`;
    const prevEnergy = h === 0 ? battery.initial_energy_kwh : 0; // handled via prev var
    constraints[dynName] = { equal: h === 0 ? battery.initial_energy_kwh : 0 };

    // ────────── Build variable coefficient maps ──────────

    // grid_h: participates in balance, objective cost
    if (!variables[gridVar]) variables[gridVar] = {};
    variables[gridVar]![balanceName] = 1;
    variables[gridVar]!["cost"] = hourData.tariff_bdt_per_kwh;

    // solar_h: participates in balance, solar cap
    if (!variables[solarVar]) variables[solarVar] = {};
    variables[solarVar]![balanceName] = 1;
    variables[solarVar]![solarCapName] = 1;

    // charge_h: participates in balance (negative), charge cap, dynamic balance
    if (!variables[chargeVar]) variables[chargeVar] = {};
    variables[chargeVar]![balanceName] = -1; // consumes energy from supply side
    variables[chargeVar]![chargeCapName] = 1;
    variables[chargeVar]![dynName] = -1; // negative because: batt - charge = prev → batt = prev + charge

    // discharge_h: participates in balance, discharge cap, dynamic balance
    if (!variables[dischargeVar]) variables[dischargeVar] = {};
    variables[dischargeVar]![balanceName] = 1; // provides energy
    variables[dischargeVar]![dischargeCapName] = 1;
    variables[dischargeVar]![dynName] = 1; // positive because: batt + discharge = prev → batt = prev - discharge

    // batt_h: participates in dynamic balance, battery bounds
    if (!variables[battVar]) variables[battVar] = {};
    variables[battVar]![dynName] = 1; // batt_h coefficient in dynamic equation
    variables[battVar]![battMinName] = 1;
    variables[battVar]![battMaxName] = 1;

    // Link to previous hour: batt_{h-1} coefficient in dyn_h
    if (h > 0) {
      const prevBattVar = `batt_${h - 1}`;
      if (!variables[prevBattVar]) variables[prevBattVar] = {};
      variables[prevBattVar]![dynName] = -1; // batt_h - batt_{h-1} = charge_h - discharge_h
    }
  }

  // ────────── Constraint 8: End-of-day Battery Neutrality ──────────
  // batt_23 = initial_energy_kwh
  const neutralityName = "neutrality";
  constraints[neutralityName] = { equal: battery.initial_energy_kwh };
  if (!variables["batt_23"]) variables["batt_23"] = {};
  variables["batt_23"]![neutralityName] = 1;

  // All variables are non-negative by default in javascript-lp-solver
  // (it uses the "int" key for integers, but we want continuous)

  const model = {
    optimize: "cost",
    opType: "min",
    constraints,
    variables,
  };

  logger.debug("LP model built", {
    constraintCount: Object.keys(constraints).length,
    variableCount: Object.keys(variables).length,
  });

  return model;
}
