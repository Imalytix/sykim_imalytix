/**
 * ⚠️ Rough cost estimation only — NOT a source of truth for billing.
 *
 * USD price per 1M tokens, keyed by the exact model name each client
 * requests (see OPENAI_VISION_MODEL/GEMINI_VISION_MODEL/ANTHROPIC_VISION_MODEL
 * env vars and their defaults in lib/vision/{openai,gemini,anthropic}.ts).
 * These numbers were entered by hand and WILL drift from the providers'
 * actual pricing pages over time — verify against the provider's current
 * pricing page before trusting a total for real budgeting:
 *   - https://openai.com/api/pricing
 *   - https://ai.google.dev/gemini-api/docs/pricing
 *   - https://www.anthropic.com/pricing#api
 * A model name that isn't in this table (custom env override, provider
 * renamed a model, etc.) just yields cost_usd: null rather than a guess.
 */
const PRICING_PER_1M_TOKENS_USD: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

export function estimateCostUsd(modelName: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const pricing = PRICING_PER_1M_TOKENS_USD[modelName];
  if (!pricing || inputTokens === null || outputTokens === null) return null;
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}
