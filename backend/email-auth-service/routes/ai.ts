/**
 * AI routes — Gemini-backed wireframe generation and review.
 *
 * POST /api/ai/generate
 *   { prompt, context? }
 *   → { elements: Element[], notes: string }
 *
 * POST /api/ai/review
 *   { elements: Element[] }
 *   → { findings: { severity, message, elementId? }[] }
 *
 * The system prompt teaches Gemini the Mocktail element schema so the model
 * only emits types the canvas can render. If GEMINI_API_KEY is missing the
 * route falls back to a deterministic rule-based generator — this keeps the
 * end-to-end flow testable without a live key, which the E2E suite relies on.
 */

import { Hono } from "hono";

const ai = new Hono();

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Element schema (mirrors frontend canvas) ─────────────────────────
//
// Shared with the Angular editor. Keep this list in lock-step with
// frontend/src/app/shared/element.ts — the AI relies on it.
export const ELEMENT_TYPES = [
  "rect",
  "text",
  "heading",
  "button",
  "input",
  "card",
  "image",
  "bar-chart",
  "donut",
  "table",
  "nav",
  "phone-frame",
  "checkbox",
  "toggle",
  "divider",
  "tag",
] as const;

export type ElementType = typeof ELEMENT_TYPES[number];

export interface WireframeElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  props?: Record<string, unknown>;
}

// ── System prompt (trains Gemini on the mocking schema) ─────────────

const SYSTEM_PROMPT = `
You are Mocktail, an AI wireframing assistant. Your job is to translate product
prompts into wireframes composed of a small, fixed set of primitive elements.

OUTPUT CONTRACT — return JSON only, matching this TypeScript type exactly:

  type Out = {
    notes: string;                // one short sentence about the design
    elements: Array<{
      id: string;                 // stable kebab-case id e.g. "hero-title"
      type: "rect" | "text" | "heading" | "button" | "input" | "card" |
            "image" | "bar-chart" | "donut" | "table" | "nav" |
            "phone-frame" | "checkbox" | "toggle" | "divider" | "tag";
      x: number; y: number;       // in pixels, from top-left of 880×N canvas
      w: number; h: number;       // width, height in pixels
      props?: {
        text?: string;            // for text/heading/button/tag
        placeholder?: string;     // for input
        rows?: string[][];        // for table
        selected?: boolean;       // for toggle/checkbox
        variant?: "solid" | "outline"; // for button
      };
    }>;
  };

DESIGN RULES
- Canvas width is 880px. Leave 32px gutter left/right.
- Use a 12-column mental grid; everything should be at multiples of 8.
- Black-and-white aesthetic: do not invent colors. Styling is applied later.
- Prefer COMPOSITIONS over dense pages. A dashboard is: nav, kpi cards,
  chart, table, footer — in that order.
- IDs must be unique, kebab-case, and descriptive.
- Headings h=36, subheads h=24, body text h=16, buttons h=36 px.
- Cards wrap groups of related content. Put card children INSIDE the card's
  bbox (x_child in [x+16, x+w-16]).

When the user says "dashboard": include nav at top (h=48), 3-4 kpi cards, one
bar-chart, one table.
When the user says "login" or "auth": a centered card ~360×420 with heading,
two inputs, a primary button.
When the user says "landing": hero heading, subtext, cta button, 3 feature
cards in a row.

Never output prose outside the JSON. Never wrap in markdown fences.
`.trim();

// ── Deterministic fallback (used when GEMINI_API_KEY is missing) ────

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function fallbackDashboard(): { elements: WireframeElement[]; notes: string } {
  const elements: WireframeElement[] = [
    {
      id: uid("nav"),
      type: "nav",
      x: 32,
      y: 24,
      w: 816,
      h: 48,
      props: { text: "Mocktail · Dashboard" },
    },
    {
      id: uid("kpi"),
      type: "card",
      x: 32,
      y: 96,
      w: 196,
      h: 88,
      props: { text: "12,438\nActive Users" },
    },
    {
      id: uid("kpi"),
      type: "card",
      x: 240,
      y: 96,
      w: 196,
      h: 88,
      props: { text: "$84.2k\nRevenue" },
    },
    {
      id: uid("kpi"),
      type: "card",
      x: 448,
      y: 96,
      w: 196,
      h: 88,
      props: { text: "3.27%\nConversion" },
    },
    {
      id: uid("kpi"),
      type: "card",
      x: 656,
      y: 96,
      w: 192,
      h: 88,
      props: { text: "64\nTickets" },
    },
    { id: uid("chart"), type: "bar-chart", x: 32, y: 208, w: 520, h: 200 },
    { id: uid("donut"), type: "donut", x: 568, y: 208, w: 280, h: 200 },
    {
      id: uid("table"),
      type: "table",
      x: 32,
      y: 432,
      w: 816,
      h: 240,
      props: {
        rows: [
          ["Project", "Owner", "Status", "Due"],
          ["Orion v4 · redesign", "J. Ahmed", "Shipped", "Apr 22"],
          ["Passwordless auth", "M. Khan", "Active", "Apr 26"],
          ["Stripe migration", "R. Park", "Blocked", "May 02"],
        ],
      },
    },
  ];
  return {
    elements,
    notes: "Dashboard with KPI cards, a revenue chart, and recent projects.",
  };
}

