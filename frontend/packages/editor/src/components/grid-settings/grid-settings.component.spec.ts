import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IGridConfig } from '@mocktail/projects';
import { GridSettingsComponent, clampGridNumber } from './grid-settings.component';

function cfg(overrides: Partial<IGridConfig> = {}): IGridConfig {
  return { visible: true, columns: 12, gutter: 16, margin: 40, snap: true, ...overrides };
}

describe('clampGridNumber (pure)', () => {
  it('returns null for NaN', () => {
    expect(clampGridNumber('columns', 'abc')).toBeNull();
    expect(clampGridNumber('gutter', '')).toBeNull();
  });

  it('returns null for negative values', () => {
    expect(clampGridNumber('gutter', '-1')).toBeNull();
    expect(clampGridNumber('margin', '-100')).toBeNull();
  });

  it('floors and caps columns at 64', () => {
    expect(clampGridNumber('columns', '12.9')).toBe(12);
    expect(clampGridNumber('columns', '999')).toBe(64);
    expect(clampGridNumber('columns', '0')).toBe(0);
  });

  it('caps gutter/margin at 1000', () => {
    expect(clampGridNumber('gutter', '5000')).toBe(1000);
    expect(clampGridNumber('margin', '500')).toBe(500);
    expect(clampGridNumber('gutter', '10.5')).toBe(10.5);
  });
});

describe('GridSettingsComponent', () => {
  let fixture: ComponentFixture<GridSettingsComponent>;
  let cmp: GridSettingsComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GridSettingsComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(GridSettingsComponent);
    cmp = fixture.componentInstance;
    fixture.componentRef.setInput('config', cfg());
    fixture.detectChanges();
  });

  function setConfig(c: IGridConfig): void {
    fixture.componentRef.setInput('config', c);
    fixture.detectChanges();
  }

  function el<T extends HTMLElement>(testid: string): T {
    return fixture.nativeElement.querySelector(`[data-testid="${testid}"]`) as T;
  }

  it('renders with visible/snap checked per config', () => {
    expect(el<HTMLInputElement>('grid-visible').checked).toBe(true);
    expect(el<HTMLInputElement>('grid-snap').checked).toBe(true);
  });

  it('reflects unchecked visible/snap when config has those off', () => {
    setConfig(cfg({ visible: false, snap: false }));
    expect(el<HTMLInputElement>('grid-visible').checked).toBe(false);
    expect(el<HTMLInputElement>('grid-snap').checked).toBe(false);
  });

  it('shows columns/gutter/margin values from config', () => {
    setConfig(cfg({ columns: 6, gutter: 8, margin: 20 }));
    expect(el<HTMLInputElement>('grid-columns').value).toBe('6');
    expect(el<HTMLInputElement>('grid-gutter').value).toBe('8');
    expect(el<HTMLInputElement>('grid-margin').value).toBe('20');
  });

  it('emits configChange with flipped visible on toggleVisible', () => {
    const spy = jasmine.createSpy('configChange');
    cmp.configChange.subscribe(spy);
    cmp.toggleVisible();
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ visible: false, columns: 12 }));
  });

  it('emits configChange with flipped snap on toggleSnap', () => {
    const spy = jasmine.createSpy('configChange');
    cmp.configChange.subscribe(spy);
    cmp.toggleSnap();
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ snap: false }));
  });

  it('toggles snap from undefined to true', () => {
    setConfig({ visible: true, columns: 12, gutter: 16, margin: 40 });
    const spy = jasmine.createSpy('configChange');
    cmp.configChange.subscribe(spy);
    cmp.toggleSnap();
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ snap: true }));
  });

  it('emits configChange with clamped columns', () => {
    const spy = jasmine.createSpy('configChange');
    cmp.configChange.subscribe(spy);
    cmp.updateNumber('columns', '8.7');
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ columns: 8 }));
  });

  it('emits configChange with gutter', () => {
    const spy = jasmine.createSpy('configChange');
    cmp.configChange.subscribe(spy);
    cmp.updateNumber('gutter', '24');
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ gutter: 24 }));
  });

  it('emits configChange with margin', () => {
    const spy = jasmine.createSpy('configChange');
    cmp.configChange.subscribe(spy);
    cmp.updateNumber('margin', '50');
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ margin: 50 }));
  });

  it('does not emit for invalid numbers', () => {
    const spy = jasmine.createSpy('configChange');
    cmp.configChange.subscribe(spy);
    cmp.updateNumber('columns', 'abc');
    cmp.updateNumber('gutter', '-5');
    expect(spy).not.toHaveBeenCalled();
  });

  it('fires toggleVisible when checkbox clicked in DOM', () => {
    const spy = jasmine.createSpy('configChange');
    cmp.configChange.subscribe(spy);
    const input = el<HTMLInputElement>('grid-visible');
    input.click();
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ visible: false }));
  });

  it('fires updateNumber when columns input changed in DOM', () => {
    const spy = jasmine.createSpy('configChange');
    cmp.configChange.subscribe(spy);
    const input = el<HTMLInputElement>('grid-columns');
    input.value = '3';
    input.dispatchEvent(new Event('input'));
    expect(spy).toHaveBeenCalledWith(jasmine.objectContaining({ columns: 3 }));
  });
});
