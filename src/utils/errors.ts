/**
 * GridWise LLM — Domain Errors
 *
 * Controlled error classes for the energy-optimization pipeline.
 * These errors produce sanitized HTTP responses without leaking
 * stack traces, API keys, or internal implementation details.
 */

/** Base class for all domain errors. */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — Malformed JSON or Zod schema validation failure. */
export class ValidationError extends AppError {
  public readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message, 400);
    this.details = details;
  }
}

/** 500 — LLM call failure, timeout, or malformed LLM output. */
export class LLMError extends AppError {
  constructor(message: string) {
    super(message, 500);
  }
}

/** 500 — LP solver infeasibility or numerical issues. */
export class OptimizerError extends AppError {
  constructor(message: string) {
    super(message, 500);
  }
}

/** 500 — Physical replay validation failure. */
export class ReplayError extends AppError {
  constructor(message: string) {
    super(message, 500);
  }
}
