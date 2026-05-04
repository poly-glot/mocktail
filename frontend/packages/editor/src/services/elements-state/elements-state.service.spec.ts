import { TestBed } from '@angular/core/testing';
import { CollabService } from '@mocktail/collab';
import { IWireElement } from '@mocktail/projects';
import { EditorElementsStateService } from './elements-state.service';

function el(id: string, overrides: Partial<IWireElement> = {}): IWireElement {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    w: 100,
    h: 30,
    rotation: 0,
    zIndex: 0,
    ...overrides,
  } as IWireElement;
}

describe('EditorElementsStateService', () => {
  let svc: EditorElementsStateService;
  let sendEditSpy: jasmine.Spy;
  let flushSpy: jasmine.Spy;

  beforeEach(() => {
    sendEditSpy = jasmine.createSpy('sendEdit');
    flushSpy = jasmine.createSpy('flushPendingEdits');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CollabService,
          useValue: {
            sendEdit: sendEditSpy,
            flushPendingEdits: flushSpy,
          } as Partial<CollabService>,
        },
      ],
    });
    svc = TestBed.inject(EditorElementsStateService);
  });

  it('starts with an empty list', () => {
    expect(svc.list()).toEqual([]);
  });

  it('reset clears the list', () => {
    svc.list.set([el('a')]);
    svc.reset();
    expect(svc.list()).toEqual([]);
  });

  it('getById returns a matching element or undefined', () => {
    svc.list.set([el('a'), el('b')]);
    expect(svc.getById('a')?.id).toBe('a');
    expect(svc.getById('missing')).toBeUndefined();
  });

  describe('updateById', () => {
    it('replaces the matching element with the updater result', () => {
      svc.list.set([el('a', { x: 1 }), el('b', { x: 2 })]);
      svc.updateById('a', (e) => ({ ...e, x: 99 }));
      expect(svc.getById('a')?.x).toBe(99);
      expect(svc.getById('b')?.x).toBe(2);
    });

    it('is a no-op when the id does not exist', () => {
      const before = [el('a', { x: 1 })];
      svc.list.set(before);
      const prevRef = svc.list();
      svc.updateById('missing', (e) => ({ ...e, x: 99 }));
      expect(svc.list()).toBe(prevRef);
    });

    it('returns a new list reference when an element is updated', () => {
      svc.list.set([el('a', { x: 1 })]);
      const prevRef = svc.list();
      svc.updateById('a', (e) => ({ ...e, x: 2 }));
      expect(svc.list()).not.toBe(prevRef);
    });
  });

  describe('patch', () => {
    it('merges a partial into the stored element and routes via collab', async () => {
      svc.list.set([el('a', { x: 10 }), el('b')]);
      await svc.patch('t1', 'p1', 'a', { x: 42 });
      expect(svc.getById('a')?.x).toBe(42);
      expect(sendEditSpy).toHaveBeenCalledTimes(1);
      const [id, patch] = sendEditSpy.calls.mostRecent().args;
      expect(id).toBe('a');
      expect(patch).toEqual({ x: 42 });
      expect(flushSpy).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the id does not exist', async () => {
      svc.list.set([el('a')]);
      await svc.patch('t1', 'p1', 'missing', { x: 99 });
      expect(sendEditSpy).not.toHaveBeenCalled();
      expect(flushSpy).not.toHaveBeenCalled();
      expect(svc.list().length).toBe(1);
      expect(svc.getById('a')?.x).toBe(0);
    });

    it('does not mutate other elements', async () => {
      svc.list.set([el('a', { x: 1 }), el('b', { x: 2 })]);
      await svc.patch('t', 'p', 'a', { x: 99 });
      expect(svc.getById('b')?.x).toBe(2);
    });
  });
});
