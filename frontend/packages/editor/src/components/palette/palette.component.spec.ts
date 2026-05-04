import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  IPalette,
  IPaletteItem,
  PALETTES,
  PaletteComponent,
  filterPalettes,
} from './palette.component';

describe('filterPalettes (pure)', () => {
  it('returns all categories (cloned) when query is empty', () => {
    const out = filterPalettes(PALETTES, '');
    expect(out.length).toBe(PALETTES.length);
    expect(out).not.toBe(PALETTES as unknown as IPalette[]);
    expect(out[0].items.length).toBe(PALETTES[0].items.length);
  });

  it('trims whitespace-only queries as empty', () => {
    const out = filterPalettes(PALETTES, '   ');
    expect(out.length).toBe(PALETTES.length);
  });

  it('matches on item label case-insensitively', () => {
    const out = filterPalettes(PALETTES, 'BUTTON');
    expect(out.length).toBe(1);
    expect(out[0].items.length).toBe(1);
    expect(out[0].items[0].type).toBe('button');
  });

  it('matches on item type', () => {
    const out = filterPalettes(PALETTES, 'heading');
    expect(out.flatMap((c) => c.items).some((i) => i.type === 'heading')).toBe(true);
  });

  it('drops categories with no matching items', () => {
    const out = filterPalettes(PALETTES, 'button');
    expect(out.every((c) => c.items.length > 0)).toBe(true);
    expect(out.length).toBeLessThan(PALETTES.length);
  });

  it('returns [] when no item matches', () => {
    expect(filterPalettes(PALETTES, 'zzzxxxnomatch')).toEqual([]);
  });
});

describe('PaletteComponent', () => {
  let fixture: ComponentFixture<PaletteComponent>;
  let cmp: PaletteComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaletteComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(PaletteComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  });

  function qs<T extends HTMLElement>(selector: string): T {
    return fixture.nativeElement.querySelector(selector) as T;
  }

  it('renders all default categories when search is empty', () => {
    const cats = fixture.nativeElement.querySelectorAll('.cat');
    expect(cats.length).toBe(PALETTES.length);
  });

  it('renders correct total count', () => {
    const tag = qs<HTMLElement>('.tag.mono');
    const expected = PALETTES.reduce((s, c) => s + c.items.length, 0);
    expect(tag.textContent?.trim()).toBe(String(expected));
  });

  it('filters items when search value changes', () => {
    cmp.onSearchInput('button');
    fixture.detectChanges();
    const tiles = fixture.nativeElement.querySelectorAll('.ctile');
    expect(tiles.length).toBe(1);
  });

  it('shows empty hint when no items match', () => {
    cmp.onSearchInput('nothingmatchesthis');
    fixture.detectChanges();
    const hint = qs<HTMLElement>('.empty-hint');
    expect(hint).not.toBeNull();
    expect(hint.textContent).toContain('nothingmatchesthis');
  });

  it('emits itemClick with the item when tile clicked', () => {
    const spy = jasmine.createSpy('itemClick');
    cmp.itemClick.subscribe(spy);
    const tile = qs<HTMLElement>('[data-testid="palette-rect"]');
    tile.click();
    expect(spy).toHaveBeenCalledTimes(1);
    const [arg] = spy.calls.first().args;
    expect((arg as IPaletteItem).type).toBe('rect');
    expect((arg as IPaletteItem).w).toBe(200);
  });

  it('sets dataTransfer and emits itemDragStart on dragstart', () => {
    const spy = jasmine.createSpy('itemDragStart');
    cmp.itemDragStart.subscribe(spy);
    const item: IPaletteItem = {
      type: 'button',
      label: 'Button',
      w: 120,
      h: 36,
      icon: 'mouse-pointer-2',
    };
    // Use a plain stub DataTransfer so we can spy on mutations (real DT
    // locks effectAllowed outside an actual browser drag).
    let effectAllowed = '';
    const setData = jasmine.createSpy('setData');
    const dt = {
      get effectAllowed(): string {
        return effectAllowed;
      },
      set effectAllowed(v: string) {
        effectAllowed = v;
      },
      setData,
    } as unknown as DataTransfer;
    const ev = { dataTransfer: dt } as unknown as DragEvent;
    cmp.onDragStart(ev, item);
    expect(effectAllowed).toBe('copy');
    expect(setData).toHaveBeenCalledWith('text/mocktail-element', 'button');
    expect(spy).toHaveBeenCalledWith({ item, ev });
  });

  it('tolerates missing dataTransfer on dragstart', () => {
    const spy = jasmine.createSpy('itemDragStart');
    cmp.itemDragStart.subscribe(spy);
    const item: IPaletteItem = {
      type: 'rect',
      label: 'Rect',
      w: 200,
      h: 120,
      icon: 'square',
    };
    const ev = { dataTransfer: null } as unknown as DragEvent;
    expect(() => cmp.onDragStart(ev, item)).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });

  it('emits itemDragEnd', () => {
    const spy = jasmine.createSpy('itemDragEnd');
    cmp.itemDragEnd.subscribe(spy);
    cmp.onDragEnd();
    expect(spy).toHaveBeenCalled();
  });

  it('emits collapseToggle when collapse button clicked', () => {
    const spy = jasmine.createSpy('collapseToggle');
    cmp.collapseToggle.subscribe(spy);
    const btn = qs<HTMLButtonElement>('[data-testid="collapse-left"]');
    btn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('applies collapsed class and aria-hidden when collapsed input is true', () => {
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector(
      '[data-testid="components-panel"]',
    ) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.classList.contains('collapsed')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('has no aria-hidden when not collapsed', () => {
    const panel = fixture.nativeElement.querySelector(
      '[data-testid="components-panel"]',
    ) as HTMLElement;
    expect(panel.getAttribute('aria-hidden')).toBeNull();
  });

  it('updates search input DOM value via input event', () => {
    const spy = jasmine.createSpy('change');
    const input = qs<HTMLInputElement>('[data-testid="palette-search"]');
    input.value = 'text';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(cmp.searchValue()).toBe('text');
    spy();
  });

  it('honors custom categories input', () => {
    const custom: IPalette[] = [
      { label: 'One', items: [{ type: 'rect', label: 'R', w: 10, h: 10, icon: 'square' }] },
    ];
    fixture.componentRef.setInput('categories', custom);
    fixture.detectChanges();
    const cats = fixture.nativeElement.querySelectorAll('.cat');
    expect(cats.length).toBe(1);
    expect(cmp.totalCount()).toBe(1);
  });
});
