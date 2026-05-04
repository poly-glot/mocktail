/**
 * Environment configuration for the email-auth sidecar.
 *
 * Required env vars (set in Cloud Run):
 *   PROJECT_ID     — Firebase / GCP project ID
 *   APP_DOMAIN     — domain to continue to after sign-in (e.g. mocktail.example.com)
 *   RESEND_API_KEY — Resend API key for the custom-sender email
 *   FROM_EMAIL     — "Mocktail <no-reply@your-verified-domain>"
 */

export const PROJECT_ID = Deno.env.get("PROJECT_ID") ?? "";
export const APP_DOMAIN = Deno.env.get("APP_DOMAIN") ?? "";
export const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
export const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ??
  "Mocktail <no-reply@mocktail.local>";

export const PORT = Number(Deno.env.get("PORT") ?? "8085");

// Rate-limiting window: 1 request per email per 60s (matches webhook).
export const RATE_LIMIT_WINDOW = 60_000;

// Access-token cache buffer: refresh a bit before expiry.
export const TOKEN_CACHE_BUFFER = 60_000;

export const GCP_METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

// Cloud Run sets K_SERVICE automatically. Used to detect prod vs local.
export const K_SERVICE = Deno.env.get("K_SERVICE");
