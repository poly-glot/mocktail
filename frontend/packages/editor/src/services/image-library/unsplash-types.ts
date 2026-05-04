/**
 * Transport shape returned by the Deno `/api/images/search` proxy. This
 * mirrors the pruned Unsplash photo the backend emits — not the raw
 * Unsplash API response. Kept private to the image-library service.
 */

export interface IUnsplashPhoto {
  id: string;
  urls: { regular: string; small: string; thumb: string };
  links: { download_location: string; html: string };
  user: { name: string; links: { html: string } };
  width: number;
  height: number;
}

export interface IUnsplashSearchResponse {
  results: IUnsplashPhoto[];
  hasMore: boolean;
}
