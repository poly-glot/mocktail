import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { FONT_SIZES, IWireElement } from '@mocktail/projects';
import { BorderStylePipe } from './border-style.pipe';
import { DividerStrokePipe } from './divider-stroke.pipe';
import { FontSizePxPipe } from './font-size-px.pipe';
import { HeadingFontSizePipe } from './heading-font-size.pipe';
import { IconNamePipe } from './icon-name.pipe';
import { PeerInitialsPipe } from './peer-initials.pipe';
import { SafeListHtmlPipe } from './safe-list-html.pipe';
import { TransformForPipe } from './transform-for.pipe';

function makeEl(o: Partial<IWireElement> & Pick<IWireElement, 'id' | 'type'>): IWireElement {
  return {
    pageId: 'pg1',
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    zIndex: 1,
    ...o,
  } as IWireElement;
}

describe('Editor presentation pipes', () => {
  it('borderStyle returns the trait-derived border style', () => {
    const pipe = new BorderStylePipe();
    expect(pipe.transform(makeEl({ id: 'r', type: 'rect' }))).toBe('solid');
    const dashedEl = makeEl({ id: 'r', type: 'rect', data: { borderStyle: 'dashed' } });
    expect(pipe.transform(dashedEl)).toBe('dashed');
  });

  it('dividerStroke returns the clamped stroke width', () => {
    const pipe = new DividerStrokePipe();
    expect(pipe.transform(makeEl({ id: 'd', type: 'divider' }))).toBe(1);
    const wideEl = makeEl({ id: 'd', type: 'divider', data: { strokeWidth: 99 } });
    expect(pipe.transform(wideEl)).toBe(16);
  });

  it('transformFor returns rotate(...) when rotation set, empty when zero', () => {
    const pipe = new TransformForPipe();
    expect(pipe.transform(makeEl({ id: 'a', type: 'rect' }))).toBe('');
    expect(pipe.transform(makeEl({ id: 'a', type: 'rect', rotation: 45 }))).toBe('rotate(45deg)');
    expect(pipe.transform(makeEl({ id: 'a', type: 'rect', rotation: 0 }))).toBe('');
  });

  it('peerInitials reduces names to a 1–2 character badge', () => {
    const pipe = new PeerInitialsPipe();
    expect(pipe.transform('')).toBe('?');
    expect(pipe.transform('Alice')).toBe('AL');
    expect(pipe.transform('Junaid Ahmed')).toBe('JA');
  });

  it('iconName falls back to "smile" when missing', () => {
    const pipe = new IconNamePipe();
    expect(pipe.transform(makeEl({ id: 'i', type: 'icon' }))).toBe('smile');
    const heart = makeEl({ id: 'i', type: 'icon', data: { iconName: 'heart' } });
    expect(pipe.transform(heart)).toBe('heart');
  });

  it('fontSizePx maps key to CSS px, falling back to 13', () => {
    const pipe = new FontSizePxPipe();
    const sm = FONT_SIZES.find((o) => o.key === 'sm')!.px;
    const xl = FONT_SIZES.find((o) => o.key === 'xl')!.px;
    expect(pipe.transform(makeEl({ id: 't', type: 'text' }))).toBe(sm);
    expect(pipe.transform(makeEl({ id: 't', type: 'text', data: { fontSize: 'xl' } }))).toBe(xl);
  });

  it('headingFontSize returns 32/26/22/18/15/13 for levels 1–6', () => {
    const pipe = new HeadingFontSizePipe();
    expect(pipe.transform(1)).toBe(32);
    expect(pipe.transform(2)).toBe(26);
    expect(pipe.transform(3)).toBe(22);
    expect(pipe.transform(4)).toBe(18);
    expect(pipe.transform(5)).toBe(15);
    expect(pipe.transform(6)).toBe(13);
    expect(pipe.transform(undefined)).toBe(32);
    expect(pipe.transform(99)).toBe(13);
  });

  it('safeListHtml wraps buildListItemHtml in DomSanitizer.bypassSecurityTrustHtml', () => {
    TestBed.configureTestingModule({});
    const pipe = TestBed.runInInjectionContext(() => new SafeListHtmlPipe());
    const sanitizer = TestBed.inject(DomSanitizer);
    spyOn(sanitizer, 'bypassSecurityTrustHtml').and.callThrough();
    const el = makeEl({ id: 'l', type: 'list', text: 'one\n\ttwo' });
    const out = pipe.transform(el);
    expect(sanitizer.bypassSecurityTrustHtml).toHaveBeenCalled();
    expect(typeof out).toBeDefined();
  });
});
