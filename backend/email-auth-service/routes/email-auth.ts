/**
 * Email auth routes — passwordless sign-in via email link.
 *
 * Public endpoint (no auth middleware). Generates a Firebase email sign-in
 * link server-side via the Identity Toolkit Admin REST API, then sends it
 * via Resend so we control the email template (custom sender).
 */

import { Hono } from "hono";
import {
  APP_DOMAIN,
  FROM_EMAIL,
  PROJECT_ID,
  RATE_LIMIT_WINDOW,
  RESEND_API_KEY,
} from "../config.ts";
import { getAccessToken } from "../services/token.ts";
import { buildSignInEmail } from "../templates/sign-in-email.ts";

const emailAuth = new Hono();

// ── Rate limiting (1 request per email per 60s) ─────────────────────

type RateLimitEntry = { count: number; resetAt: number };
const emailRateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(email: string): number {
  const now = Date.now();
  const key = email.toLowerCase();
  const entry = emailRateLimits.get(key);

  if (!entry || now > entry.resetAt) {
    emailRateLimits.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return 0;
  }
  return Math.ceil((entry.resetAt - now) / 1000);
}

// ── Email validation ────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_RE.test(email);
}

// ── POST /send-link ─────────────────────────────────────────────────

emailAuth.post("/send-link", async (c) => {
  let body: { email?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid email address" }, 400);
  }

  const { email } = body;
  if (!isValidEmail(email)) {
    return c.json({ error: "Invalid email address" }, 400);
  }

  const retryAfter = checkRateLimit(email);
  if (retryAfter > 0) {
    return c.json(
      { error: "Please wait before requesting another link", retryAfter },
      429,
    );
  }

  try {
    const continueUrl = `https://${APP_DOMAIN}/login`;
    const accessToken = await getAccessToken();

    const oobRes = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestType: "EMAIL_SIGNIN",
          email,
          continueUrl,
          canHandleCodeInApp: true,
          returnOobLink: true,
          targetProjectId: PROJECT_ID,
        }),
      },
    );

    if (!oobRes.ok) {
      const err = await oobRes.text();
      console.error("[EmailAuth] sendOobCode failed:", err);
      return c.json({ error: "Failed to send sign-in link" }, 500);
    }

    const oobData = await oobRes.json();
    const signInLink: string | undefined = oobData.oobLink;
    if (!signInLink) {
      console.error("[EmailAuth] no oobLink in response:", oobData);
      return c.json({ error: "Failed to send sign-in link" }, 500);
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: "Sign in to Mocktail",
        html: buildSignInEmail(signInLink, email),
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      console.error("[EmailAuth] Resend API error:", err);
      return c.json({ error: "Failed to send sign-in link" }, 500);
    }

    return c.json({ success: true });
  } catch (err) {
    console.error("[EmailAuth] unexpected error:", err);
    return c.json({ error: "Failed to send sign-in link" }, 500);
  }
});

export default emailAuth;
