/**
 * Pure, framework-free traits for {@link IWireElement}: type guards, data
 * extractors, and shared constants. This module is consumed by the editor
 * inspector, palette, and various services to classify elements and read
 * normalized values from their loose `data` bags.
 *
 * Rules:
 *   - No Angular imports, no services, no DOM access.
 *   - Inputs are typed (`IWireElement` / `ElementType`); narrowing is preserved
 *     where it existed in the original definitions.
 *   - Behavior must match the previous `inspector-panel.component.ts` exports
 *     verbatim — this file is the result of a pure move refactor.
 */
import type { ElementType, IImageRef, IWireElement } from './interfaces/project.interface';

export function isTextual(type: ElementType): boolean {
  return type === 'text' || type === 'heading' || type === 'link' || type === 'button';
}

export function hasTextField(type: ElementType): boolean {
  return (
    type !== 'divider' &&
    type !== 'image' &&
    type !== 'rect' &&
    type !== 'circle' &&
    type !== 'list' &&
    type !== 'checkbox' &&
    type !== 'toggle' &&
    type !== 'bar-chart' &&
    type !== 'donut' &&
    type !== 'phone-frame'
  );
}

export function hasIcon(type: ElementType): boolean {
  return type === 'icon';
}

export function imageRefOf(el: IWireElement): IImageRef | null {
  const raw = (el.data as Record<string, unknown> | undefined)?.['image'];
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<IImageRef>;
  if (typeof r.src !== 'string' || typeof r.source !== 'string') return null;
  return r as IImageRef;
}

export function hasCheckedState(type: ElementType): boolean {
  return type === 'checkbox' || type === 'toggle';
}

export function isCheckedOf(el: IWireElement): boolean {
  const raw = (el.data as Record<string, unknown> | undefined)?.['checked'];
  if (raw === false) return false;
  return true;
}

export function iconNameOf(el: IWireElement): string {
  const raw = (el.data as Record<string, unknown> | undefined)?.['iconName'];
  return typeof raw === 'string' && raw.length > 0 ? raw : 'smile';
}

export function buttonVariantOf(el: IWireElement): 'primary' | 'secondary' | 'tertiary' {
  const v = el.variant;
  if (v === 'secondary' || v === 'tertiary') return v;
  return 'primary';
}

export function dividerOrientation(el: IWireElement): 'h' | 'v' {
  return el.variant === 'v' ? 'v' : 'h';
}

export const DIVIDER_STROKE_MIN = 1;
export const DIVIDER_STROKE_MAX = 16;
export const DIVIDER_STROKE_DEFAULT = 1;

export function dividerStrokeOf(el: IWireElement): number {
  const raw = (el.data as Record<string, unknown> | undefined)?.['strokeWidth'];
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return DIVIDER_STROKE_DEFAULT;
  return Math.min(DIVIDER_STROKE_MAX, Math.max(DIVIDER_STROKE_MIN, Math.round(n)));
}

export type DividerStyle = 'solid' | 'dashed' | 'dotted';
export const DIVIDER_STYLES: readonly DividerStyle[] = ['solid', 'dashed', 'dotted'];

export function dividerStyleOf(el: IWireElement): DividerStyle {
  const raw = (el.data as Record<string, unknown> | undefined)?.['strokeStyle'];
  return raw === 'dashed' || raw === 'dotted' ? raw : 'solid';
}

export type BorderStyle = 'solid' | 'dashed' | 'dotted';
export const BORDER_STYLES: readonly BorderStyle[] = ['solid', 'dashed', 'dotted'];

export function hasBorder(type: ElementType): boolean {
  return type === 'rect' || type === 'card';
}

export function hasBackground(type: ElementType): boolean {
  return type === 'tag' || type === 'circle';
}

export function borderStyleOf(el: IWireElement): BorderStyle {
  const raw = (el.data as Record<string, unknown> | undefined)?.['borderStyle'];
  return raw === 'dashed' || raw === 'dotted' ? raw : 'solid';
}

export type TextAlign = 'left' | 'center' | 'right';

export function hasRichText(type: ElementType): boolean {
  return type === 'text' || type === 'heading' || type === 'link' || type === 'list';
}

export function textAlignOf(el: IWireElement): TextAlign {
  const raw = (el.data as Record<string, unknown> | undefined)?.['textAlign'];
  return raw === 'center' || raw === 'right' ? raw : 'left';
}

export function isItalicOf(el: IWireElement): boolean {
  return (el.data as Record<string, unknown> | undefined)?.['italic'] === true;
}

export function isUnderlineOf(el: IWireElement): boolean {
  const raw = (el.data as Record<string, unknown> | undefined)?.['underline'];
  if (raw === true) return true;
  if (raw === false) return false;
  return el.type === 'link';
}

export function fontFamilyOf(el: IWireElement): string | null {
  const raw = (el.data as Record<string, unknown> | undefined)?.['fontFamily'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export type FontSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface IFontSizeOption {
  readonly key: FontSize;
  readonly label: string;
  readonly px: number;
}

export const FONT_SIZES: readonly IFontSizeOption[] = [
  { key: 'xs', label: 'Tiny', px: 11 },
  { key: 'sm', label: 'Small', px: 13 },
  { key: 'md', label: 'Default', px: 15 },
  { key: 'lg', label: 'Large', px: 20 },
  { key: 'xl', label: 'Huge', px: 28 },
];

export const DEFAULT_FONT_SIZE: FontSize = 'sm';

export function hasFontSize(type: ElementType): boolean {
  return type === 'text' || type === 'link' || type === 'list';
}

export function fontSizeOf(el: IWireElement): FontSize {
  const raw = (el.data as Record<string, unknown> | undefined)?.['fontSize'];
  if (raw === 'xs' || raw === 'sm' || raw === 'md' || raw === 'lg' || raw === 'xl') return raw;
  return DEFAULT_FONT_SIZE;
}

export const GOOGLE_FONTS: readonly string[] = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Raleway',
  'Oswald',
  'Merriweather',
  'Playfair Display',
  'Source Sans 3',
  'Nunito',
];

export const COLOR_PRESETS: readonly string[] = [
  '#0a0a0a',
  '#737373',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#10b981',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
];
