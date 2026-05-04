import { TestBed } from '@angular/core/testing';
import { CollabService } from '@mocktail/collab';
import { IWireElement, ProjectApiService } from '@mocktail/projects';
import { EditorContextMenuService } from '../context-menu/context-menu.service';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorSelectionService } from '../selection/selection.service';
import { EditorLayerOrderService } from './layer-order.service';

function el(id: string, zIndex: number, overrides: Partial<IWireElement> = {}): IWireElement {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    w: 100,
    h: 30,
    rotation: 0,
    zIndex,
    ...overrides,
  } as IWireElement;
}

describe('EditorLayerOrderService', () => {
  const TID = 't';
  const PID = 'p';

  let svc: EditorLayerOrderService;
  let state: EditorElementsStateService;
  let sel: EditorSelectionService;
  let ctx: EditorContextMenuService;
  let collab: {
    sendEdit: jasmine.Spy;
    flushPendingEdits: jasmine.Spy;
  };

  beforeEach(() => {
    collab = {
      sendEdit: jasmine.createSpy('sendEdit'),
      flushPendingEdits: jasmine.createSpy('flushPendingEdits'),
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProjectApiService,
          useValue: {} as Partial<ProjectApiService>,
        },
        { provide: CollabService, useValue: collab as Partial<CollabService> },
      ],
    });
    svc = TestBed.inject(EditorLayerOrderService);
    state = TestBed.inject(EditorElementsStateService);
    sel = TestBed.inject(EditorSelectionService);
    ctx = TestBed.inject(EditorContextMenuService);
  });

  function zOf(id: string): number | undefined {
    return state.getById(id)?.zIndex;
  }

  describe('bringToFront', () => {
    it('raises the element zIndex above the current max and closes the context menu', async () => {
      state.list.set([el('a', 1), el('b', 3), el('c', 2)]);
      ctx.openAt(0, 0, 'a');
      await svc.bringToFront(TID, PID, 'a');
      expect(zOf('a')).toBe(4);
      expect(ctx.menu()).toBeNull();
    });

    it('falls back to the current selection when no id is passed', async () => {
      state.list.set([el('a', 1), el('b', 3)]);
      sel.setPrimary('a');
      await svc.bringToFront(TID, PID);
      expect(zOf('a')).toBe(4);
    });

    it('is a no-op when nothing is selected and no id is passed', async () => {
      state.list.set([el('a', 1)]);
      await svc.bringToFront(TID, PID);
      expect(collab.sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('sendToBack', () => {
    it('lowers the element zIndex below the current min', async () => {
      state.list.set([el('a', 2), el('b', 3), el('c', 1)]);
      await svc.sendToBack(TID, PID, 'a');
      expect(zOf('a')).toBe(0);
    });
  });

  describe('bringForward', () => {
    it('moves the element one step above the next element in z-order', async () => {
      state.list.set([el('a', 1), el('b', 2), el('c', 3)]);
      await svc.bringForward(TID, PID, 'a');
      expect(zOf('a')).toBe(3);
    });

    it('is a no-op when the element is already at the top', async () => {
      state.list.set([el('a', 1), el('b', 2)]);
      await svc.bringForward(TID, PID, 'b');
      expect(collab.sendEdit).not.toHaveBeenCalled();
    });

    it('is a no-op when the element does not exist', async () => {
      state.list.set([el('a', 1)]);
      await svc.bringForward(TID, PID, 'missing');
      expect(collab.sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('sendBackward', () => {
    it('moves the element one step below the previous element in z-order', async () => {
      state.list.set([el('a', 1), el('b', 2), el('c', 3)]);
      await svc.sendBackward(TID, PID, 'c');
      expect(zOf('c')).toBe(1);
    });

    it('is a no-op when the element is already at the bottom', async () => {
      state.list.set([el('a', 1), el('b', 2)]);
      await svc.sendBackward(TID, PID, 'a');
      expect(collab.sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('toggleLock', () => {
    it('flips the locked flag on the target', async () => {
      state.list.set([el('a', 1, { locked: false } as Partial<IWireElement>)]);
      await svc.toggleLock(TID, PID, 'a');
      expect(state.getById('a')?.locked).toBeTrue();
    });

    it('unlocks a previously-locked element', async () => {
      state.list.set([el('a', 1, { locked: true } as Partial<IWireElement>)]);
      await svc.toggleLock(TID, PID, 'a');
      expect(state.getById('a')?.locked).toBeFalse();
    });

    it('is a no-op when the element does not exist', async () => {
      state.list.set([el('a', 1)]);
      await svc.toggleLock(TID, PID, 'missing');
      expect(collab.sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('reorderLayer', () => {
    it('is a no-op when fromId === toId', async () => {
      state.list.set([el('a', 1), el('b', 2)]);
      await svc.reorderLayer(TID, PID, 'a', 'a', 'above');
      expect(collab.sendEdit).not.toHaveBeenCalled();
    });

    it('is a no-op when the target does not exist', async () => {
      state.list.set([el('a', 1)]);
      await svc.reorderLayer(TID, PID, 'a', 'missing', 'above');
      expect(collab.sendEdit).not.toHaveBeenCalled();
    });

    it('moves "a" above "c" and compacts zIndexes to a contiguous 1..N', async () => {
      state.list.set([el('a', 1), el('b', 2), el('c', 3)]);
      await svc.reorderLayer(TID, PID, 'a', 'c', 'above');
      expect(zOf('b')).toBe(1);
      expect(zOf('c')).toBe(2);
      expect(zOf('a')).toBe(3);
    });

    it('moves "c" below "a" and compacts zIndexes', async () => {
      state.list.set([el('a', 1), el('b', 2), el('c', 3)]);
      await svc.reorderLayer(TID, PID, 'c', 'a', 'below');
      expect(zOf('c')).toBe(1);
      expect(zOf('a')).toBe(2);
      expect(zOf('b')).toBe(3);
    });

    it('forwards one sendEdit per changed element through the collab proxy and flushes', async () => {
      state.list.set([el('a', 1), el('b', 2), el('c', 3)]);
      await svc.reorderLayer(TID, PID, 'a', 'c', 'above');
      const ids = collab.sendEdit.calls
        .allArgs()
        .map((a) => a[0] as string)
        .sort();
      expect(ids).toEqual(['a', 'b', 'c']);
      expect(collab.flushPendingEdits).toHaveBeenCalledTimes(1);
    });
  });
});
