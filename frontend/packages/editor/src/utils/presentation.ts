import { IWireElement } from '@mocktail/projects';

/**
 * Derive a 1–2 character initials badge from a peer's display name.
 *  - Empty/whitespace-only → `?`
 *  - Single token → first two characters, uppercased
 *  - Multi-token → first char of first token + first char of last token, uppercased
 */
export function peerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Build a CSS `transform` value for an element's rotation, or `''` when
 * rotation is missing / zero (falsy).
 */
export function transformFor(el: IWireElement): string {
  return el.rotation ? `rotate(${el.rotation}deg)` : '';
}
