import { TestBed } from '@angular/core/testing';
import { WritableSignal, signal } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { IPageDoc } from '@mocktail/projects';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { EditorZoomService } from '../zoom/zoom.service';
import { EditorViewportService } from './viewport.service';

type RoCallback = (entries: { contentRect: DOMRectReadOnly }[]) => void;

class MockResizeObserver {
  public static readonly observers: MockResizeObserver[] = [];
  public static latest(): MockResizeObserver | undefined {
    return MockResizeObserver.observers[MockResizeObserver.observers.length - 1];
  }

  public readonly cb: RoCallback;
  public readonly observed: Element[] = [];
  public disconnected = false;

  constructor(cb: RoCallback) {
    this.cb = cb;
    MockResizeObserver.observers.push(this);
  }

  public observe(el: Element): void {
    this.observed.push(el);
  }

  public disconnect(): void {
    this.disconnected = true;
  }

  public unobserve(): void {
    // unused in the production path, included for API parity
  }

  public emitContentRect(w: number, h: number): void {
    const rect = { width: w, height: h } as DOMRectReadOnly;
    this.cb([{ contentRect: rect }]);
  }
}

interface ElementStub {
  rect: DOMRect;
  getBoundingClientRect(): DOMRect;
}

function makeElement(rect: Partial<DOMRect>): ElementStub {
  const full: DOMRect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: rect.width ?? 0,
    bottom: rect.height ?? 0,
    width: 0,
    height: 0,
    ...rect,
    toJSON: () => ({}),
  } as DOMRect;
  return {
    rect: full,
    getBoundingClientRect: () => full,
  };
}