function fallbackLogin(): { elements: WireframeElement[]; notes: string } {
  const x = 260, y = 120, w = 360, h = 440;
  const elements: WireframeElement[] = [
    { id: uid("card"), type: "card", x, y, w, h },
    {
      id: uid("title"),
      type: "heading",
      x: x + 32,
      y: y + 32,
      w: w - 64,
      h: 36,
      props: { text: "Sign in" },
    },
    {
      id: uid("sub"),
      type: "text",
      x: x + 32,
      y: y + 72,
      w: w - 64,
      h: 18,
      props: { text: "Use email or Google to continue." },
    },
    {
      id: uid("email"),
      type: "input",
      x: x + 32,
      y: y + 120,
      w: w - 64,
      h: 40,
      props: { placeholder: "you@company.com" },
    },
    {
      id: uid("pwd"),
      type: "input",
      x: x + 32,
      y: y + 176,
      w: w - 64,
      h: 40,
      props: { placeholder: "Password" },
    },
    {
      id: uid("btn"),
      type: "button",
      x: x + 32,
      y: y + 236,
      w: w - 64,
      h: 40,
      props: { text: "Sign in", variant: "solid" },
    },
    { id: uid("div"), type: "divider", x: x + 32, y: y + 296, w: w - 64, h: 1 },
    {
      id: uid("goog"),
      type: "button",
      x: x + 32,
      y: y + 320,
      w: w - 64,
      h: 40,
      props: { text: "Continue with Google", variant: "outline" },
    },
  ];
  return {
    elements,
    notes: "Login card — email + password with a Google alternative.",
  };
}

function fallbackLanding(): { elements: WireframeElement[]; notes: string } {
  const elements: WireframeElement[] = [
    { id: uid("nav"), type: "nav", x: 32, y: 16, w: 816, h: 48 },
    {
      id: uid("hero-h"),
      type: "heading",
      x: 32,
      y: 120,
      w: 816,
      h: 56,
      props: { text: "Wireframes that ship code." },
    },
    {
      id: uid("hero-t"),
      type: "text",
      x: 32,
      y: 188,
      w: 560,
      h: 44,
      props: { text: "From prompt to production component in one surface." },
    },
    {
      id: uid("cta"),
      type: "button",
      x: 32,
      y: 252,
      w: 168,
      h: 44,
      props: { text: "Start free", variant: "solid" },
    },
    {
      id: uid("cta2"),
      type: "button",
      x: 208,
      y: 252,
      w: 168,
      h: 44,
      props: { text: "See demo", variant: "outline" },
    },
    {
      id: uid("f1"),
      type: "card",
      x: 32,
      y: 336,
      w: 256,
      h: 176,
      props: { text: "AI-native\nPrompt → wireframe" },
    },
    {
      id: uid("f2"),
      type: "card",
      x: 312,
      y: 336,
      w: 256,
      h: 176,
      props: { text: "Code export\nReact · Vue · Svelte" },
    },
    {
      id: uid("f3"),
      type: "card",
      x: 592,
      y: 336,
      w: 256,
      h: 176,
      props: { text: "MCP-first\nAgent-collaborable" },
    },
  ];
  return { elements, notes: "Landing — hero, two CTAs, three feature cards." };
}

function fallbackGeneric(
  prompt: string,
): { elements: WireframeElement[]; notes: string } {
  const title = prompt.slice(0, 48) || "Untitled screen";
  const elements: WireframeElement[] = [
    {
      id: uid("h"),
      type: "heading",
      x: 32,
      y: 40,
      w: 816,
      h: 40,
      props: { text: title },
    },
    {
      id: uid("p"),
      type: "text",
      x: 32,
      y: 88,
      w: 560,
      h: 40,
      props: { text: "Drafted from your prompt — edit any element to refine." },
    },
    { id: uid("c1"), type: "card", x: 32, y: 152, w: 394, h: 160 },
    { id: uid("c2"), type: "card", x: 454, y: 152, w: 394, h: 160 },
    {
      id: uid("b"),
      type: "button",
      x: 32,
      y: 336,
      w: 140,
      h: 40,
      props: { text: "Primary", variant: "solid" },
    },
    {
      id: uid("b2"),
      type: "button",
      x: 180,
      y: 336,
      w: 140,
      h: 40,
      props: { text: "Secondary", variant: "outline" },
    },
  ];
  return { elements, notes: `Starter layout for: ${title}` };
}

