const BULLETS = ['\u2022', '\u25E6', '\u25AA'] as const;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Pure string → string renderer for list-element HTML. No sanitizer dependency:
 * callers are expected to wrap the result via DomSanitizer.bypassSecurityTrustHtml.
 *
 * Behavior:
 *  - Empty text yields a single default "List item" div.
 *  - Each line maps to one `<div class="list-item level-N">` where N is the
 *    leading tab count clamped to 0..2.
 *  - Line content is html-escaped; an empty body renders as `&nbsp;`.
 */
export function buildListItemHtml(text: string): string {
  const lines = text.length > 0 ? text.split('\n') : ['List item'];
  return lines
    .map((line) => {
      const m = line.match(/^\t*/);
      const tabs = m ? m[0].length : 0;
      const level = Math.min(tabs, 2);
      const content = escapeHtml(line.slice(tabs));
      return `<div class="list-item level-${level}"><span class="bullet">${BULLETS[level]}</span><span class="list-text">${content || '&nbsp;'}</span></div>`;
    })
    .join('');
}
