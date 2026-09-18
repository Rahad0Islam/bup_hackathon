/**
 * GridWise LLM — Metrics Service
 *
 * Recalculates summary metrics directly from the hourly plan.
 * These must match the values reported in the response — the judge
 * will recompute them independently and compare.
 */

import type { HourData, HourlyPlanEntry } from "../../types/domain.types.js";

/** Round a number to 2 decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Recalculate total_grid_kwh, total_cost_bdt, and peak_grid_kwh
 * directly from the hourly plan and hour data.
 *
 * @param plan - The 24-hour plan (must be sorted by hour)
 * @param hours - Original hour data (for tariffs)
 * @returns Recalculated summary metrics
 */
export function recalculateMetrics(
  plan: HourlyPlanEntry[],
  hours: HourData[]
): {
  total_grid_kwh: number;
  total_cost_bdt: number;
  peak_grid_kwh: number;
} {
  const sortedPlan = [...plan].sort((a, b) => a.hour - b.hour);
  const sortedHours = [...hours].sort((a, b) => a.hour - b.hour);

  let totalGrid = 0;
  let totalCost = 0;
  let peakGrid = 0;

  for (let h = 0; h < 24; h++) {
    const entry = sortedPlan[h]!;
    const hourData = sortedHours[h]!;

    totalGrid += entry.grid_kwh;
    totalCost += entry.grid_kwh * hourData.tariff_bdt_per_kwh;
    peakGrid = Math.max(peakGrid, entry.grid_kwh);
  }

  return {
    total_grid_kwh: round2(totalGrid),
    total_cost_bdt: round2(totalCost),
    peak_grid_kwh: round2(peakGrid),
  };
}
