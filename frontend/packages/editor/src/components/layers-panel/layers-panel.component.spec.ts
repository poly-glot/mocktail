import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IWireElement } from '@mocktail/projects';
import {
  LayersPanelComponent,
  computeDropPosition,
  iconForType,
  labelForElement,
} from './layers-panel.component';

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

describe('iconForType / labelForElement / computeDropPosition (pure)', () => {
  it('iconForType returns preset icon', () => {
    expect(iconForType('rect')).toBe('square');
    expect(iconForType('button')).toBe('mouse-pointer-2');
  });

  it('iconForType falls back to square for unknown', () => {
    expect(iconForType('nonexistent' as never)).toBe('square');
  });

  it('labelForElement returns trimmed text when present', () => {
    expect(labelForElement(makeEl({ id: 'a', type: 'text', text: '  Hello  ' }))).toBe('Hello');
  });

  it('labelForElement returns preset label when text is empty', () => {
    expect(labelForElement(makeEl({ id: 'b', type: 'button' }))).toBe('Button');
    expect(labelForElement(makeEl({ id: 'c', type: 'rect', text: '' }))).toBe('Rect');
  });

  it('labelForElement returns type as last resort', () => {
    expect(labelForElement(makeEl({ id: 'd', type: 'unknown' as never }))).toBe('unknown');
  });

  it('computeDropPosition splits at midpoint', () => {
    const rect = { top: 100, height: 40 } as DOMRect;
    expect(computeDropPosition(110, rect)).toBe('above');
    expect(computeDropPosition(125, rect)).toBe('below');
    expect(computeDropPosition(120, rect)).toBe('below'); // exact midpoint → below
  });
});

