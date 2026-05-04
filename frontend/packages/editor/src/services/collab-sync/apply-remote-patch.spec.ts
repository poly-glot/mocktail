import { applyRemotePatch } from './apply-remote-patch';

describe('applyRemotePatch', () => {
  it('assigns scalar fields from the patch', () => {
    expect(applyRemotePatch({ x: 1, y: 2 }, { x: 99 })).toEqual({ x: 99, y: 2 });
  });

  it('assigns multiple fields in one pass', () => {
    expect(applyRemotePatch({ x: 0, y: 0, w: 10 }, { x: 1, y: 2, w: 3 })).toEqual({
      x: 1,
      y: 2,
      w: 3,
    });
  });

  it('deletes fields whose patch value is null', () => {
    const out = applyRemotePatch({ a: 1, b: 2 }, { a: null });
    expect(out).toEqual({ b: 2 } as { a: number; b: number });
  });

  it('deletes fields whose patch value is undefined', () => {
    const out = applyRemotePatch({ a: 1, b: 2 }, { a: undefined });
    expect(out).toEqual({ b: 2 } as { a: number; b: number });
  });

  it('does not mutate the input', () => {
    const input = { x: 1 };
    applyRemotePatch(input, { x: 2 });
    expect(input).toEqual({ x: 1 });
  });

  it('returns a new object reference even on an empty patch', () => {
    const input = { x: 1 };
    const out = applyRemotePatch(input, {});
    expect(out).not.toBe(input);
    expect(out).toEqual({ x: 1 });
  });

  it('keeps untouched fields', () => {
    expect(applyRemotePatch({ x: 1, y: 2, z: 3 }, { y: 99 })).toEqual({ x: 1, y: 99, z: 3 });
  });
});
