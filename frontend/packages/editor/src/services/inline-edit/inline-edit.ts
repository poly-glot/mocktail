/* eslint-disable no-control-regex */
const FORBIDDEN_CONTROL_CHARS =
  /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
/* eslint-enable no-control-regex */

export function sanitizeInlineText(raw: string): string {
  return raw.replace(FORBIDDEN_CONTROL_CHARS, '').trim();
}

export function shouldCommitOnEnter(elementType: string, shiftKey: boolean): boolean {
  if (shiftKey) return false;
  return elementType !== 'text' && elementType !== 'list';
}

export function shouldIndentOnTab(elementType: string): boolean {
  return elementType === 'list';
}

export function outdentLineAtSelection(): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  if (!node || node.nodeType !== Node.TEXT_NODE) return false;
  const text = node.textContent ?? '';
  const offset = sel.anchorOffset;
  const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
  if (text[lineStart] !== '\t') return false;
  node.textContent = text.slice(0, lineStart) + text.slice(lineStart + 1);
  const range = document.createRange();
  const newOffset = Math.max(0, offset - 1);
  range.setStart(node, newOffset);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

export function insertPlainTextAtSelection(text: string): boolean {
  if (!text) return false;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}
