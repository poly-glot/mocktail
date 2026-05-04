import {
  GCP_METADATA_TOKEN_URL,
  K_SERVICE,
  TOKEN_CACHE_BUFFER,
} from "../config.ts";

let cached: { token: string; expiresAt: number } | null = null;

/**
 * Fetches a Google access token for the attached service account.
 *
 * On Cloud Run the metadata server returns a token for the service's
 * runtime identity — which must have the "Service Account Token Creator"
 * and "Firebase Authentication Admin" roles to call sendOobCode.
 *
 * Off Cloud Run (local dev) this throws — the caller should handle that
 * path separately (or run the Firebase Auth emulator).
 */
export async function getAccessToken(): Promise<string> {
  if (!K_SERVICE) {
    throw new Error(
      "getAccessToken: not running on Cloud Run; set up local credentials or use the Auth emulator",
    );
  }

  if (cached && cached.expiresAt > Date.now() + TOKEN_CACHE_BUFFER) {
    return cached.token;
  }

  const res = await fetch(GCP_METADATA_TOKEN_URL, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!res.ok) {
    throw new Error(`metadata token fetch failed: ${res.status}`);
  }
  const data = await res.json();
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cached.token;
}
