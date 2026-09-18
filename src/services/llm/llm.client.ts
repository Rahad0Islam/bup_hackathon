/**
 * GridWise LLM — Unified LLM Client
 *
 * Wraps @google/genai (Gemini) with support for structured JSON output.
 * Handles API errors, timeouts, and provides a clean interface for
 * the extractor and verifier services.
 */

import { GoogleGenAI } from "@google/genai";
import config from "../../config/config.js";
import { logger } from "../../utils/logger.js";
import { LLMError } from "../../utils/errors.js";

/** Singleton Gemini client instance. */
let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: config.GEMINI_API_KEY,
    });
  }
  return geminiClient;
}

export interface LLMRequest {
  systemPrompt: string;
  userPrompt: string;
  /** If true, request JSON output mode. */
  jsonMode?: boolean;
}

export interface LLMResponse {
  text: string;
}

/**
 * Send a prompt to the configured LLM and return the text response.
 * Retries once on transient failures.
 */
export async function callLLM(request: LLMRequest): Promise<LLMResponse> {
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callGemini(request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`LLM call attempt ${attempt}/${maxRetries} failed`, {
        error: message,
      });

      if (attempt === maxRetries) {
        throw new LLMError(`LLM call failed after ${maxRetries} attempts: ${message}`);
      }

      // Brief backoff before retry
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  // TypeScript: unreachable, but satisfies return type
  throw new LLMError("LLM call failed unexpectedly");
}

/**
 * Call Gemini via @google/genai SDK.
 */
async function callGemini(request: LLMRequest): Promise<LLMResponse> {
  const client = getGeminiClient();
  const model = config.GEMINI_MODEL;

  logger.debug("Calling Gemini", { model, jsonMode: request.jsonMode });

  const response = await client.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: request.userPrompt }],
      },
    ],
    config: {
      systemInstruction: request.systemPrompt,
      ...(request.jsonMode
        ? { responseMimeType: "application/json" }
        : {}),
    },
  });

  const text = response.text;
  if (!text) {
    throw new LLMError("Gemini returned empty response");
  }

  logger.debug("Gemini response received", { length: text.length });
  return { text };
}