describe('LayersPanelComponent', () => {
  let fixture: ComponentFixture<LayersPanelComponent>;
  let cmp: LayersPanelComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LayersPanelComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(LayersPanelComponent);
    cmp = fixture.componentInstance;
    fixture.componentRef.setInput('layers', []);
    fixture.detectChanges();
  });

  function setLayers(layers: IWireElement[]): void {
    fixture.componentRef.setInput('layers', layers);
    fixture.detectChanges();
  }

  it('shows empty hint when no layers', () => {
    setLayers([]);
    expect(fixture.nativeElement.querySelector('.empty-hint')).not.toBeNull();
  });

  it('renders a row per layer', () => {
    setLayers([
      makeEl({ id: 'a', type: 'rect' }),
      makeEl({ id: 'b', type: 'text' }),
      makeEl({ id: 'c', type: 'button' }),
    ]);
    expect(fixture.nativeElement.querySelectorAll('.layer-row').length).toBe(3);
  });

  it('reflects selectedId with a .selected class', () => {
    setLayers([makeEl({ id: 'a', type: 'rect' }), makeEl({ id: 'b', type: 'rect' })]);
    fixture.componentRef.setInput('selectedId', 'b');
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.layer-row') as NodeListOf<HTMLElement>;
    expect(rows[0].classList.contains('selected')).toBe(false);
    expect(rows[1].classList.contains('selected')).toBe(true);
  });

  it('emits layerSelect on row click', () => {
    setLayers([makeEl({ id: 'a', type: 'rect' })]);
    const spy = jasmine.createSpy('layerSelect');
    cmp.layerSelect.subscribe(spy);
    const row = fixture.nativeElement.querySelector('[data-testid="layer-a"]') as HTMLElement;
    row.click();
    expect(spy).toHaveBeenCalledWith('a');
  });

  it('emits lockToggle and stops propagation on lock click', () => {
    setLayers([makeEl({ id: 'a', type: 'rect' })]);
    const lockSpy = jasmine.createSpy('lockToggle');
    const selectSpy = jasmine.createSpy('layerSelect');
    cmp.lockToggle.subscribe(lockSpy);
    cmp.layerSelect.subscribe(selectSpy);
    const btn = fixture.nativeElement.querySelector('[data-testid="layer-lock-a"]') as HTMLElement;
    btn.click();
    expect(lockSpy).toHaveBeenCalledWith('a');
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('shows .locked class when element is locked', () => {
    setLayers([makeEl({ id: 'a', type: 'rect', locked: true })]);
    const row = fixture.nativeElement.querySelector('.layer-row') as HTMLElement;
    expect(row.classList.contains('locked')).toBe(true);
  });

  it('emits collapseToggle on collapse button', () => {
    const spy = jasmine.createSpy('collapseToggle');
    cmp.collapseToggle.subscribe(spy);
    const btn = fixture.nativeElement.querySelector('[data-testid="collapse-left"]') as HTMLElement;
    btn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('applies .dragging to the row being dragged', () => {
    setLayers([makeEl({ id: 'a', type: 'rect' })]);
    cmp.dragLayerId.set('a');
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('.layer-row') as HTMLElement;
    expect(row.classList.contains('dragging')).toBe(true);
  });

  it('applies .drop-above when dropTarget is above', () => {
    setLayers([makeEl({ id: 'a', type: 'rect' })]);
    cmp.dropTarget.set({ id: 'a', position: 'above' });
    fixture.detectChanges();
    const row = fixture.nativeElement.querySelector('.layer-row') as HTMLElement;
    expect(row.classList.contains('drop-above')).toBe(true);
    expect(row.classList.contains('drop-below')).toBe(false);
  });

  it('onDragStart sets dragLayerId and dataTransfer fields', () => {
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
    cmp.onDragStart(ev, 'a');
    expect(cmp.dragLayerId()).toBe('a');
    expect(effectAllowed).toBe('move');
    expect(setData).toHaveBeenCalledWith('text/plain', 'layer:a');
  });

  it('onDragStart tolerates missing dataTransfer', () => {
    const ev = { dataTransfer: null } as unknown as DragEvent;
    expect(() => cmp.onDragStart(ev, 'a')).not.toThrow();
    expect(cmp.dragLayerId()).toBe('a');
  });

  it('onDragOver is a no-op when no drag in progress', () => {
    const prevent = jasmine.createSpy('preventDefault');
    const ev = {
      preventDefault: prevent,
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) as DOMRect },
      dataTransfer: null,
      clientY: 10,
    } as unknown as DragEvent;
    cmp.onDragOver(ev, 'a');
    expect(prevent).not.toHaveBeenCalled();
    expect(cmp.dropTarget()).toBeNull();
  });

  it('onDragOver clears dropTarget when hovering self', () => {
    cmp.dragLayerId.set('a');
    cmp.dropTarget.set({ id: 'b', position: 'above' });
    const ev = {
      preventDefault: () => {},
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) as DOMRect },
      dataTransfer: null,
      clientY: 10,
    } as unknown as DragEvent;
    cmp.onDragOver(ev, 'a');
    expect(cmp.dropTarget()).toBeNull();
  });

  it('onDragOver sets dropTarget with above/below based on Y', () => {
    cmp.dragLayerId.set('a');
    let effect = '';
    const dt = {
      set dropEffect(v: string) {
        effect = v;
      },
      get dropEffect(): string {
        return effect;
      },
    } as unknown as DataTransfer;
    const rect = { top: 100, height: 40 } as DOMRect;
    const ev1 = {
      preventDefault: () => {},
      currentTarget: { getBoundingClientRect: () => rect },
      dataTransfer: dt,
      clientY: 110,
    } as unknown as DragEvent;
    cmp.onDragOver(ev1, 'b');
    expect(cmp.dropTarget()).toEqual({ id: 'b', position: 'above' });
    expect(effect).toBe('move');

    const ev2 = {
      ...ev1,
      currentTarget: { getBoundingClientRect: () => rect },
      clientY: 130,
    } as unknown as DragEvent;
    cmp.onDragOver(ev2, 'b');
    expect(cmp.dropTarget()).toEqual({ id: 'b', position: 'below' });
  });

  it('onDragOver skips re-setting the same target+position', () => {
    cmp.dragLayerId.set('a');
    cmp.dropTarget.set({ id: 'b', position: 'above' });
    const target = cmp.dropTarget();
    const rect = { top: 100, height: 40 } as DOMRect;
    const ev = {
      preventDefault: () => {},
      currentTarget: { getBoundingClientRect: () => rect },
      dataTransfer: null,
      clientY: 105,
    } as unknown as DragEvent;
    cmp.onDragOver(ev, 'b');
    // Reference should be preserved (no re-set).
    expect(cmp.dropTarget()).toBe(target);
  });

  it('onDragEnd clears state', () => {
    cmp.dragLayerId.set('a');
    cmp.dropTarget.set({ id: 'b', position: 'above' });
    cmp.onDragEnd();
    expect(cmp.dragLayerId()).toBeNull();
    expect(cmp.dropTarget()).toBeNull();
  });

  it('onDragLeavePanel clears dropTarget when leaving to outside', () => {
    cmp.dropTarget.set({ id: 'b', position: 'above' });
    const panel = document.createElement('div');
    const ev = { relatedTarget: null, currentTarget: panel } as unknown as DragEvent;
    cmp.onDragLeavePanel(ev);
    expect(cmp.dropTarget()).toBeNull();
  });

  it('onDragLeavePanel keeps dropTarget when moving to child node', () => {
    cmp.dropTarget.set({ id: 'b', position: 'above' });
    const panel = document.createElement('div');
    const child = document.createElement('span');
    panel.appendChild(child);
    const ev = { relatedTarget: child, currentTarget: panel } as unknown as DragEvent;
    cmp.onDragLeavePanel(ev);
    expect(cmp.dropTarget()).not.toBeNull();
  });

  it('onDrop emits reorder with dropTarget position when set', () => {
    const spy = jasmine.createSpy('reorder');
    cmp.reorder.subscribe(spy);
    cmp.dragLayerId.set('a');
    cmp.dropTarget.set({ id: 'b', position: 'below' });
    const ev = {
      preventDefault: () => {},
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) as DOMRect },
      clientY: 10,
    } as unknown as DragEvent;
    cmp.onDrop(ev, 'b');
    expect(spy).toHaveBeenCalledWith({ fromId: 'a', toId: 'b', position: 'below' });
    expect(cmp.dragLayerId()).toBeNull();
    expect(cmp.dropTarget()).toBeNull();
  });

  it('onDrop falls back to Y-based position when dropTarget differs', () => {
    const spy = jasmine.createSpy('reorder');
    cmp.reorder.subscribe(spy);
    cmp.dragLayerId.set('a');
    cmp.dropTarget.set({ id: 'c', position: 'below' });
    const ev = {
      preventDefault: () => {},
      currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 40 }) as DOMRect },
      clientY: 105,
    } as unknown as DragEvent;
    cmp.onDrop(ev, 'b');
    expect(spy).toHaveBeenCalledWith({ fromId: 'a', toId: 'b', position: 'above' });
  });

  it('onDrop is a no-op when dragging onto self', () => {
    const spy = jasmine.createSpy('reorder');
    cmp.reorder.subscribe(spy);
    cmp.dragLayerId.set('a');
    const ev = {
      preventDefault: () => {},
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) as DOMRect },
      clientY: 10,
    } as unknown as DragEvent;
    cmp.onDrop(ev, 'a');
    expect(spy).not.toHaveBeenCalled();
  });

  it('onDrop is a no-op when no drag in progress', () => {
    const spy = jasmine.createSpy('reorder');
    cmp.reorder.subscribe(spy);
    const ev = {
      preventDefault: () => {},
      currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 40 }) as DOMRect },
      clientY: 10,
    } as unknown as DragEvent;
    cmp.onDrop(ev, 'b');
    expect(spy).not.toHaveBeenCalled();
  });
});
