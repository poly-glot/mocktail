/**
 * Image library proxy — hides the Unsplash Access Key from the browser and
 * applies a coarse rate limit so no single client can burn the app-wide
 * quota. Matches the request surface consumed by the Angular
 * `ImageLibraryService`.
 *
 * GET  /api/images/search?q=<term>&page=<n>&perPage=<n>
 *   → { results: IUnsplashPhoto[], hasMore: boolean }
 *   Empty `q` falls back to /photos?order_by=popular so the panel has a
 *   useful curated default.
 *
 * POST /api/images/track-download
 *   { downloadLocation: string }
 *   → 204 always (fire-and-forget per Unsplash guidelines).
 */

import { Hono } from "hono";

const images = new Hono();

const UNSPLASH_API = "https://api.unsplash.com";
const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 30;

const hits = new Map<string, number[]>();

function keyFor(
  c: { req: { header: (k: string) => string | undefined } },
): string {
  const fwd = c.req.header("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return c.req.header("x-real-ip") ?? "anon";
}

function rateLimit(key: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const arr = hits.get(key) ?? [];
  const pruned = arr.filter((t) => now - t < WINDOW_MS);
  if (pruned.length >= LIMIT_PER_WINDOW) {
    const oldest = pruned[0];
    const retryAfter = Math.max(
      1,
      Math.ceil((WINDOW_MS - (now - oldest)) / 1000),
    );
    hits.set(key, pruned);
    return { ok: false, retryAfter };
  }
  pruned.push(now);
  hits.set(key, pruned);
  return { ok: true, retryAfter: 0 };
}

function accessKey(): string | null {
  const k = Deno.env.get("UNSPLASH_ACCESS_KEY") ?? "";
  return k.length > 0 ? k : null;
}

interface UnsplashUser {
  name?: string;
  links?: { html?: string };
}

interface UnsplashPhotoRaw {
  id?: string;
  urls?: { regular?: string; small?: string; thumb?: string };
  links?: { download_location?: string; html?: string };
  user?: UnsplashUser;
  width?: number;
  height?: number;
}

interface UnsplashPhoto {
  id: string;
  urls: { regular: string; small: string; thumb: string };
  links: { download_location: string; html: string };
  user: { name: string; links: { html: string } };
  width: number;
  height: number;
}

function prune(raw: UnsplashPhotoRaw): UnsplashPhoto | null {
  if (!raw?.id || !raw.urls?.regular || !raw.links?.download_location) {
    return null;
  }
  return {
    id: raw.id,
    urls: {
      regular: raw.urls.regular,
      small: raw.urls.small ?? raw.urls.regular,
      thumb: raw.urls.thumb ?? raw.urls.small ?? raw.urls.regular,
    },
    links: {
      download_location: raw.links.download_location,
      html: raw.links.html ?? "https://unsplash.com/",
    },
    user: {
      name: raw.user?.name ?? "Unknown",
      links: { html: raw.user?.links?.html ?? "https://unsplash.com/" },
    },
    width: raw.width ?? 0,
    height: raw.height ?? 0,
  };
}

images.get("/search", async (c) => {
  const key = accessKey();
  if (!key) return c.json({ error: "UNSPLASH_ACCESS_KEY not configured" }, 500);

  const rl = rateLimit(keyFor(c));
  if (!rl.ok) {
    c.header("Retry-After", String(rl.retryAfter));
    return c.json({ error: "rate limit exceeded" }, 429);
  }

  const q = (c.req.query("q") ?? "").trim();
  const page = Math.max(1, Math.floor(Number(c.req.query("page") ?? "1")) || 1);
  const perPage = Math.max(
    1,
    Math.min(30, Math.floor(Number(c.req.query("perPage") ?? "24")) || 24),
  );

  const url = q
    ? `${UNSPLASH_API}/search/photos?query=${
      encodeURIComponent(q)
    }&page=${page}&per_page=${perPage}`
    : `${UNSPLASH_API}/photos?order_by=popular&page=${page}&per_page=${perPage}`;

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        "Authorization": `Client-ID ${key}`,
        "Accept-Version": "v1",
      },
    });
  } catch (err) {
    console.error("unsplash fetch failed", err);
    return c.json({ error: "upstream unreachable" }, 502);
  }

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    console.error("unsplash non-2xx", upstream.status, body);
    return c.json(
      { error: `upstream ${upstream.status}` },
      upstream.status as 400 | 401 | 403 | 404 | 429 | 500,
    );
  }

  const data = await upstream.json().catch(() => null);
  const rawList: UnsplashPhotoRaw[] = q
    ? (Array.isArray(data?.results) ? data.results : [])
    : (Array.isArray(data) ? data : []);
  const results = rawList.map(prune).filter((x): x is UnsplashPhoto =>
    x !== null
  );
  const hasMore = results.length === perPage;
  return c.json({ results, hasMore });
});

images.post("/track-download", async (c) => {
  const key = accessKey();
  if (!key) return c.body(null, 204);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const dl = typeof body.downloadLocation === "string"
    ? body.downloadLocation
    : "";
  if (!dl.startsWith(`${UNSPLASH_API}/`)) return c.body(null, 204);

  try {
    const res = await fetch(dl, {
      headers: { "Authorization": `Client-ID ${key}` },
    });
    if (!res.ok) {
      console.warn("unsplash track-download non-2xx", res.status);
    }
  } catch (err) {
    console.warn("unsplash track-download failed", err);
  }
  return c.body(null, 204);
});

images.get(
  "/healthz",
  (c) => c.json({ ok: true, hasKey: accessKey() !== null }),
);

export default images;