function fallback(prompt: string) {
  const p = prompt.toLowerCase();
  if (/dashboard|kpi|analytics|admin/.test(p)) return fallbackDashboard();
  if (/login|sign ?in|auth|password/.test(p)) return fallbackLogin();
  if (/landing|marketing|hero|home ?page/.test(p)) return fallbackLanding();
  return fallbackGeneric(prompt);
}

// ── Gemini call ─────────────────────────────────────────────────────

async function callGemini(prompt: string, context?: unknown): Promise<
  { elements: WireframeElement[]; notes: string } | null
> {
  if (Deno.env.get("GEMINI_ENABLED") !== "true") return null;
  if (!GEMINI_API_KEY) return null;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [{
          text: `Prompt: ${prompt}\n\nCurrent page context:\n${
            JSON.stringify(context ?? {}, null, 2)
          }`,
        }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: "application/json",
    },
  };
  try {
    const res = await fetch(
      `${GEMINI_URL}?key=${encodeURIComponent(GEMINI_API_KEY)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      console.error("gemini non-2xx", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed?.elements)) return null;
    return {
      elements: parsed.elements.filter(isValidElement),
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
    };
  } catch (err) {
    console.error("gemini call failed", err);
    return null;
  }
}

function isValidElement(e: unknown): e is WireframeElement {
  if (!e || typeof e !== "object") return false;
  const o = e as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.type === "string" &&
    (ELEMENT_TYPES as readonly string[]).includes(o.type as string) &&
    typeof o.x === "number" && typeof o.y === "number" &&
    typeof o.w === "number" && typeof o.h === "number"
  );
}

// ── Routes ──────────────────────────────────────────────────────────

ai.post("/generate", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const context = body.context;
  if (!prompt.trim()) return c.json({ error: "prompt is required" }, 400);

  const fromModel = await callGemini(prompt, context);
  const result = fromModel ?? fallback(prompt);
  return c.json({
    ...result,
    source: fromModel ? "gemini" : "fallback",
    model: fromModel ? GEMINI_MODEL : "rule-based",
  });
});

ai.post("/review", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const elements: WireframeElement[] = Array.isArray(body.elements)
    ? body.elements
    : [];
  const findings: Array<
    { severity: string; message: string; elementId?: string }
  > = [];

  // Rule-based a11y / heuristic review — runs regardless of Gemini.
  for (const el of elements) {
    if (el.type === "button" && !el.props?.text) {
      findings.push({
        severity: "error",
        message: "Button is missing a text label.",
        elementId: el.id,
      });
    }
    if (el.type === "input" && !el.props?.placeholder) {
      findings.push({
        severity: "warn",
        message: "Input has no placeholder — add one for clarity.",
        elementId: el.id,
      });
    }
    if (el.type === "image" && !el.props?.text) {
      findings.push({
        severity: "warn",
        message: "Image is missing an alt description.",
        elementId: el.id,
      });
    }
    if (el.w < 24 || el.h < 16) {
      findings.push({
        severity: "warn",
        message: "Element is below 24×16px — hard to hit on touch.",
        elementId: el.id,
      });
    }
  }

  // Layout heuristics.
  const buttons = elements.filter((e) => e.type === "button");
  const primary = buttons.filter((e) => e.props?.variant === "solid");
  if (buttons.length > 0 && primary.length === 0) {
    findings.push({
      severity: "info",
      message:
        "No primary (solid) button on this page — pick one to guide the user.",
    });
  }
  if (primary.length > 1) {
    findings.push({
      severity: "warn",
      message:
        `${primary.length} primary buttons — typically one CTA per screen is clearest.`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "info",
      message: "Looks clean — no heuristic issues flagged.",
    });
  }

  return c.json({ findings });
});

ai.get("/healthz", (c) =>
  c.json({
    ok: true,
    enabled: Deno.env.get("GEMINI_ENABLED") === "true",
    hasKey: Boolean(Deno.env.get("GEMINI_API_KEY") ?? GEMINI_API_KEY),
    model: GEMINI_MODEL,
  }));

export default ai;
