import { Hono } from "hono";
import { PORT } from "./config.ts";
import emailAuth from "./routes/email-auth.ts";
import ai from "./routes/ai.ts";
import images from "./routes/images.ts";

const app = new Hono();

app.get("/healthz", (c) => c.text("ok"));
app.route("/api/email-auth", emailAuth);
app.route("/api/ai", ai);
app.route("/api/images", images);

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, app.fetch);
