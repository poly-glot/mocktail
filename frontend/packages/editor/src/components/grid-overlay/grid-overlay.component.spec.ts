import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IGridConfig } from '@mocktail/projects';
import { GridOverlayComponent, computeColumnRegions } from './grid-overlay.component';

function cfg(overrides: Partial<IGridConfig> = {}): IGridConfig {
  return { visible: true, columns: 12, gutter: 16, margin: 40, snap: true, ...overrides };
}

describe('computeColumnRegions (pure)', () => {
  it('returns [] when config.visible is false', () => {
    expect(computeColumnRegions(cfg({ visible: false }), 1200)).toEqual([]);
  });

  it('returns [] when inner width is <= 0', () => {
    expect(computeColumnRegions(cfg({ margin: 600 }), 1200)).toEqual([]);
    expect(computeColumnRegions(cfg({ margin: 700 }), 1200)).toEqual([]);
  });

  it('returns [] when columns <= 0', () => {
    expect(computeColumnRegions(cfg({ columns: 0 }), 1200)).toEqual([]);
  });

  it('returns [] when computed column width is <= 0', () => {
    expect(computeColumnRegions(cfg({ columns: 100, gutter: 50 }), 500)).toEqual([]);
  });

  it('computes N regions with correct left/width for 12 columns', () => {
    const out = computeColumnRegions(cfg({ columns: 12, gutter: 16, margin: 40 }), 1200);
    expect(out.length).toBe(12);
    // inner = 1200 - 80 = 1120; colW = (1120 - 16*11) / 12 = (1120 - 176)/12 = 944/12 ≈ 78.6667
    expect(out[0].left).toBe(40);
    expect(out[0].width).toBeCloseTo(78.6667, 3);
    expect(out[11].left).toBeCloseTo(40 + 11 * (78.6667 + 16), 2);
    expect(out[11].left + out[11].width).toBeCloseTo(1160, 2);
  });

  it('handles zero gutter correctly', () => {
    const out = computeColumnRegions(cfg({ columns: 4, gutter: 0, margin: 0 }), 400);
    expect(out.length).toBe(4);
    expect(out[0].width).toBe(100);
    expect(out[0].left).toBe(0);
    expect(out[3].left).toBe(300);
  });

  it('handles single column', () => {
    const out = computeColumnRegions(cfg({ columns: 1, gutter: 16, margin: 10 }), 500);
    expect(out.length).toBe(1);
    expect(out[0].left).toBe(10);
    expect(out[0].width).toBe(480);
  });
});

describe('GridOverlayComponent', () => {
  let fixture: ComponentFixture<GridOverlayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GridOverlayComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(GridOverlayComponent);
  });

  function setInputs(config: IGridConfig, pageWidth: number): void {
    fixture.componentRef.setInput('config', config);
    fixture.componentRef.setInput('pageWidth', pageWidth);
    fixture.detectChanges();
  }

  it('renders nothing when config.visible is false', () => {
    setInputs(cfg({ visible: false }), 1200);
    const overlay = fixture.nativeElement.querySelector('[data-testid="grid-overlay"]');
    expect(overlay).toBeNull();
  });

  it('renders overlay wrapper when visible=true', () => {
    setInputs(cfg(), 1200);
    const overlay = fixture.nativeElement.querySelector('[data-testid="grid-overlay"]');
    expect(overlay).not.toBeNull();
  });

  it('renders correct number of column divs', () => {
    setInputs(cfg({ columns: 6 }), 1200);
    const cols = fixture.nativeElement.querySelectorAll('.grid-col');
    expect(cols.length).toBe(6);
  });

  it('renders no columns when inner width is non-positive', () => {
    setInputs(cfg({ margin: 700 }), 1200);
    const cols = fixture.nativeElement.querySelectorAll('.grid-col');
    expect(cols.length).toBe(0);
  });

  it('applies computed left and width styles', () => {
    setInputs(cfg({ columns: 2, gutter: 0, margin: 0 }), 200);
    const cols = fixture.nativeElement.querySelectorAll('.grid-col') as NodeListOf<HTMLElement>;
    expect(cols[0].style.left).toBe('0px');
    expect(cols[0].style.width).toBe('100px');
    expect(cols[1].style.left).toBe('100px');
  });

  it('reacts to config input change', () => {
    setInputs(cfg({ columns: 3 }), 1200);
    expect(fixture.nativeElement.querySelectorAll('.grid-col').length).toBe(3);
    setInputs(cfg({ columns: 6 }), 1200);
    expect(fixture.nativeElement.querySelectorAll('.grid-col').length).toBe(6);
  });

  it('reacts to pageWidth input change', () => {
    setInputs(cfg({ columns: 2, gutter: 0, margin: 0 }), 200);
    let cols = fixture.nativeElement.querySelectorAll('.grid-col') as NodeListOf<HTMLElement>;
    expect(cols[0].style.width).toBe('100px');
    setInputs(cfg({ columns: 2, gutter: 0, margin: 0 }), 400);
    cols = fixture.nativeElement.querySelectorAll('.grid-col') as NodeListOf<HTMLElement>;
    expect(cols[0].style.width).toBe('200px');
  });

  it('removes overlay when config flips to not visible', () => {
    setInputs(cfg({ visible: true }), 1200);
    expect(fixture.nativeElement.querySelector('[data-testid="grid-overlay"]')).not.toBeNull();
    setInputs(cfg({ visible: false }), 1200);
    expect(fixture.nativeElement.querySelector('[data-testid="grid-overlay"]')).toBeNull();
  });
});
