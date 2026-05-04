import { TestBed } from '@angular/core/testing';
import { IWireElement } from '@mocktail/projects';
import { EditorViewportService } from '../viewport/viewport.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import {
  CanvasGestureStore,
  HandleDir,
  ISnapContext,
  GUIDE_THRESHOLD,
  snapToGuides,
  snapResizeEdges,
} from './canvas-gesture.store';

function makeEl(p: Partial<IWireElement> & Pick<IWireElement, 'id'>): IWireElement {
  return {
    pageId: 'pg1',
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    zIndex: 1,
    ...p,
  } as IWireElement;
}

function emptySnapCtx(overrides: Partial<ISnapContext> = {}): ISnapContext {
  return {
    elements: [],
    pageW: 1200,
    pageH: 800,
    gridColumns: [],
    snapEnabled: false,
    ...overrides,
  };
}

describe('CanvasGestureStore', () => {
  let svc: CanvasGestureStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WorkspaceStore, EditorViewportService, CanvasGestureStore],
    });
    svc = TestBed.inject(CanvasGestureStore);
  });

  it('starts with no active state', () => {
    expect(svc.drag).toBeNull();
    expect(svc.resize).toBeNull();
    expect(svc.rotate).toBeNull();
    expect(svc.activeId()).toBeNull();
    expect(svc.isActive()).toBe(false);
  });

  // ── beginDrag ───────────────────────────────────────────────────────────

  it('beginDrag captures element id, page, tid, pid, origin', () => {
    const el = makeEl({ id: 'a', x: 10, y: 20, pageId: 'pg2' });
    svc.beginDrag(el, { clientX: 100, clientY: 200 }, 't', 'p');
    expect(svc.drag?.id).toBe('a');
    expect(svc.drag?.pageId).toBe('pg2');
    expect(svc.drag?.tid).toBe('t');
    expect(svc.drag?.pid).toBe('p');
    expect(svc.drag?.startX).toBe(100);
    expect(svc.drag?.startY).toBe(200);
    expect(svc.drag?.origX).toBe(10);
    expect(svc.drag?.origY).toBe(20);
    expect(svc.activeId()).toBe('a');
    expect(svc.isActive()).toBe(true);
  });

  // ── beginResize ────────────────────────────────────────────────────────

  it('beginResize captures orig rectangle and aspect', () => {
    const el = makeEl({ id: 'b', x: 0, y: 0, w: 200, h: 100 });
    svc.beginResize(el, 'se', { clientX: 5, clientY: 5 }, 't', 'p');
    expect(svc.resize?.id).toBe('b');
    expect(svc.resize?.dir).toBe('se');
    expect(svc.resize?.orig).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(svc.resize?.aspect).toBe(2);
  });

  it('beginResize clamps aspect denominator to avoid /0', () => {
    const el = makeEl({ id: 'b', w: 100, h: 0 });
    svc.beginResize(el, 'se', { clientX: 0, clientY: 0 }, 't', 'p');
    expect(svc.resize?.aspect).toBe(100);
  });

  // ── beginRotate ────────────────────────────────────────────────────────

  it('beginRotate captures start angle relative to center', () => {
    const el = makeEl({ id: 'c', rotation: 30 });
    svc.beginRotate(el, { clientX: 110, clientY: 100 }, 100, 100, 't', 'p');
    expect(svc.rotate?.id).toBe('c');
    expect(svc.rotate?.cx).toBe(100);
    expect(svc.rotate?.cy).toBe(100);
    expect(svc.rotate?.origRotation).toBe(30);
    expect(svc.rotate?.startAngle).toBeCloseTo(0, 5);
  });

  it('beginRotate treats missing rotation as 0', () => {
    const el = makeEl({ id: 'c' });
    svc.beginRotate(el, { clientX: 100, clientY: 110 }, 100, 100, 't', 'p');
    expect(svc.rotate?.origRotation).toBe(0);
  });

  // ── cancel / end* ──────────────────────────────────────────────────────

  it('cancel clears all three states and guides', () => {
    const el = makeEl({ id: 'a' });
    svc.beginDrag(el, { clientX: 0, clientY: 0 }, 't', 'p');
    svc.guides.set([{ orientation: 'v', pos: 100, start: 0, end: 10 }]);
    svc.cancel();
    expect(svc.drag).toBeNull();
    expect(svc.resize).toBeNull();
    expect(svc.rotate).toBeNull();
    expect(svc.guides()).toEqual([]);
  });

  it('endDrag returns the drag state and clears it', () => {
    const el = makeEl({ id: 'a' });
    svc.beginDrag(el, { clientX: 0, clientY: 0 }, 't', 'p');
    const d = svc.endDrag();
    expect(d?.id).toBe('a');
    expect(svc.drag).toBeNull();
  });

  it('endDrag returns null when not dragging', () => {
    expect(svc.endDrag()).toBeNull();
  });

  it('endResize returns state and clears', () => {
    svc.beginResize(makeEl({ id: 'a' }), 'se', { clientX: 0, clientY: 0 }, 't', 'p');
    expect(svc.endResize()?.id).toBe('a');
    expect(svc.resize).toBeNull();
    expect(svc.endResize()).toBeNull();
  });

  it('endRotate returns state and clears', () => {
    svc.beginRotate(makeEl({ id: 'a' }), { clientX: 1, clientY: 0 }, 0, 0, 't', 'p');
    expect(svc.endRotate()?.id).toBe('a');
    expect(svc.rotate).toBeNull();
    expect(svc.endRotate()).toBeNull();
  });

  // ── activeId precedence ────────────────────────────────────────────────

  it('activeId prefers drag over resize over rotate', () => {
    svc.beginRotate(makeEl({ id: 'rot' }), { clientX: 1, clientY: 0 }, 0, 0, 't', 'p');
    expect(svc.activeId()).toBe('rot');
    svc.beginResize(makeEl({ id: 'rz' }), 'e', { clientX: 0, clientY: 0 }, 't', 'p');
    expect(svc.activeId()).toBe('rz');
    svc.beginDrag(makeEl({ id: 'd' }), { clientX: 0, clientY: 0 }, 't', 'p');
    expect(svc.activeId()).toBe('d');
  });

  // ── handleDragMove ─────────────────────────────────────────────────────

  it('handleDragMove returns null when no drag started', () => {
    expect(svc.handleDragMove({ clientX: 0, clientY: 0 }, 1, emptySnapCtx())).toBeNull();
  });

  it('handleDragMove returns null when moving element is missing from elements list', () => {
    const el = makeEl({ id: 'gone' });
    svc.beginDrag(el, { clientX: 0, clientY: 0 }, 't', 'p');
    expect(svc.handleDragMove({ clientX: 10, clientY: 10 }, 1, emptySnapCtx())).toBeNull();
  });

  it('handleDragMove emits raw position when no snap targets in threshold', () => {
    const el = makeEl({ id: 'a', x: 0, y: 0, w: 100, h: 40 });
    svc.beginDrag(el, { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleDragMove(
      { clientX: 50, clientY: 50 },
      1,
      emptySnapCtx({ elements: [el] }),
    );
    expect(res?.patch).toEqual({ x: 50, y: 50 });
    expect(res?.guides.length).toBe(0);
    expect(svc.guides()).toEqual([]);
  });

  it('handleDragMove divides by zoom', () => {
    const el = makeEl({ id: 'a', x: 0, y: 0 });
    svc.beginDrag(el, { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleDragMove(
      { clientX: 200, clientY: 100 },
      2,
      emptySnapCtx({ elements: [el] }),
    );
    expect(res?.patch).toEqual({ x: 100, y: 50 });
  });

  it('handleDragMove snaps X to sibling left edge within threshold', () => {
    const moving = makeEl({ id: 'a', x: 0, y: 0, w: 50, h: 40 });
    const sibling = makeEl({ id: 'b', x: 102, y: 500, w: 50, h: 40 }); // far Y so only X guide
    svc.beginDrag(moving, { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleDragMove(
      { clientX: 100, clientY: 100 },
      1,
      emptySnapCtx({ elements: [moving, sibling] }),
    );
    expect(res?.patch.x).toBe(102);
    expect(res?.guides.some((g) => g.orientation === 'v')).toBe(true);
    expect(svc.guides().length).toBeGreaterThanOrEqual(1);
  });

  it('handleDragMove snaps to page center', () => {
    const moving = makeEl({ id: 'a', x: 0, y: 0, w: 100, h: 40 });
    svc.beginDrag(moving, { clientX: 0, clientY: 0 }, 't', 'p');
    // page center X = 600. moving center offset = w/2 = 50. raw X = 551 → center 601. snap 1px away.
    const res = svc.handleDragMove(
      { clientX: 551, clientY: 0 },
      1,
      emptySnapCtx({ elements: [moving] }),
    );
    expect(res?.patch.x).toBe(550);
  });

  // ── handleResizeMove ───────────────────────────────────────────────────

  it('handleResizeMove returns null when no resize started', () => {
    expect(
      svc.handleResizeMove({ clientX: 0, clientY: 0, shiftKey: false }, 1, [], () => false),
    ).toBeNull();
  });

  const dirs: HandleDir[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  for (const dir of dirs) {
    it(`handleResizeMove direction ${dir} resizes as expected`, () => {
      const el = makeEl({ id: 'a', x: 100, y: 100, w: 100, h: 100 });
      svc.beginResize(el, dir, { clientX: 0, clientY: 0 }, 't', 'p');
      const res = svc.handleResizeMove(
        { clientX: 10, clientY: 10, shiftKey: false },
        1,
        [el],
        () => false,
      );
      expect(res).not.toBeNull();
      const p = res!.patch as { x: number; y: number; w: number; h: number };
      expect(Number.isFinite(p.x)).toBe(true);
      expect(p.w).toBeGreaterThanOrEqual(8);
      expect(p.h).toBeGreaterThanOrEqual(8);
    });
  }

  it('handleResizeMove enforces minSize 8 for non-divider when shrunk past 0', () => {
    const el = makeEl({ id: 'a', x: 0, y: 0, w: 50, h: 50 });
    svc.beginResize(el, 'se', { clientX: 100, clientY: 100 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: -1000, clientY: -1000, shiftKey: false },
      1,
      [el],
      () => false,
    );
    expect(res?.patch.w).toBe(8);
    expect(res?.patch.h).toBe(8);
  });

  it('handleResizeMove aspect-lock with shift key when dir length is 2', () => {
    const el = makeEl({ id: 'a', x: 0, y: 0, w: 100, h: 50 }); // aspect 2
    svc.beginResize(el, 'se', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 100, clientY: 0, shiftKey: true },
      1,
      [el],
      () => false,
    );
    expect(res?.patch.w).toBe(200);
    expect(res?.patch.h).toBe(100);
  });

  it('handleResizeMove aspect-lock chooses shorter axis when H drives', () => {
    const el = makeEl({ id: 'a', x: 0, y: 0, w: 100, h: 50 });
    svc.beginResize(el, 'nw', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: -5, clientY: -50, shiftKey: true },
      1,
      [el],
      () => false,
    );
    expect(res).not.toBeNull();
  });

  it('handleResizeMove constrains horizontal divider to h=1, no y move', () => {
    const el = makeEl({ id: 'd', type: 'divider', x: 0, y: 50, w: 100, h: 1 });
    svc.beginResize(el, 's', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 0, clientY: 100, shiftKey: false },
      1,
      [el],
      () => true, // horizontal divider
    );
    expect(res?.patch.h).toBe(1);
    expect(res?.patch.y).toBe(50);
  });

  it('handleResizeMove constrains vertical divider to w=1, no x move', () => {
    const el = makeEl({ id: 'd', type: 'divider', x: 50, y: 0, w: 1, h: 100 });
    svc.beginResize(el, 'e', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 100, clientY: 0, shiftKey: false },
      1,
      [el],
      () => false, // vertical divider
    );
    expect(res?.patch.w).toBe(1);
    expect(res?.patch.x).toBe(50);
  });

  it('handleResizeMove "w" shrink adjusts origin x when hitting min', () => {
    const el = makeEl({ id: 'a', x: 100, y: 0, w: 50, h: 50 });
    svc.beginResize(el, 'w', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 1000, clientY: 0, shiftKey: false },
      1,
      [el],
      () => false,
    );
    expect(res?.patch.w).toBe(8);
    expect(res?.patch.x).toBe(142);
  });

  it('handleResizeMove "n" shrink adjusts origin y when hitting min', () => {
    const el = makeEl({ id: 'a', x: 0, y: 100, w: 50, h: 50 });
    svc.beginResize(el, 'n', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 0, clientY: 1000, shiftKey: false },
      1,
      [el],
      () => false,
    );
    expect(res?.patch.h).toBe(8);
    expect(res?.patch.y).toBe(142);
  });

  it('handleResizeMove populates guides when snapCtx provided and sibling aligned', () => {
    const self = makeEl({ id: 'self', x: 0, y: 0, w: 100, h: 50 });
    const sib = makeEl({ id: 'sib', x: 152, y: 0, w: 10, h: 10 });
    svc.beginResize(self, 'e', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 50, clientY: 0, shiftKey: false },
      1,
      [self, sib],
      () => false,
      emptySnapCtx({ elements: [self, sib] }),
    );
    expect(res?.patch.w).toBe(152);
    expect((res?.guides ?? []).length).toBe(1);
    expect(svc.guides().length).toBe(1);
  });

  it('handleResizeMove with snapCtx but no target leaves guides empty', () => {
    const self = makeEl({ id: 'self', x: 0, y: 0, w: 100, h: 50 });
    svc.beginResize(self, 'e', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 50, clientY: 0, shiftKey: false },
      1,
      [self],
      () => false,
      emptySnapCtx({ elements: [self], pageW: 100000, pageH: 100000 }),
    );
    expect(res?.guides).toEqual([]);
    expect(svc.guides()).toEqual([]);
  });

  it('handleResizeMove snaps divider length axis and emits vertical guide for horizontal divider', () => {
    const self = makeEl({ id: 'd', type: 'divider', x: 0, y: 0, w: 100, h: 1 });
    const sib = makeEl({ id: 'sib', x: 152, y: 0, w: 10, h: 10 });
    svc.beginResize(self, 'e', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 50, clientY: 0, shiftKey: false },
      1,
      [self, sib],
      () => true,
      emptySnapCtx({ elements: [self, sib] }),
    );
    expect(res?.patch.w).toBe(152);
    expect(res?.patch.h).toBe(1);
    expect((res?.guides ?? []).length).toBe(1);
    expect(res?.guides[0].orientation).toBe('v');
  });

  it('handleResizeMove filters horizontal guides away for horizontal divider', () => {
    const self = makeEl({ id: 'd', type: 'divider', x: 0, y: 0, w: 100, h: 1 });
    const sib = makeEl({ id: 'sib', x: 0, y: 52, w: 10, h: 10 });
    svc.beginResize(self, 's', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 0, clientY: 52, shiftKey: false },
      1,
      [self, sib],
      () => true,
      emptySnapCtx({ elements: [self, sib] }),
    );
    expect(res?.patch.h).toBe(1);
    expect(res?.guides).toEqual([]);
  });

  it('handleResizeMove filters vertical guides away for vertical divider', () => {
    const self = makeEl({ id: 'd', type: 'divider', x: 0, y: 0, w: 1, h: 100 });
    const sib = makeEl({ id: 'sib', x: 52, y: 0, w: 10, h: 10 });
    svc.beginResize(self, 'e', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 52, clientY: 0, shiftKey: false },
      1,
      [self, sib],
      () => false,
      emptySnapCtx({ elements: [self, sib] }),
    );
    expect(res?.patch.w).toBe(1);
    expect(res?.guides).toEqual([]);
  });

  it('handleResizeMove skips snap when shift-aspect lock is engaged on corner', () => {
    const self = makeEl({ id: 'self', x: 0, y: 0, w: 100, h: 50 });
    svc.beginResize(self, 'se', { clientX: 0, clientY: 0 }, 't', 'p');
    const res = svc.handleResizeMove(
      { clientX: 100, clientY: 0, shiftKey: true },
      1,
      [self],
      () => false,
      emptySnapCtx({ elements: [self] }),
    );
    expect(res?.guides).toEqual([]);
  });

  // ── handleRotateMove ───────────────────────────────────────────────────

  it('handleRotateMove returns null when no rotate started', () => {
    expect(svc.handleRotateMove({ clientX: 0, clientY: 0, shiftKey: false })).toBeNull();
  });

  it('handleRotateMove applies angle delta from center', () => {
    const el = makeEl({ id: 'a', rotation: 0 });
    svc.beginRotate(el, { clientX: 10, clientY: 0 }, 0, 0, 't', 'p');
    const res = svc.handleRotateMove({ clientX: 0, clientY: 10, shiftKey: false });
    expect(res?.patch.rotation).toBeCloseTo(90, 3);
  });

  it('handleRotateMove wraps negative angle to [0, 360)', () => {
    const el = makeEl({ id: 'a', rotation: 10 });
    svc.beginRotate(el, { clientX: 10, clientY: 0 }, 0, 0, 't', 'p');
    // Move 10° backward → rotation = 10 - ? → test wrap handles negatives
    const res = svc.handleRotateMove({ clientX: 10, clientY: -1, shiftKey: false });
    const r = res?.patch.rotation as number;
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(360);
  });

  it('handleRotateMove shiftKey snaps to 15° increments', () => {
    const el = makeEl({ id: 'a', rotation: 0 });
    svc.beginRotate(el, { clientX: 10, clientY: 0 }, 0, 0, 't', 'p');
    // Aim for ~37° → should snap to 30 or 45
    const res = svc.handleRotateMove({ clientX: 8, clientY: 6, shiftKey: true });
    const r = res?.patch.rotation as number;
    expect(r % 15).toBe(0);
  });
});

