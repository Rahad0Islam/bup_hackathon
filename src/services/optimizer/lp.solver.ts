/**
 * GridWise LLM — LP Solver
 *
 * Executes the javascript-lp-solver on the built LP model and extracts
 * the 24-hour dispatch solution into HourlyPlanEntry format.
 */

import solver from "javascript-lp-solver";
import type {
  HourData,
  BatterySpec,
  HourlyPlanEntry,
  BatteryAction,
  HourConstraints,
} from "../../types/domain.types.js";
import { logger } from "../../utils/logger.js";
import { OptimizerError } from "../../utils/errors.js";

/** Threshold for deciding battery action (charge vs discharge vs idle). */
const ACTION_THRESHOLD = 1e-4;

/** Round a number to 2 decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Solve the LP model and extract the 24-hour energy dispatch plan.
 *
 * @param model - LP model in javascript-lp-solver format
 * @param hours - Original hour data (for reference)
 * @param battery - Battery specification
 * @param hourConstraints - Per-hour constraints after directives applied
 * @returns Array of 24 HourlyPlanEntry objects
 */
export function solveLPModel(
  model: Record<string, unknown>,
  hours: HourData[],
  battery: BatterySpec,
  hourConstraints: HourConstraints[]
): HourlyPlanEntry[] {
  logger.info("Solving LP model...");

  const result = solver.Solve(model as any) as Record<string, unknown>;

  if (!result || result.feasible === false) {
    logger.error("LP solver: infeasible problem", { result });
    throw new OptimizerError(
      "LP solver found no feasible solution. The combination of directives and energy constraints may be contradictory."
    );
  }

  logger.info("LP solver: feasible solution found", {
    objectiveValue: result.result,
  });

  const sorted = [...hours].sort((a, b) => a.hour - b.hour);
  const plan: HourlyPlanEntry[] = [];

  for (let h = 0; h < 24; h++) {
    const gridVal = round2(Number(result[`grid_${h}`]) || 0);
    const solarVal = round2(Number(result[`solar_${h}`]) || 0);
    const chargeVal = round2(Number(result[`charge_${h}`]) || 0);
    const dischargeVal = round2(Number(result[`discharge_${h}`]) || 0);
    const battVal = round2(Number(result[`batt_${h}`]) || 0);

    // Determine battery action using deadband threshold
    let batteryAction: BatteryAction;
    let batteryKwh: number;

    if (chargeVal > ACTION_THRESHOLD) {
      batteryAction = "charge";
      batteryKwh = round2(chargeVal);
    } else if (dischargeVal > ACTION_THRESHOLD) {
      batteryAction = "discharge";
      batteryKwh = round2(dischargeVal);
    } else {
      batteryAction = "idle";
      batteryKwh = 0;
    }

    plan.push({
      hour: h,
      grid_kwh: round2(Math.max(0, gridVal)),
      solar_used_kwh: round2(Math.max(0, solarVal)),
      battery_action: batteryAction,
      battery_kwh: round2(Math.max(0, batteryKwh)),
      battery_energy_after_kwh: round2(Math.max(0, battVal)),
    });
  }

  return plan;
}
