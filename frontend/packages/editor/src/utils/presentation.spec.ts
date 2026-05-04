import { IWireElement } from '@mocktail/projects';
import { peerInitials, transformFor } from './presentation';

function el(overrides: Partial<IWireElement> = {}): IWireElement {
  return {
    id: 'x',
    type: 'text',
    x: 0,
    y: 0,
    w: 100,
    h: 30,
    rotation: 0,
    zIndex: 0,
    ...overrides,
  } as IWireElement;
}

describe('peerInitials', () => {
  it('returns "?" for empty string', () => {
    expect(peerInitials('')).toBe('?');
  });

  it('returns "?" for whitespace-only names', () => {
    expect(peerInitials('   ')).toBe('?');
    expect(peerInitials('\t\n')).toBe('?');
  });

  it('returns the first two characters uppercased for a single-token name', () => {
    expect(peerInitials('Junaid')).toBe('JU');
  });

  it('upper-cases single-token names already lowercase', () => {
    expect(peerInitials('alice')).toBe('AL');
  });

  it('trims and collapses multi-whitespace for a two-token name', () => {
    expect(peerInitials('  Junaid   Ahmed  ')).toBe('JA');
  });

  it('uses first-of-first + first-of-last for 3+ tokens', () => {
    expect(peerInitials('Junaid middle Ahmed')).toBe('JA');
  });

  it('uppercases initials from lowercase tokens', () => {
    expect(peerInitials('alice bob')).toBe('AB');
  });
});

describe('transformFor', () => {
  it('returns "rotate(Ndeg)" when rotation is a non-zero number', () => {
    expect(transformFor(el({ rotation: 45 }))).toBe('rotate(45deg)');
    expect(transformFor(el({ rotation: -90 }))).toBe('rotate(-90deg)');
    expect(transformFor(el({ rotation: 180.5 }))).toBe('rotate(180.5deg)');
  });

  it('returns "" when rotation is 0 (falsy)', () => {
    expect(transformFor(el({ rotation: 0 }))).toBe('');
  });

  it('returns "" when rotation is missing', () => {
    const anon = { id: 'x', type: 'text', x: 0, y: 0, w: 10, h: 10, zIndex: 0 } as IWireElement;
    expect(transformFor(anon)).toBe('');
  });
});
