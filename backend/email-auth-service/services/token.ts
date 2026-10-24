const K_SERVICE = Deno.env.get("K_SERVICE");
const GCP_METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const TOKEN_CACHE_BUFFER_MS = 60_000;

let cached: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (!K_SERVICE) {
    throw new Error(
      "getAccessToken: not running on Cloud Run; set up local credentials or use the Auth emulator",
    );
  }

  if (cached && cached.expiresAt > Date.now() + TOKEN_CACHE_BUFFER_MS) {
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
