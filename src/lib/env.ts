/**
 * Environment access. Read lazily, at the point of use: Next evaluates route
 * modules during `next build`, where secrets are normally absent, so nothing
 * here may throw at import time.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

export const openaiModel = () => process.env.OPENAI_MODEL || "gpt-5.5";

/** Overridable so the local end-to-end check can point at a fake GoHighLevel. */
export const ghlApiBase = () =>
  (process.env.GHL_API_BASE || "https://services.leadconnectorhq.com").replace(/\/+$/, "");
