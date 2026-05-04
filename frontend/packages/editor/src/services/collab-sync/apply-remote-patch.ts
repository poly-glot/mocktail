export function applyRemotePatch<T extends object>(el: T, patch: Record<string, unknown>): T {
  const next: Record<string, unknown> = { ...(el as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  return next as T;
}
