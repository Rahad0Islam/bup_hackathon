/**
 * GridWise LLM — Domain Types
 *
 * Shared TypeScript interfaces and types for the entire energy-optimization
 * pipeline: request parsing → LLM extraction → guardrails → LP solving → replay.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

/** The six supported operator-note directive types. */
export type DirectiveType =
  | "solar_reduction"
  | "minimum_battery_reserve"
  | "no_charge_window"
  | "no_discharge_window"
  | "max_grid_window"
  | "no_op";

/** Allowed battery actions in the hourly plan. */
export type BatteryAction = "charge" | "discharge" | "idle";

// ─── Request Types ───────────────────────────────────────────────────────────

/** One hour of forecasted campus energy data. */
export interface HourData {
  hour: number;          // 0-23
  demand_kwh: number;    // Non-negative campus demand
  solar_kwh: number;     // Non-negative forecasted solar generation
  tariff_bdt_per_kwh: number; // Grid electricity tariff for this hour
}

/** Battery energy storage system specification. */
export interface BatterySpec {
  capacity_kwh: number;
  initial_energy_kwh: number;
  minimum_energy_kwh: number;
  max_charge_kwh_per_hour: number;
  max_discharge_kwh_per_hour: number;
}

/** Full scenario input for POST /optimize-energy. */
export interface ScenarioInput {
  scenario_id: string;
  operator_notes: string[];
  hours: HourData[];
  battery: BatterySpec;
}

// ─── Directive / Interpretation Types ────────────────────────────────────────

/** Structured adjustment for solar_reduction. */
export interface SolarReductionAdjustment {
  hours: number[];
  factor: number; // Usable fraction remaining (0.2 = 80% reduction)
}

/** Structured adjustment for minimum_battery_reserve. */
export interface MinimumBatteryReserveAdjustment {
  hours: number[];
  minimum_energy_kwh: number;
}

/** Structured adjustment for no_charge_window / no_discharge_window. */
export interface WindowAdjustment {
  hours: number[];
}

/** Structured adjustment for max_grid_window. */
export interface MaxGridWindowAdjustment {
  hours: number[];
  max_grid_kwh: number;
}

/** Union of all possible structured adjustments. */
export type StructuredAdjustment =
  | SolarReductionAdjustment
  | MinimumBatteryReserveAdjustment
  | WindowAdjustment
  | MaxGridWindowAdjustment
  | null;

/** One directive interpretation entry in the response. */
export interface DirectiveInterpretation {
  note_index: number;
  applies: boolean;
  directive_type: DirectiveType;
  structured_adjustment: StructuredAdjustment;
  explanation: string;
}

// ─── Internal Pipeline Types ─────────────────────────────────────────────────

/**
 * Effective per-hour constraints after all directives have been applied.
 * Used by the LP model builder.
 */
export interface HourConstraints {
  effective_solar_kwh: number;
  min_battery_energy_kwh: number;
  max_charge_kwh: number;
  max_discharge_kwh: number;
  max_grid_kwh: number;
}

// ─── Response Types ──────────────────────────────────────────────────────────

/** One hour of the optimized energy plan. */
export interface HourlyPlanEntry {
  hour: number;
  grid_kwh: number;
  solar_used_kwh: number;
  battery_action: BatteryAction;
  battery_kwh: number;
  battery_energy_after_kwh: number;
}

/** Full response for POST /optimize-energy. */
export interface OptimizeEnergyResponse {
  scenario_id: string;
  directive_interpretation: DirectiveInterpretation[];
  hourly_plan: HourlyPlanEntry[];
  total_grid_kwh: number;
  total_cost_bdt: number;
  peak_grid_kwh: number;
  plan_summary: string;
}

// ─── LP Solver Types ─────────────────────────────────────────────────────────

/** Raw solution from the LP solver before conversion to HourlyPlanEntry[]. */
export interface LPSolution {
  feasible: boolean;
  result: number; // Objective value (total cost)
  /** Variable name → value mapping from the solver. */
  variables: Record<string, number>;
}
