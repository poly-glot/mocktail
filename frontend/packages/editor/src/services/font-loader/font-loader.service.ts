import { Injectable } from '@angular/core';
import { GOOGLE_FONTS } from '@mocktail/projects';

const LINK_ID = 'mocktail-google-fonts';

@Injectable({ providedIn: 'root' })
export class FontLoaderService {
  public ensureGoogleFonts(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById(LINK_ID)) return;
    const families = GOOGLE_FONTS.map(
      (f) => `family=${encodeURIComponent(f)}:ital,wght@0,400;0,700;1,400;1,700`,
    ).join('&');
    const link = document.createElement('link');
    link.id = LINK_ID;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
  }
}
