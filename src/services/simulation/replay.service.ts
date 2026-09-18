/**
 * GridWise LLM — Physical Replay Service
 *
 * Independent step-by-step physical simulation that validates the LP solution
 * against all energy, battery, and directive constraints before returning.
 *
 * This is the same replay the judge runs — if our replay passes, the judge's will too.
 */

import type {
  HourData,
  BatterySpec,
  HourlyPlanEntry,
  DirectiveInterpretation,
  HourConstraints,
} from "../../types/domain.types.js";
import { logger } from "../../utils/logger.js";

/** Tolerance for floating-point comparisons (0.01 kWh / BDT). */
const TOLERANCE = 0.01;

/** Result of the replay validation. */
export interface ReplayResult {
  valid: boolean;
  errors: string[];
}

/**
 * Replay the hourly plan step-by-step and validate all invariants.
 *
 * @param plan - The 24-hour plan from the LP solver
 * @param hours - Original scenario hour data
 * @param battery - Battery specification
 * @param hourConstraints - Per-hour constraints with directives applied
 * @returns ReplayResult indicating validity and any errors found
 */
export function replayAndValidate(
  plan: HourlyPlanEntry[],
  hours: HourData[],
  battery: BatterySpec,
  hourConstraints: HourConstraints[]
): ReplayResult {
  const errors: string[] = [];
  const sorted = [...hours].sort((a, b) => a.hour - b.hour);

  // Check: exactly 24 entries
  if (plan.length !== 24) {
    errors.push(`hourly_plan has ${plan.length} entries, expected 24`);
    return { valid: false, errors };
  }

  // Check: all 24 unique hours present
  const planHours = new Set(plan.map((p) => p.hour));
  for (let h = 0; h < 24; h++) {
    if (!planHours.has(h)) {
      errors.push(`Missing hour ${h} in hourly_plan`);
    }
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Sort plan by hour for sequential replay
  const sortedPlan = [...plan].sort((a, b) => a.hour - b.hour);

  let batteryEnergy = battery.initial_energy_kwh;

  for (let h = 0; h < 24; h++) {
    const entry = sortedPlan[h]!;
    const hourData = sorted[h]!;
    const hc = hourConstraints[h]!;

    // ── 1. Energy Balance ──
    // grid + solar_used + discharge = demand + charge
    const supply =
      entry.grid_kwh +
      entry.solar_used_kwh +
      (entry.battery_action === "discharge" ? entry.battery_kwh : 0);
    const demand =
      hourData.demand_kwh +
      (entry.battery_action === "charge" ? entry.battery_kwh : 0);

    if (Math.abs(supply - demand) > TOLERANCE) {
      errors.push(
        `Hour ${h}: Energy balance violation. ` +
          `grid(${entry.grid_kwh}) + solar(${entry.solar_used_kwh}) + discharge(${entry.battery_action === "discharge" ? entry.battery_kwh : 0}) = ${supply}, ` +
          `but demand(${hourData.demand_kwh}) + charge(${entry.battery_action === "charge" ? entry.battery_kwh : 0}) = ${demand}`
      );
    }

    // ── 2. Solar Cap ──
    if (entry.solar_used_kwh > hc.effective_solar_kwh + TOLERANCE) {
      errors.push(
        `Hour ${h}: Solar overuse. Used ${entry.solar_used_kwh}, effective max ${hc.effective_solar_kwh}`
      );
    }

    // ── 3. Non-negative values ──
    if (entry.grid_kwh < -TOLERANCE) {
      errors.push(`Hour ${h}: Negative grid_kwh: ${entry.grid_kwh}`);
    }
    if (entry.solar_used_kwh < -TOLERANCE) {
      errors.push(`Hour ${h}: Negative solar_used_kwh: ${entry.solar_used_kwh}`);
    }
    if (entry.battery_kwh < -TOLERANCE) {
      errors.push(`Hour ${h}: Negative battery_kwh: ${entry.battery_kwh}`);
    }

    // ── 4. Battery Action Consistency ──
    if (entry.battery_action === "idle" && entry.battery_kwh > TOLERANCE) {
      errors.push(
        `Hour ${h}: idle action but battery_kwh = ${entry.battery_kwh} (should be 0)`
      );
    }

    // ── 5. Charge/Discharge Rate Limits ──
    if (entry.battery_action === "charge") {
      if (entry.battery_kwh > hc.max_charge_kwh + TOLERANCE) {
        errors.push(
          `Hour ${h}: Charge rate violation. ${entry.battery_kwh} > max ${hc.max_charge_kwh}`
        );
      }
    }
    if (entry.battery_action === "discharge") {
      if (entry.battery_kwh > hc.max_discharge_kwh + TOLERANCE) {
        errors.push(
          `Hour ${h}: Discharge rate violation. ${entry.battery_kwh} > max ${hc.max_discharge_kwh}`
        );
      }
    }

    // ── 6. Grid Cap ──
    if (hc.max_grid_kwh !== Infinity && entry.grid_kwh > hc.max_grid_kwh + TOLERANCE) {
      errors.push(
        `Hour ${h}: Grid cap violation. ${entry.grid_kwh} > max ${hc.max_grid_kwh}`
      );
    }

    // ── 7. Battery State Transition ──
    if (entry.battery_action === "charge") {
      batteryEnergy += entry.battery_kwh;
    } else if (entry.battery_action === "discharge") {
      batteryEnergy -= entry.battery_kwh;
    }

    // ── 8. Battery Energy Bounds ──
    if (batteryEnergy < hc.min_battery_energy_kwh - TOLERANCE) {
      errors.push(
        `Hour ${h}: Battery below minimum. ${batteryEnergy.toFixed(2)} < min ${hc.min_battery_energy_kwh}`
      );
    }
    if (batteryEnergy > battery.capacity_kwh + TOLERANCE) {
      errors.push(
        `Hour ${h}: Battery above capacity. ${batteryEnergy.toFixed(2)} > capacity ${battery.capacity_kwh}`
      );
    }

    // ── 9. battery_energy_after_kwh Consistency ──
    if (Math.abs(batteryEnergy - entry.battery_energy_after_kwh) > TOLERANCE) {
      errors.push(
        `Hour ${h}: battery_energy_after_kwh mismatch. ` +
          `Replayed: ${batteryEnergy.toFixed(2)}, reported: ${entry.battery_energy_after_kwh}`
      );
    }
  }

  // ── 10. End-of-Day Battery Neutrality ──
  if (Math.abs(batteryEnergy - battery.initial_energy_kwh) > TOLERANCE) {
    errors.push(
      `End-of-day neutrality violated. Final energy: ${batteryEnergy.toFixed(2)}, ` +
        `initial: ${battery.initial_energy_kwh}`
    );
  }

  if (errors.length > 0) {
    logger.warn("Replay validation found issues", {
      errorCount: errors.length,
      firstError: errors[0],
    });
  } else {
    logger.info("Replay validation passed — all constraints satisfied");
  }

  return { valid: errors.length === 0, errors };
}