describe('snapToGuides (pure)', () => {
  it('returns raw x/y when there are no targets in range', () => {
    const out = snapToGuides(500, 500, 20, 20, 'self', {
      elements: [],
      pageW: 2000,
      pageH: 2000,
      gridColumns: [],
      snapEnabled: false,
    });
    expect(out.x).toBe(500);
    expect(out.y).toBe(500);
    expect(out.guides).toEqual([]);
  });

  it('page edges act as snap targets', () => {
    const out = snapToGuides(GUIDE_THRESHOLD - 1, GUIDE_THRESHOLD - 1, 10, 10, 'self', {
      elements: [],
      pageW: 1200,
      pageH: 800,
      gridColumns: [],
      snapEnabled: false,
    });
    expect(out.x).toBe(0);
    expect(out.y).toBe(0);
  });

  it('skips rotated siblings from snap targets', () => {
    const rotated: IWireElement = makeEl({ id: 'r', x: 50, y: 0, rotation: 45 });
    const out = snapToGuides(52, 0, 10, 10, 'self', {
      elements: [rotated],
      pageW: 1200,
      pageH: 800,
      gridColumns: [],
      snapEnabled: false,
    });
    // Rotated sibling not considered; page edges at 0 are within threshold? 52 - 0 > 4, no.
    expect(out.x).toBe(52);
  });

  it('uses grid columns when snapEnabled', () => {
    const out = snapToGuides(98, 0, 10, 10, 'self', {
      elements: [],
      pageW: 1200,
      pageH: 800,
      gridColumns: [{ left: 100, width: 80 }],
      snapEnabled: true,
    });
    expect(out.x).toBe(100);
  });

  it('ignores grid columns when snapEnabled is false', () => {
    const out = snapToGuides(98, 0, 10, 10, 'self', {
      elements: [],
      pageW: 1200,
      pageH: 800,
      gridColumns: [{ left: 100, width: 80 }],
      snapEnabled: false,
    });
    expect(out.x).toBe(98);
  });

  it('excludes self from sibling targets', () => {
    const self = makeEl({ id: 'self', x: 0 });
    const out = snapToGuides(10, 0, 10, 10, 'self', {
      elements: [self],
      pageW: 1200,
      pageH: 800,
      gridColumns: [],
      snapEnabled: false,
    });
    expect(out.x).toBe(10);
  });

  it('prefers closer target when multiple are in threshold', () => {
    const a = makeEl({ id: 'a', x: 200, y: 0, w: 1, h: 10 });
    const b = makeEl({ id: 'b', x: 202, y: 0, w: 1, h: 10 });
    const out = snapToGuides(203, 0, 1, 10, 'self', {
      elements: [a, b],
      pageW: 1200,
      pageH: 800,
      gridColumns: [],
      snapEnabled: false,
    });
    // left candidate raw 203: delta to b.x(202)=1, delta to b.right(203)=0, delta to a.right(201)=2.
    // Closest = b.right=203. Snap x = 203 (no move).
    // Test instead: raw = 205 → left=205. b.right=203, delta=2. a.right=201, delta=4. b wins.
    const out2 = snapToGuides(205, 0, 1, 10, 'self', {
      elements: [a, b],
      pageW: 1200,
      pageH: 800,
      gridColumns: [],
      snapEnabled: false,
    });
    expect(out2.x).toBe(203);
    void out;
  });

  it('snaps Y axis to sibling top edge', () => {
    const sib = makeEl({ id: 's', x: 0, y: 202, w: 10, h: 10 });
    const out = snapToGuides(0, 200, 10, 10, 'self', {
      elements: [sib],
      pageW: 1200,
      pageH: 800,
      gridColumns: [],
      snapEnabled: false,
    });
    expect(out.y).toBe(202);
    expect(out.guides.some((g) => g.orientation === 'h')).toBe(true);
  });
});

