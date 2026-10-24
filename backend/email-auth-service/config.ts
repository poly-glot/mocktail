export const PROJECT_ID = Deno.env.get("PROJECT_ID") ?? "";
export const APP_DOMAIN = Deno.env.get("APP_DOMAIN") ?? "";
export const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
export const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ??
  "Mocktail <no-reply@mocktail.local>";

export const PORT = Number(Deno.env.get("PORT") ?? "8085");
