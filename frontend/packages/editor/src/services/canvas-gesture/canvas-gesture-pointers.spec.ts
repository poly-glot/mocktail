import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { IGridConfig, IPageDoc, IWireElement, ProjectApiService } from '@mocktail/projects';
import { CanvasGestureStore, HandleDir } from './canvas-gesture.store';
import { EditorCommentsService } from '../comments/comments.service';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorInlineEditService } from '../inline-edit/inline-edit.service';
import { EditorSelectionService } from '../selection/selection.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { EditorViewportService } from '../viewport/viewport.service';
import { EditorZoomService } from '../zoom/zoom.service';

function makeEl(partial: Partial<IWireElement> & Pick<IWireElement, 'id' | 'type'>): IWireElement {
  return {
    pageId: 'pg1',
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    zIndex: 1,
    ...partial,
  } as IWireElement;
}

function stubPointerEvent(
  overrides: Partial<PointerEvent> & { target?: Element | null } = {},
): PointerEvent {
  const stop = jasmine.createSpy('stopPropagation');
  const prevent = jasmine.createSpy('preventDefault');
  const ev = {
    clientX: overrides.clientX ?? 0,
    clientY: overrides.clientY ?? 0,
    shiftKey: overrides.shiftKey ?? false,
    pointerId: overrides.pointerId ?? 1,
    target: overrides.target ?? (null as unknown as Element),
    stopPropagation: stop,
    preventDefault: prevent,
  } as unknown as PointerEvent;
  return ev;
}

