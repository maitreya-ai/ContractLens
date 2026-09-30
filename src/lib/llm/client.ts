import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";

let client: Anthropic | null = null;

/** Credentials resolve from ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile). */
export function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/**
 * Server-side refusal fallback: if the model declines (for example a false positive on
 * security-flavoured questions), the API re-runs the request on Anthropic's recommended
 * fallback model inside the same call.
 */
export function fallbackOptions(): { betas?: string[]; fallbacks?: "default" } {
  return config.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}

export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.local.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key does not have access to the configured model.";
  if (err instanceof Anthropic.NotFoundError) return `Model "${config.model}" was not found. Check ANTHROPIC_MODEL.`;
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the Anthropic API. Wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The request was rejected: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return "The Anthropic API had a temporary error. Try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the Anthropic API. Check your network connection.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status ?? ""}: ${err.message}`;
  if (err instanceof Error && err.name === "AbortError") return "Request cancelled.";
  return err instanceof Error ? err.message : "Unexpected error.";
}
