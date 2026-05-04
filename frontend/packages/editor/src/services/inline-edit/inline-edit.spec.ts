import {
  insertPlainTextAtSelection,
  outdentLineAtSelection,
  sanitizeInlineText,
  shouldCommitOnEnter,
  shouldIndentOnTab,
} from './inline-edit';

describe('sanitizeInlineText', () => {
  it('leaves plain text unchanged', () => {
    expect(sanitizeInlineText('Hello world')).toBe('Hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeInlineText('  Hello  ')).toBe('Hello');
    expect(sanitizeInlineText('\t\nText\n\t')).toBe('Text');
  });

  it('strips C0 control chars (\\u0000–\\u0008)', () => {
    expect(sanitizeInlineText('a\u0000b\u0007c')).toBe('abc');
  });

  it('strips zero-width and directional chars (\\u200B–\\u200F)', () => {
    expect(sanitizeInlineText('a\u200Bb\u200Cc\u200Dd')).toBe('abcd');
  });

  it('strips bidi override chars (\\u202A–\\u202E)', () => {
    expect(sanitizeInlineText('safe\u202Espoof\u202Eend')).toBe('safespoofend');
  });

  it('strips isolate chars (\\u2066–\\u2069)', () => {
    expect(sanitizeInlineText('x\u2066y\u2067z\u2068q\u2069r')).toBe('xyzqr');
  });

  it('returns empty string for all-whitespace input', () => {
    expect(sanitizeInlineText('   \t  \n ')).toBe('');
  });

  it('preserves allowed whitespace in the middle (newlines, tabs)', () => {
    expect(sanitizeInlineText('line1\nline2\ttab')).toBe('line1\nline2\ttab');
  });

  it('strips DEL character (\\u007F)', () => {
    expect(sanitizeInlineText('x\u007Fy')).toBe('xy');
  });
});

describe('shouldCommitOnEnter', () => {
  it('commits for non-text types when shift is not held', () => {
    expect(shouldCommitOnEnter('heading', false)).toBe(true);
    expect(shouldCommitOnEnter('button', false)).toBe(true);
    expect(shouldCommitOnEnter('link', false)).toBe(true);
  });

  it('does NOT commit for text type (multiline allowed)', () => {
    expect(shouldCommitOnEnter('text', false)).toBe(false);
  });

  it('does NOT commit for list type (multiline allowed)', () => {
    expect(shouldCommitOnEnter('list', false)).toBe(false);
  });

  it('does NOT commit when shift is held (newline intent)', () => {
    expect(shouldCommitOnEnter('heading', true)).toBe(false);
    expect(shouldCommitOnEnter('button', true)).toBe(false);
  });
});

describe('shouldIndentOnTab', () => {
  it('is true only for list', () => {
    expect(shouldIndentOnTab('list')).toBe(true);
    expect(shouldIndentOnTab('text')).toBe(false);
    expect(shouldIndentOnTab('heading')).toBe(false);
    expect(shouldIndentOnTab('button')).toBe(false);
  });
});

describe('outdentLineAtSelection', () => {
  let host: HTMLSpanElement;

  beforeEach(() => {
    host = document.createElement('span');
    host.contentEditable = 'true';
    document.body.appendChild(host);
    host.focus();
  });

  afterEach(() => {
    document.body.removeChild(host);
    window.getSelection()?.removeAllRanges();
  });

  it('returns false when no selection exists', () => {
    window.getSelection()?.removeAllRanges();
    expect(outdentLineAtSelection()).toBe(false);
  });

  it('removes a leading tab from the current line', () => {
    const text = document.createTextNode('\tindented');
    host.appendChild(text);
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text, 4);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(outdentLineAtSelection()).toBe(true);
    expect(text.textContent).toBe('indented');
  });

  it('returns false when the current line has no leading tab', () => {
    const text = document.createTextNode('plain');
    host.appendChild(text);
    const sel = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    expect(outdentLineAtSelection()).toBe(false);
  });
});

describe('insertPlainTextAtSelection', () => {
  let host: HTMLSpanElement;

  beforeEach(() => {
    host = document.createElement('span');
    host.contentEditable = 'true';
    document.body.appendChild(host);
    host.focus();
  });

  afterEach(() => {
    document.body.removeChild(host);
    window.getSelection()?.removeAllRanges();
  });

  it('returns false for empty text', () => {
    expect(insertPlainTextAtSelection('')).toBe(false);
  });

  it('returns false when no selection range exists', () => {
    window.getSelection()?.removeAllRanges();
    expect(insertPlainTextAtSelection('hello')).toBe(false);
  });

  it('inserts plain text into an editable selection', () => {
    const range = document.createRange();
    range.selectNodeContents(host);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = insertPlainTextAtSelection('plain');
    expect(ok).toBe(true);
    expect(host.innerHTML).toBe('plain');
  });
});