function rectLike(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x,
    y,
    left: x,
    top: y,
    right: x + w,
    bottom: y + h,
    width: w,
    height: h,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('CanvasGestureStore', () => {
  let svc: CanvasGestureStore;
  let drr: CanvasGestureStore;
  let sel: EditorSelectionService;
  let state: EditorElementsStateService;
  let inline: EditorInlineEditService;
  let comments: EditorCommentsService;
  let collab: {
    sendCursor: jasmine.Spy;
    sendSelection: jasmine.Spy;
    sendEdit: jasmine.Spy;
    flushPendingEdits: jasmine.Spy;
  };
  // Stubbed only to keep @mocktail/projects injection graph from reaching
  // Firebase; pointer-orchestrator itself no longer depends on it.
  let projects: { upsertElement: jasmine.Spy };
  let workspace: {
    tid: ReturnType<typeof signal<string>>;
    pid: ReturnType<typeof signal<string>>;
    activePageId: ReturnType<typeof signal<string | null>>;
    activePage: ReturnType<typeof signal<IPageDoc | null>>;
    gridConfig: ReturnType<typeof signal<IGridConfig>>;
  };
  let viewport: {
    getBoardRect: jasmine.Spy;
    getCanvasRect: jasmine.Spy;
  };
  let zoom: EditorZoomService;

  beforeEach(() => {
    collab = {
      sendCursor: jasmine.createSpy('sendCursor'),
      sendSelection: jasmine.createSpy('sendSelection'),
      sendEdit: jasmine.createSpy('sendEdit'),
      flushPendingEdits: jasmine.createSpy('flushPendingEdits'),
    };
    projects = { upsertElement: jasmine.createSpy('upsertElement').and.resolveTo(undefined) };
    workspace = {
      tid: signal('t1'),
      pid: signal('p1'),
      activePageId: signal<string | null>('pg1'),
      activePage: signal<IPageDoc | null>({
        id: 'pg1',
        name: 'P1',
        order: 0,
        width: 1200,
        height: 800,
      }),
      gridConfig: signal<IGridConfig>({
        visible: false,
        columns: 12,
        gutter: 16,
        margin: 40,
        snap: true,
      }),
    };
    viewport = {
      getBoardRect: jasmine.createSpy('getBoardRect').and.returnValue(rectLike(0, 0, 1200, 800)),
      getCanvasRect: jasmine.createSpy('getCanvasRect').and.returnValue(rectLike(0, 0, 1000, 800)),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: CollabService, useValue: collab as Partial<CollabService> },
        { provide: ProjectApiService, useValue: projects as Partial<ProjectApiService> },
        { provide: WorkspaceStore, useValue: workspace as Partial<WorkspaceStore> },
        { provide: EditorViewportService, useValue: viewport as Partial<EditorViewportService> },
        CanvasGestureStore,
      ],
    });

    drr = TestBed.inject(CanvasGestureStore);
    sel = TestBed.inject(EditorSelectionService);
    state = TestBed.inject(EditorElementsStateService);
    inline = TestBed.inject(EditorInlineEditService);
    comments = TestBed.inject(EditorCommentsService);
    zoom = TestBed.inject(EditorZoomService);
    zoom.zoom.set(1);
    zoom.autoFitZoom.set(false);

    // Reset selection state so each test starts clean
    sel.clear();
    sel.setMarquee(null);
    comments.commentMode.set(false);
    comments.draft.set(null);
    comments.openPinId.set(null);
    inline.stop();

    svc = TestBed.inject(CanvasGestureStore);
  });

  describe('onElementPointerDown', () => {
    it('returns early without stopping propagation when the element is currently being inline-edited', () => {
      const el = makeEl({ id: 'a', type: 'text' });
      state.list.set([el]);
      inline.begin('a');
      const ev = stubPointerEvent();
      svc.onElementPointerDown(ev, el);
      expect(ev.stopPropagation).not.toHaveBeenCalled();
      expect(collab.sendSelection).not.toHaveBeenCalled();
    });

    it('ignores shift-click on a locked element', () => {
      const el = makeEl({ id: 'a', type: 'rect', locked: true });
      state.list.set([el]);
      sel.setPrimary('other');
      const ev = stubPointerEvent({ shiftKey: true });
      svc.onElementPointerDown(ev, el);
      expect(ev.stopPropagation).toHaveBeenCalled();
      expect(sel.selectedId()).toBe('other');
      expect(collab.sendSelection).not.toHaveBeenCalled();
    });

    it('toggles selection on shift-click of an unlocked element', () => {
      const el = makeEl({ id: 'a', type: 'rect' });
      state.list.set([el]);
      const ev = stubPointerEvent({ shiftKey: true });
      svc.onElementPointerDown(ev, el);
      expect(sel.isSelected('a')).toBeTrue();
      expect(collab.sendSelection).toHaveBeenCalledWith('a');
    });

    it('keeps the group intact when clicking an already-selected member', () => {
      const a = makeEl({ id: 'a', type: 'rect' });
      const b = makeEl({ id: 'b', type: 'rect' });
      state.list.set([a, b]);
      sel.setPrimary('a');
      sel.setExtras(new Set(['b']));
      expect(sel.selectionCount()).toBe(2);
      const target = { setPointerCapture: jasmine.createSpy() } as unknown as HTMLElement;
      const ev = stubPointerEvent({ target });
      svc.onElementPointerDown(ev, b);
      // primary remains 'a', b still in extras
      expect(sel.selectedId()).toBe('a');
      expect(sel.isSelected('b')).toBeTrue();
      expect(collab.sendSelection).toHaveBeenCalledWith('b');
      expect(drr.drag).not.toBeNull();
    });

    it('resets primary/extras when clicking outside the current group', () => {
      state.list.set([makeEl({ id: 'a', type: 'rect' }), makeEl({ id: 'b', type: 'rect' })]);
      sel.setPrimary('a');
      sel.setExtras(new Set(['b']));
      const target = { setPointerCapture: jasmine.createSpy() } as unknown as HTMLElement;
      const ev = stubPointerEvent({ target });
      svc.onElementPointerDown(ev, makeEl({ id: 'c', type: 'rect' }));
      expect(sel.selectedId()).toBe('c');
      expect(sel.isSelected('b')).toBeFalse();
      expect(collab.sendSelection).toHaveBeenCalledWith('c');
    });

    it('does not begin a drag for a locked element even without shift', () => {
      const el = makeEl({ id: 'locked', type: 'rect', locked: true });
      state.list.set([el]);
      const target = { setPointerCapture: jasmine.createSpy() } as unknown as HTMLElement;
      const ev = stubPointerEvent({ target });
      svc.onElementPointerDown(ev, el);
      expect(sel.selectedId()).toBe('locked');
      expect(drr.drag).toBeNull();
    });

    it('captures pointer and begins a drag for a non-locked element', () => {
      const el = makeEl({ id: 'a', type: 'rect' });
      state.list.set([el]);
      const target = {
        setPointerCapture: jasmine.createSpy('setPointerCapture'),
      } as unknown as HTMLElement;
      const ev = stubPointerEvent({ target });
      svc.onElementPointerDown(ev, el);
      expect(
        (target as unknown as { setPointerCapture: jasmine.Spy }).setPointerCapture,
      ).toHaveBeenCalledWith(1);
      expect(drr.drag).not.toBeNull();
      expect(drr.drag?.id).toBe('a');
    });
  });

  describe('onHandlePointerDown / onRotateHandlePointerDown', () => {
    it('ignores resize start for locked elements', () => {
      const el = makeEl({ id: 'a', type: 'rect', locked: true });
      const ev = stubPointerEvent();
      svc.onHandlePointerDown(ev, 'se' as HandleDir, el);
      expect(drr.resize).toBeNull();
    });

    it('begins a resize with pointer capture', () => {
      const el = makeEl({ id: 'a', type: 'rect' });
      const target = {
        setPointerCapture: jasmine.createSpy('setPointerCapture'),
      } as unknown as HTMLElement;
      const ev = stubPointerEvent({ target });
      svc.onHandlePointerDown(ev, 'se' as HandleDir, el);
      expect(drr.resize?.id).toBe('a');
    });

    it('ignores rotate start for locked elements', () => {
      const el = makeEl({ id: 'a', type: 'rect', locked: true });
      const ev = stubPointerEvent();
      svc.onRotateHandlePointerDown(ev, el);
      expect(drr.rotate).toBeNull();
    });

    it('does nothing when the board rect is unavailable', () => {
      viewport.getBoardRect.and.returnValue(null);
      const el = makeEl({ id: 'a', type: 'rect' });
      const target = {
        setPointerCapture: jasmine.createSpy('setPointerCapture'),
      } as unknown as HTMLElement;
      const ev = stubPointerEvent({ target });
      svc.onRotateHandlePointerDown(ev, el);
      expect(drr.rotate).toBeNull();
    });

    it('begins a rotate computing the element center in screen space', () => {
      viewport.getBoardRect.and.returnValue(rectLike(10, 20, 1200, 800));
      zoom.zoom.set(1);
      const el = makeEl({ id: 'a', type: 'rect', x: 100, y: 50, w: 200, h: 100 });
      const target = {
        setPointerCapture: jasmine.createSpy('setPointerCapture'),
      } as unknown as HTMLElement;
      const ev = stubPointerEvent({ target, clientX: 210, clientY: 120 });
      svc.onRotateHandlePointerDown(ev, el);
      expect(drr.rotate).not.toBeNull();
      // cx = 10 + (100 + 100)*1 = 210; cy = 20 + (50 + 50)*1 = 120
      expect(drr.rotate?.cx).toBe(210);
      expect(drr.rotate?.cy).toBe(120);
    });
  });

  describe('onCanvasPointerDown', () => {
    it('starts a comment draft when in comment mode and board is available', () => {
      comments.commentMode.set(true);
      viewport.getBoardRect.and.returnValue(rectLike(0, 0, 1200, 800));
      const ev = stubPointerEvent({ clientX: 300, clientY: 200 });
      svc.onCanvasPointerDown(ev);
      const d = comments.draft();
      expect(d).not.toBeNull();
      expect(d?.x).toBe(300);
      expect(d?.y).toBe(200);
    });

    it('clears selection and sends null selection on a non-shift empty-space click', () => {
      sel.setPrimary('a');
      sel.setExtras(new Set(['b']));
      viewport.getBoardRect.and.returnValue(rectLike(0, 0, 1200, 800));
      const outside = document.createElement('div');
      const ev = stubPointerEvent({ target: outside });
      svc.onCanvasPointerDown(ev);
      expect(sel.selectedId()).toBeNull();
      expect(sel.isSelected('b')).toBeFalse();
      expect(collab.sendSelection).toHaveBeenCalledWith(null);
    });

    it('preserves selection on shift + outside-board click', () => {
      sel.setPrimary('a');
      const outside = document.createElement('div');
      const ev = stubPointerEvent({ target: outside, shiftKey: true });
      svc.onCanvasPointerDown(ev);
      expect(sel.selectedId()).toBe('a');
      expect(sel.marqueeRect()).toBeNull();
    });

    it('starts a marquee when the click lands inside the board-scroll area', () => {
      const container = document.createElement('div');
      container.className = 'board-scroll';
      const child = document.createElement('div');
      container.appendChild(child);
      viewport.getBoardRect.and.returnValue(rectLike(0, 0, 1200, 800));
      const ev = stubPointerEvent({ target: child, clientX: 50, clientY: 75 });
      svc.onCanvasPointerDown(ev);
      expect(sel.marqueeRect()).toEqual({ x: 50, y: 75, w: 0, h: 0 });
    });

    it('clears selection but does nothing else when no event is provided', () => {
      sel.setPrimary('x');
      svc.onCanvasPointerDown();
      expect(sel.selectedId()).toBeNull();
      expect(sel.marqueeRect()).toBeNull();
    });
  });

  describe('onCanvasPointerMove', () => {
    it('always sends cursor when board rect is available', () => {
      viewport.getBoardRect.and.returnValue(rectLike(0, 0, 1200, 800));
      const ev = stubPointerEvent({ clientX: 100, clientY: 50 });
      svc.onCanvasPointerMove(ev);
      expect(collab.sendCursor).toHaveBeenCalledWith(100, 50, undefined);
    });

    it('dispatches to rotate handler when a rotate is active and applies the move', () => {
      const el = makeEl({ id: 'a', type: 'rect', x: 100, y: 50, w: 200, h: 100 });
      state.list.set([el]);
      zoom.zoom.set(1);
      viewport.getBoardRect.and.returnValue(rectLike(0, 0, 1200, 800));
      drr.beginRotate(el, { clientX: 400, clientY: 100 }, 200, 100, 't1', 'p1');
      const ev = stubPointerEvent({ clientX: 200, clientY: 300 });
      svc.onCanvasPointerMove(ev);
      // Rotation was applied to element state and emitted
      expect(collab.sendEdit).toHaveBeenCalled();
      const updated = state.list().find((e) => e.id === 'a');
      expect(updated?.rotation).toBeDefined();
    });

    it('dispatches to drag handler and applies multi-drag delta when configured', () => {
      const primary = makeEl({ id: 'a', type: 'rect', x: 100, y: 50 });
      const other = makeEl({ id: 'b', type: 'rect', x: 300, y: 50 });
      state.list.set([primary, other]);
      sel.setPrimary('a');
      sel.setExtras(new Set(['b']));
      zoom.zoom.set(1);
      const target = { setPointerCapture: jasmine.createSpy() } as unknown as HTMLElement;
      // Click to prime multi-drag state
      svc.onElementPointerDown(stubPointerEvent({ target, clientX: 100, clientY: 50 }), primary);
      // Now move pointer 20 right
      const move = stubPointerEvent({ clientX: 120, clientY: 50 });
      svc.onCanvasPointerMove(move);
      const updatedPrimary = state.list().find((e) => e.id === 'a');
      const updatedOther = state.list().find((e) => e.id === 'b');
      expect(updatedPrimary?.x).toBe(120);
      expect(updatedOther?.x).toBe(320);
      // sendEdit called for both primary (via _applyMove) and other (via _applyMultiDragDelta)
      const ids = collab.sendEdit.calls.allArgs().map((args) => args[0]);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });

    it('updates the marquee when a marquee is in progress', () => {
      const container = document.createElement('div');
      container.className = 'board-scroll';
      const child = document.createElement('div');
      container.appendChild(child);
      viewport.getBoardRect.and.returnValue(rectLike(0, 0, 1200, 800));
      svc.onCanvasPointerDown(stubPointerEvent({ target: child, clientX: 10, clientY: 20 }));
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 110, clientY: 80 }));
      expect(sel.marqueeRect()).toEqual({ x: 10, y: 20, w: 100, h: 60 });
    });
  });

  describe('onCanvasPointerUp', () => {
    it('flushes pending edits when the drag ends with matching tid/pid/page', () => {
      const el = makeEl({ id: 'a', type: 'rect' });
      state.list.set([el]);
      drr.beginDrag(el, { clientX: 0, clientY: 0 }, 't1', 'p1');
      svc.onCanvasPointerUp();
      expect(collab.flushPendingEdits).toHaveBeenCalledTimes(1);
    });

    it('skips flush when active page changed mid-drag', () => {
      const el = makeEl({ id: 'a', type: 'rect' });
      state.list.set([el]);
      drr.beginDrag(el, { clientX: 0, clientY: 0 }, 't1', 'p1');
      workspace.activePageId.set('other-page');
      svc.onCanvasPointerUp();
      expect(collab.flushPendingEdits).not.toHaveBeenCalled();
    });

    it('skips flush when project id changed mid-resize', () => {
      const el = makeEl({ id: 'a', type: 'rect' });
      state.list.set([el]);
      drr.beginResize(el, 'se' as HandleDir, { clientX: 0, clientY: 0 }, 't1', 'p1');
      workspace.pid.set('p-different');
      svc.onCanvasPointerUp();
      expect(collab.flushPendingEdits).not.toHaveBeenCalled();
    });

    it('flushes pending edits on rotate end', () => {
      const el = makeEl({ id: 'a', type: 'rect' });
      state.list.set([el]);
      drr.beginRotate(el, { clientX: 0, clientY: 0 }, 0, 0, 't1', 'p1');
      svc.onCanvasPointerUp();
      expect(collab.flushPendingEdits).toHaveBeenCalledTimes(1);
    });

    it('flushes once for multi-drag end regardless of participant count', () => {
      const a = makeEl({ id: 'a', type: 'rect', x: 10, y: 10 });
      const b = makeEl({ id: 'b', type: 'rect', x: 300, y: 50 });
      state.list.set([a, b]);
      sel.setPrimary('a');
      sel.setExtras(new Set(['b']));
      const target = { setPointerCapture: jasmine.createSpy() } as unknown as HTMLElement;
      svc.onElementPointerDown(stubPointerEvent({ target, clientX: 10, clientY: 10 }), a);
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 20, clientY: 10 }));
      collab.flushPendingEdits.calls.reset();
      svc.onCanvasPointerUp();
      expect(collab.flushPendingEdits).toHaveBeenCalledTimes(1);
    });

    it('falls through to finishMarquee when no drag/resize/rotate is active', () => {
      const container = document.createElement('div');
      container.className = 'board-scroll';
      viewport.getBoardRect.and.returnValue(rectLike(0, 0, 1200, 800));
      svc.onCanvasPointerDown(stubPointerEvent({ target: container, clientX: 0, clientY: 0 }));
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 100, clientY: 100 }));
      svc.onCanvasPointerUp();
      expect(sel.marqueeRect()).toBeNull();
      expect(collab.flushPendingEdits).not.toHaveBeenCalled();
    });
  });

  describe('marquee finalization', () => {
    function primeMarquee(shift: boolean): void {
      const container = document.createElement('div');
      container.className = 'board-scroll';
      viewport.getBoardRect.and.returnValue(rectLike(0, 0, 1200, 800));
      svc.onCanvasPointerDown(
        stubPointerEvent({ target: container, clientX: 0, clientY: 0, shiftKey: shift }),
      );
    }

    it('does nothing when the marquee is smaller than 2x2', () => {
      primeMarquee(false);
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 1, clientY: 1 }));
      svc.onCanvasPointerUp();
      expect(sel.selectedId()).toBeNull();
      expect(collab.sendSelection).not.toHaveBeenCalledWith(jasmine.any(String));
    });

    it('non-shift + no picks clears selection', () => {
      state.list.set([makeEl({ id: 'a', type: 'rect', x: 500, y: 500, w: 10, h: 10 })]);
      sel.setPrimary('preexisting');
      primeMarquee(false);
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 100, clientY: 100 }));
      svc.onCanvasPointerUp();
      expect(sel.selectedId()).toBeNull();
      expect(collab.sendSelection).toHaveBeenCalledWith(null);
    });

    it('non-shift + picks promotes first to primary, rest to extras', () => {
      state.list.set([
        makeEl({ id: 'a', type: 'rect', x: 10, y: 10, w: 40, h: 40 }),
        makeEl({ id: 'b', type: 'rect', x: 50, y: 50, w: 40, h: 40 }),
      ]);
      primeMarquee(false);
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 200, clientY: 200 }));
      svc.onCanvasPointerUp();
      expect(sel.selectedId()).toBe('a');
      expect(sel.isSelected('b')).toBeTrue();
      expect(collab.sendSelection).toHaveBeenCalledWith('a');
    });

    it('shift + no picks keeps existing selection unchanged', () => {
      state.list.set([makeEl({ id: 'a', type: 'rect', x: 500, y: 500, w: 10, h: 10 })]);
      sel.setPrimary('a');
      primeMarquee(true);
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 100, clientY: 100 }));
      collab.sendSelection.calls.reset();
      svc.onCanvasPointerUp();
      expect(sel.selectedId()).toBe('a');
      expect(collab.sendSelection).not.toHaveBeenCalled();
    });

    it('shift + picks + existing primary in merged set moves primary to extras', () => {
      state.list.set([
        makeEl({ id: 'a', type: 'rect', x: 10, y: 10, w: 40, h: 40 }),
        makeEl({ id: 'b', type: 'rect', x: 50, y: 50, w: 40, h: 40 }),
      ]);
      sel.setPrimary('a');
      primeMarquee(true);
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 200, clientY: 200 }));
      svc.onCanvasPointerUp();
      expect(sel.selectedId()).toBe('a');
      expect(sel.isSelected('b')).toBeTrue();
    });

    it('shift + picks with no prior primary picks first of merged and emits selection', () => {
      state.list.set([
        makeEl({ id: 'a', type: 'rect', x: 10, y: 10, w: 40, h: 40 }),
        makeEl({ id: 'b', type: 'rect', x: 50, y: 50, w: 40, h: 40 }),
      ]);
      sel.clear();
      primeMarquee(true);
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 200, clientY: 200 }));
      svc.onCanvasPointerUp();
      const primary = sel.selectedId();
      expect(primary).not.toBeNull();
      expect(collab.sendSelection).toHaveBeenCalledWith(primary);
    });
  });

  describe('_applyMultiDragDelta via drag path', () => {
    it('skips propagation and emit when dx=dy=0', () => {
      const a = makeEl({ id: 'a', type: 'rect', x: 10, y: 10 });
      const b = makeEl({ id: 'b', type: 'rect', x: 300, y: 50 });
      state.list.set([a, b]);
      sel.setPrimary('a');
      sel.setExtras(new Set(['b']));
      const target = { setPointerCapture: jasmine.createSpy() } as unknown as HTMLElement;
      // begin drag (primary 'a')
      svc.onElementPointerDown(stubPointerEvent({ target, clientX: 10, clientY: 10 }), a);
      collab.sendEdit.calls.reset();
      // Pointer did not move: dx=dy=0
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 10, clientY: 10 }));
      // Only primary patch emits — no other
      const idsEmitted = collab.sendEdit.calls.allArgs().map((args) => args[0]);
      expect(idsEmitted).not.toContain('b');
    });

    it('emits sendEdit per other participant when dx!=0', () => {
      const a = makeEl({ id: 'a', type: 'rect', x: 10, y: 10 });
      const b = makeEl({ id: 'b', type: 'rect', x: 300, y: 50 });
      const c = makeEl({ id: 'c', type: 'rect', x: 600, y: 70 });
      state.list.set([a, b, c]);
      sel.setPrimary('a');
      sel.setExtras(new Set(['b', 'c']));
      const target = { setPointerCapture: jasmine.createSpy() } as unknown as HTMLElement;
      svc.onElementPointerDown(stubPointerEvent({ target, clientX: 10, clientY: 10 }), a);
      collab.sendEdit.calls.reset();
      svc.onCanvasPointerMove(stubPointerEvent({ clientX: 40, clientY: 10 }));
      const ids = collab.sendEdit.calls.allArgs().map((args) => args[0]);
      expect(ids).toContain('a');
      expect(ids).toContain('b');
      expect(ids).toContain('c');
      expect(state.list().find((e) => e.id === 'b')?.x).toBe(330);
      expect(state.list().find((e) => e.id === 'c')?.x).toBe(630);
    });
  });

  describe('onCanvasPointerCancel', () => {
    it('clears drr state and resets marquee + multi-drag state', () => {
      const el = makeEl({ id: 'a', type: 'rect' });
      state.list.set([el]);
      drr.beginDrag(el, { clientX: 0, clientY: 0 }, 't1', 'p1');
      sel.setMarquee({ x: 1, y: 1, w: 10, h: 10 });
      svc.onCanvasPointerCancel();
      expect(drr.drag).toBeNull();
      expect(sel.marqueeRect()).toBeNull();
    });
  });
});