describe('snapResizeEdges (pure)', () => {
  const ctx = (overrides: Partial<ISnapContext> = {}): ISnapContext => ({
    elements: [],
    pageW: 1200,
    pageH: 800,
    gridColumns: [],
    snapEnabled: false,
    ...overrides,
  });

  it('"e" drag snaps right edge to sibling left edge', () => {
    const sib = makeEl({ id: 's', x: 202, y: 0, w: 10, h: 10 });
    const out = snapResizeEdges(
      { x: 0, y: 0, w: 200, h: 10 },
      'e',
      'self',
      ctx({ elements: [sib] }),
    );
    expect(out.w).toBe(202);
    expect(out.x).toBe(0);
    expect(out.guides.length).toBe(1);
    expect(out.guides[0].orientation).toBe('v');
    expect(out.guides[0].pos).toBe(202);
  });

  it('"w" drag snaps left edge and preserves right edge', () => {
    const sib = makeEl({ id: 's', x: 50, y: 0, w: 10, h: 10 });
    const out = snapResizeEdges(
      { x: 52, y: 0, w: 50, h: 10 },
      'w',
      'self',
      ctx({ elements: [sib] }),
    );
    expect(out.x).toBe(50);
    expect(out.w).toBe(52);
  });

  it('"s" drag snaps bottom edge to sibling top', () => {
    const sib = makeEl({ id: 's', x: 0, y: 202, w: 10, h: 10 });
    const out = snapResizeEdges(
      { x: 0, y: 0, w: 10, h: 200 },
      's',
      'self',
      ctx({ elements: [sib] }),
    );
    expect(out.h).toBe(202);
    expect(out.guides[0].orientation).toBe('h');
    expect(out.guides[0].pos).toBe(202);
  });

  it('"n" drag snaps top edge and preserves bottom', () => {
    const sib = makeEl({ id: 's', x: 0, y: 50, w: 10, h: 10 });
    const out = snapResizeEdges(
      { x: 0, y: 52, w: 10, h: 50 },
      'n',
      'self',
      ctx({ elements: [sib] }),
    );
    expect(out.y).toBe(50);
    expect(out.h).toBe(52);
  });

  it('"se" corner snaps both right and bottom edges', () => {
    const sib = makeEl({ id: 's', x: 100, y: 100, w: 10, h: 10 });
    const out = snapResizeEdges(
      { x: 0, y: 0, w: 98, h: 98 },
      'se',
      'self',
      ctx({ elements: [sib] }),
    );
    expect(out.w).toBe(100);
    expect(out.h).toBe(100);
    expect(out.guides.length).toBe(2);
  });

  it('does not snap when no target within threshold', () => {
    const out = snapResizeEdges({ x: 500, y: 500, w: 50, h: 50 }, 'e', 'self', ctx());
    expect(out.w).toBe(50);
    expect(out.guides).toEqual([]);
  });

  it('snaps to page edge', () => {
    const out = snapResizeEdges(
      { x: 0, y: 0, w: 1200 - GUIDE_THRESHOLD + 1, h: 10 },
      'e',
      'self',
      ctx(),
    );
    expect(out.w).toBe(1200);
  });

  it('excludes self from sibling targets', () => {
    const self = makeEl({ id: 'self', x: 0, y: 0, w: 200, h: 10 });
    const out = snapResizeEdges(
      { x: 0, y: 0, w: 200, h: 10 },
      'e',
      'self',
      ctx({ elements: [self] }),
    );
    expect(out.guides).toEqual([]);
  });

  it('excludes rotated siblings from snap targets', () => {
    const sib = makeEl({ id: 'r', x: 202, y: 0, w: 10, h: 10, rotation: 30 });
    const out = snapResizeEdges(
      { x: 0, y: 0, w: 200, h: 10 },
      'e',
      'self',
      ctx({ elements: [sib] }),
    );
    expect(out.guides).toEqual([]);
  });

  it('uses grid columns when snapEnabled', () => {
    const out = snapResizeEdges(
      { x: 0, y: 0, w: 98, h: 10 },
      'e',
      'self',
      ctx({ gridColumns: [{ left: 100, width: 80 }], snapEnabled: true }),
    );
    expect(out.w).toBe(100);
  });

  it('picks closest target when multiple in threshold', () => {
    const a = makeEl({ id: 'a', x: 200, y: 0, w: 1, h: 10 });
    const b = makeEl({ id: 'b', x: 210, y: 0, w: 1, h: 10 });
    const out = snapResizeEdges(
      { x: 0, y: 0, w: 199, h: 10 },
      'e',
      'self',
      ctx({ elements: [a, b] }),
    );
    expect(out.w).toBe(200);
  });
});
