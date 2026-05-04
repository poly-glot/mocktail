import { IWireElement } from '../interfaces/project.interface';

/**
 * Recursively strip `undefined` keys so Firestore doesn't reject the payload.
 * Preserves Timestamp / FieldValue sentinels (anything with `.toDate` or
 * `_methodName`) untouched.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (
    value &&
    typeof value === 'object' &&
    !(value as { toDate?: unknown }).toDate &&
    !(value as { _methodName?: unknown })._methodName
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Decode a Firestore element document into an IWireElement, applying
 * type-specific defaults for missing variant/level fields.
 */
export function decodeElement(id: string, data: Record<string, unknown>): IWireElement {
  const type = data['type'] as IWireElement['type'];
  let variant = data['variant'] as string | undefined;
  if (variant === undefined) {
    if (type === 'button') variant = 'primary';
    else if (type === 'divider') variant = 'h';
  }
  let level = data['level'] as IWireElement['level'];
  if (level === undefined && type === 'heading') level = 1;
  return {
    id,
    pageId: data['pageId'] as string,
    type,
    x: (data['x'] as number) ?? 0,
    y: (data['y'] as number) ?? 0,
    w: (data['w'] as number) ?? 120,
    h: (data['h'] as number) ?? 40,
    rotation: data['rotation'] as number | undefined,
    zIndex: (data['zIndex'] as number) ?? 0,
    locked: (data['locked'] as boolean | undefined) ?? false,
    text: data['text'] as string | undefined,
    variant,
    color: data['color'] as string | undefined,
    level,
    data: data['data'] as Record<string, unknown> | undefined,
  };
}
