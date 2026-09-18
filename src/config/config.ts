/**
 * GridWise LLM — Environment Configuration
 *
 * Zod-validated environment config. All required env vars are checked at startup.
 * Falls back to sensible defaults where possible.
 */

import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod/v4";

dotenv.config({
  path: path.join(process.cwd(), ".env"),
});

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8000),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
  LLM_PROVIDER: z.enum(["gemini", "openai"]).default("gemini"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.format());
  process.exit(1);
}

const config = parsed.data;

export default config;
export type AppConfig = typeof config;
