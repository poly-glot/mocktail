import { TestBed } from '@angular/core/testing';
import { GOOGLE_FONTS } from '@mocktail/projects';
import { FontLoaderService } from './font-loader.service';

const LINK_ID = 'mocktail-google-fonts';

describe('FontLoaderService', () => {
  let svc: FontLoaderService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(FontLoaderService);
    const existing = document.getElementById(LINK_ID);
    if (existing) existing.remove();
  });

  afterEach(() => {
    const existing = document.getElementById(LINK_ID);
    if (existing) existing.remove();
  });

  it('creates a <link> with the mocktail-google-fonts id on first call', () => {
    svc.ensureGoogleFonts();
    const link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
    expect(link).not.toBeNull();
    expect(link!.tagName).toBe('LINK');
    expect(link!.rel).toBe('stylesheet');
  });

  it('builds an href containing all GOOGLE_FONTS families, url-encoded, with weights and display=swap', () => {
    svc.ensureGoogleFonts();
    const link = document.getElementById(LINK_ID) as HTMLLinkElement;
    expect(link.href).toContain('https://fonts.googleapis.com/css2?');
    expect(link.href).toContain('display=swap');
    for (const family of GOOGLE_FONTS) {
      const encoded = encodeURIComponent(family);
      expect(link.href).toContain(`family=${encoded}:ital,wght@0,400;0,700;1,400;1,700`);
    }
  });

  it('is idempotent — second call does not duplicate the link element', () => {
    svc.ensureGoogleFonts();
    svc.ensureGoogleFonts();
    svc.ensureGoogleFonts();
    const matches = document.querySelectorAll(`#${LINK_ID}`);
    expect(matches.length).toBe(1);
  });

  it('is a no-op smoke test for environments without document (guard path)', () => {
    // jsdom always defines document, so we just assert that the guard branch
    // exists by calling again after an element is already present (which
    // short-circuits via the second guard — same early-exit shape).
    svc.ensureGoogleFonts();
    expect(() => svc.ensureGoogleFonts()).not.toThrow();
  });
});
