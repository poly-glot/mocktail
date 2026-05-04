import { assertEquals } from "@std/assert";
import ai from "./ai.ts";
import { Hono } from "hono";

function makeApp() {
  const app = new Hono();
  app.route("/api/ai", ai);
  return app;
}

Deno.test("ai.generate returns fallback when GEMINI_ENABLED is unset", async () => {
  Deno.env.delete("GEMINI_ENABLED");
  const app = makeApp();
  const res = await app.request("/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "dashboard" }),
  });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.source, "fallback");
});

Deno.test("ai.healthz reports enabled flag", async () => {
  Deno.env.set("GEMINI_ENABLED", "true");
  Deno.env.set("GEMINI_API_KEY", "stub-key-not-real");
  const app = makeApp();
  const res = await app.request("/api/ai/healthz");
  const body = await res.json();
  assertEquals(body.enabled, true);
  assertEquals(body.hasKey, true);
  Deno.env.delete("GEMINI_ENABLED");
  Deno.env.delete("GEMINI_API_KEY");
});
