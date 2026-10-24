import { decodeElement, stripUndefined } from './element-codec';

describe('stripUndefined', () => {
  it('drops undefined keys recursively and keeps arrays', () => {
    const out = stripUndefined({
      a: 1,
      b: undefined,
      c: { d: undefined, e: [1, { f: undefined }] },
    });
    expect(JSON.stringify(out)).toBe('{"a":1,"c":{"e":[1,{}]}}');
  });

  it('leaves Timestamp-like and FieldValue-like sentinels untouched', () => {
    const ts = { toDate: () => new Date(), x: undefined };
    const fv = { _methodName: 'serverTimestamp', x: undefined };
    expect(stripUndefined({ ts, fv }).ts).toBe(ts);
    expect(stripUndefined({ ts, fv }).fv).toBe(fv);
  });
});

describe('decodeElement', () => {
  it('applies geometry defaults', () => {
    const el = decodeElement('e1', { type: 'rect', pageId: 'pg' });
    expect(el).toEqual(
      jasmine.objectContaining({ id: 'e1', x: 0, y: 0, w: 120, h: 40, zIndex: 0, locked: false }),
    );
  });

  it('defaults variant per type and heading level to 1', () => {
    expect(decodeElement('b', { type: 'button' }).variant).toBe('primary');
    expect(decodeElement('d', { type: 'divider' }).variant).toBe('h');
    expect(decodeElement('h', { type: 'heading' }).level).toBe(1);
    expect(decodeElement('t', { type: 'text' }).variant).toBeUndefined();
  });

  it('preserves explicit values', () => {
    const el = decodeElement('b', { type: 'button', variant: 'tertiary', level: 3, locked: true });
    expect(el.variant).toBe('tertiary');
    expect(el.level).toBe(3);
    expect(el.locked).toBeTrue();
  });
});