describe('EditorViewportService', () => {
  let svc: EditorViewportService;
  let zoom: EditorZoomService;
  let elsState: EditorElementsStateService;
  let sessionStub: { activePage: WritableSignal<IPageDoc | null> };
  let originalRO: typeof ResizeObserver;

  beforeEach(() => {
    originalRO = (globalThis as unknown as { ResizeObserver: typeof ResizeObserver })
      .ResizeObserver;
    MockResizeObserver.observers.length = 0;
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      MockResizeObserver as unknown as typeof ResizeObserver;

    sessionStub = { activePage: signal<IPageDoc | null>(null) };

    TestBed.configureTestingModule({
      providers: [
        { provide: WorkspaceStore, useValue: sessionStub as Partial<WorkspaceStore> },
        {
          provide: CollabService,
          useValue: {
            sendEdit: jasmine.createSpy('sendEdit'),
            flushPendingEdits: jasmine.createSpy('flushPendingEdits'),
          } as Partial<CollabService>,
        },
        EditorViewportService,
      ],
    });

    zoom = TestBed.inject(EditorZoomService);
    elsState = TestBed.inject(EditorElementsStateService);
    svc = TestBed.inject(EditorViewportService);
  });

  afterEach(() => {
    (globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      originalRO;
  });

  describe('canvas tracking', () => {
    it('leaves canvasSize null until a canvas element is registered', () => {
      TestBed.flushEffects();
      expect(svc.canvasSize()).toBeNull();
    });

    it('setCanvasEl(null) keeps canvasSize null and does not observe anything', () => {
      svc.setCanvasEl(null);
      TestBed.flushEffects();
      expect(svc.canvasSize()).toBeNull();
      expect(MockResizeObserver.observers.length).toBe(0);
    });

    it('seeds canvasSize from getBoundingClientRect and observes the element', () => {
      const el = makeElement({ width: 800, height: 600 });
      svc.setCanvasEl(el as unknown as HTMLDivElement);
      TestBed.flushEffects();
      expect(svc.canvasSize()).toEqual({ w: 800, h: 600 });
      expect(MockResizeObserver.observers.length).toBe(1);
      expect(MockResizeObserver.latest()!.observed.length).toBe(1);
    });

    it('updates canvasSize when the ResizeObserver fires', () => {
      const el = makeElement({ width: 400, height: 300 });
      svc.setCanvasEl(el as unknown as HTMLDivElement);
      TestBed.flushEffects();
      MockResizeObserver.latest()!.emitContentRect(900, 700);
      expect(svc.canvasSize()).toEqual({ w: 900, h: 700 });
    });

    it('disconnects the previous observer when the canvas element changes', () => {
      const first = makeElement({ width: 100, height: 100 });
      svc.setCanvasEl(first as unknown as HTMLDivElement);
      TestBed.flushEffects();
      const firstRo = MockResizeObserver.latest()!;
      const second = makeElement({ width: 200, height: 200 });
      svc.setCanvasEl(second as unknown as HTMLDivElement);
      TestBed.flushEffects();
      expect(firstRo.disconnected).toBeTrue();
      expect(MockResizeObserver.observers.length).toBe(2);
    });

    it('clears canvasSize when the canvas element is removed', () => {
      const el = makeElement({ width: 800, height: 600 });
      svc.setCanvasEl(el as unknown as HTMLDivElement);
      TestBed.flushEffects();
      svc.setCanvasEl(null);
      TestBed.flushEffects();
      expect(svc.canvasSize()).toBeNull();
    });
  });

  describe('auto-fit effect', () => {
    function mountCanvas(w: number, h: number): void {
      const el = makeElement({ width: w, height: h });
      svc.setCanvasEl(el as unknown as HTMLDivElement);
      TestBed.flushEffects();
    }

    it('calls EditorZoomService.setFromAutoFit with the computed fit value', () => {
      const spy = spyOn(zoom, 'setFromAutoFit').and.callThrough();
      sessionStub.activePage.set({
        id: 'p1',
        name: 'P1',
        order: 0,
        width: 1200,
        height: 800,
      });
      mountCanvas(1200, 900);
      // availW = 1200 - 96 = 1104; availH = 900 - 160 = 740
      // fit = min(1104/1200, 740/800, 1) = min(0.92, 0.925, 1) = 0.92
      expect(spy).toHaveBeenCalled();
      const last = spy.calls.mostRecent().args[0];
      expect(last).toBeCloseTo(0.92, 4);
    });

    it('skips when auto-fit is disabled', () => {
      zoom.autoFitZoom.set(false);
      const spy = spyOn(zoom, 'setFromAutoFit');
      sessionStub.activePage.set({
        id: 'p1',
        name: 'P1',
        order: 0,
        width: 1200,
        height: 800,
      });
      mountCanvas(1200, 900);
      expect(spy).not.toHaveBeenCalled();
    });

    it('skips when canvasSize is below the 80px threshold', () => {
      const spy = spyOn(zoom, 'setFromAutoFit');
      sessionStub.activePage.set({
        id: 'p1',
        name: 'P1',
        order: 0,
        width: 1200,
        height: 800,
      });
      mountCanvas(50, 50);
      expect(spy).not.toHaveBeenCalled();
    });

    it('falls back to the default 1200x800 page when no active page is set', () => {
      const spy = spyOn(zoom, 'setFromAutoFit').and.callThrough();
      mountCanvas(1200, 900);
      expect(spy).toHaveBeenCalled();
    });

    it('recomputes fit when the canvas resizes', () => {
      sessionStub.activePage.set({
        id: 'p1',
        name: 'P1',
        order: 0,
        width: 1200,
        height: 800,
      });
      mountCanvas(1200, 900);
      const spy = spyOn(zoom, 'setFromAutoFit').and.callThrough();
      MockResizeObserver.latest()!.emitContentRect(600, 500);
      TestBed.flushEffects();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('getBoardRect / getCanvasRect', () => {
    it('returns null for both when neither element has been registered', () => {
      expect(svc.getBoardRect()).toBeNull();
      expect(svc.getCanvasRect()).toBeNull();
    });

    it('returns a live rect from the canvas element once registered', () => {
      const canvas = makeElement({ left: 10, top: 20, width: 800, height: 600 });
      svc.setCanvasEl(canvas as unknown as HTMLDivElement);
      const rect = svc.getCanvasRect();
      expect(rect).not.toBeNull();
      expect(rect!.left).toBe(10);
      expect(rect!.top).toBe(20);
      expect(rect!.width).toBe(800);
      expect(rect!.height).toBe(600);
    });

    it('returns a live rect from the board element once registered', () => {
      const board = makeElement({ left: 5, top: 15, width: 1200, height: 800 });
      svc.setBoardEl(board as unknown as HTMLDivElement);
      const rect = svc.getBoardRect();
      expect(rect).not.toBeNull();
      expect(rect!.left).toBe(5);
      expect(rect!.top).toBe(15);
      expect(rect!.width).toBe(1200);
      expect(rect!.height).toBe(800);
    });

    it('returns null after the registered element is cleared', () => {
      const canvas = makeElement({ width: 100, height: 100 });
      const board = makeElement({ width: 200, height: 200 });
      svc.setCanvasEl(canvas as unknown as HTMLDivElement);
      svc.setBoardEl(board as unknown as HTMLDivElement);
      svc.setCanvasEl(null);
      svc.setBoardEl(null);
      expect(svc.getCanvasRect()).toBeNull();
      expect(svc.getBoardRect()).toBeNull();
    });
  });

  describe('viewportCenterOnBoard', () => {
    it('returns a staircase fallback when canvas and board are not registered', () => {
      elsState.list.set([{ id: 'a' } as never, { id: 'b' } as never]);
      const result = svc.viewportCenterOnBoard(100, 50);
      expect(result).toEqual({ x: 2 * 8 + 40, y: 40 });
    });

    it('computes the board-space center at zoom=1 when rects line up', () => {
      // canvas spans 0..1000 horizontally and 0..800 vertically; board sits at
      // the same origin, so the viewport center in board coords is (500, 400).
      const canvas = makeElement({ left: 0, top: 0, width: 1000, height: 800 });
      const board = makeElement({ left: 0, top: 0, width: 1200, height: 800 });
      svc.setCanvasEl(canvas as unknown as HTMLDivElement);
      svc.setBoardEl(board as unknown as HTMLDivElement);
      TestBed.flushEffects();
      sessionStub.activePage.set({
        id: 'p1',
        name: 'P1',
        order: 0,
        width: 1200,
        height: 800,
      });
      zoom.autoFitZoom.set(false);
      zoom.zoom.set(1);
      const { x, y } = svc.viewportCenterOnBoard(100, 50);
      // center is (500, 400), subtract half element dims
      expect(x).toBe(450);
      expect(y).toBe(375);
    });

    it('clamps the result inside the page bounds', () => {
      // Put the canvas far to the right so the naive center ends up past the
      // page edge — the service must clamp it back inside.
      const canvas = makeElement({ left: 5000, top: 5000, width: 400, height: 400 });
      const board = makeElement({ left: 0, top: 0, width: 1200, height: 800 });
      svc.setCanvasEl(canvas as unknown as HTMLDivElement);
      svc.setBoardEl(board as unknown as HTMLDivElement);
      TestBed.flushEffects();
      sessionStub.activePage.set({
        id: 'p1',
        name: 'P1',
        order: 0,
        width: 1200,
        height: 800,
      });
      zoom.autoFitZoom.set(false);
      zoom.zoom.set(1);
      const { x, y } = svc.viewportCenterOnBoard(100, 50);
      expect(x).toBe(1200 - 100);
      expect(y).toBe(800 - 50);
    });

    it('divides the delta by zoom when computing board coordinates', () => {
      const canvas = makeElement({ left: 0, top: 0, width: 1000, height: 800 });
      const board = makeElement({ left: 0, top: 0, width: 2400, height: 1600 });
      svc.setCanvasEl(canvas as unknown as HTMLDivElement);
      svc.setBoardEl(board as unknown as HTMLDivElement);
      TestBed.flushEffects();
      sessionStub.activePage.set({
        id: 'p1',
        name: 'P1',
        order: 0,
        width: 2400,
        height: 1600,
      });
      zoom.autoFitZoom.set(false);
      zoom.zoom.set(0.5);
      const { x, y } = svc.viewportCenterOnBoard(100, 50);
      // center in viewport (500, 400) -> board space (1000, 800), minus half dims
      expect(x).toBe(950);
      expect(y).toBe(775);
    });
  });
});
