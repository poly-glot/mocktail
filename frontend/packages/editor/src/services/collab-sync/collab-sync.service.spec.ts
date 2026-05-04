import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CollabService, IRemoteDelete, IRemoteDeleteFields, IRemoteEdit } from '@mocktail/collab';
import { IWireElement, ProjectApiService } from '@mocktail/projects';
import { CanvasGestureStore } from '../canvas-gesture/canvas-gesture.store';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorInlineEditService } from '../inline-edit/inline-edit.service';
import { EditorCollabSyncService } from './collab-sync.service';

function el(id: string, overrides: Partial<IWireElement> = {}): IWireElement {
  return {
    id,
    pageId: 'p1',
    type: 'text',
    x: 0,
    y: 0,
    w: 100,
    h: 30,
    rotation: 0,
    zIndex: 0,
    ...overrides,
  };
}

function remoteEdit(patch: Record<string, unknown>, elementId = 'a'): IRemoteEdit {
  return { elementId, patch, from: 'peer' };
}

describe('EditorCollabSyncService', () => {
  let state: EditorElementsStateService;
  let inline: EditorInlineEditService;
  let drr: { activeId: jasmine.Spy };
  let collabStub: {
    lastRemoteEdit: ReturnType<typeof signal<IRemoteEdit | null>>;
    lastRemoteDelete: ReturnType<typeof signal<IRemoteDelete | null>>;
    lastRemoteDeleteFields: ReturnType<typeof signal<IRemoteDeleteFields | null>>;
  };

  beforeEach(() => {
    collabStub = {
      lastRemoteEdit: signal<IRemoteEdit | null>(null),
      lastRemoteDelete: signal<IRemoteDelete | null>(null),
      lastRemoteDeleteFields: signal<IRemoteDeleteFields | null>(null),
    };
    drr = { activeId: jasmine.createSpy('activeId').and.returnValue(null) };
    TestBed.configureTestingModule({
      providers: [
        { provide: CollabService, useValue: collabStub as Partial<CollabService> },
        { provide: CanvasGestureStore, useValue: drr as Partial<CanvasGestureStore> },
        {
          provide: ProjectApiService,
          useValue: {
            upsertElement: jasmine.createSpy().and.resolveTo(undefined),
          } as Partial<ProjectApiService>,
        },
        EditorCollabSyncService,
      ],
    });
    TestBed.inject(EditorCollabSyncService);
    state = TestBed.inject(EditorElementsStateService);
    inline = TestBed.inject(EditorInlineEditService);
  });

  function fire(edit: IRemoteEdit): void {
    collabStub.lastRemoteEdit.set(edit);
    TestBed.flushEffects();
  }

  it('applies a remote edit to the matching element', () => {
    state.list.set([el('a', { x: 0 })]);
    fire(remoteEdit({ x: 55 }));
    expect(state.getById('a')?.x).toBe(55);
  });

  it('skips the merge while the local user is dragging the same element', () => {
    state.list.set([el('a', { x: 10 })]);
    drr.activeId.and.returnValue('a');
    fire(remoteEdit({ x: 99 }));
    expect(state.getById('a')?.x).toBe(10);
  });

  it('skips a text patch while the local user is inline-editing that element', () => {
    state.list.set([el('a', { text: 'hi' })]);
    inline.begin('a');
    fire(remoteEdit({ text: 'remote' }));
    expect(state.getById('a')?.text).toBe('hi');
  });

  it('allows non-text patches through while inline-editing the same element', () => {
    state.list.set([el('a', { x: 0, text: 'hi' })]);
    inline.begin('a');
    fire(remoteEdit({ x: 7 }));
    expect(state.getById('a')?.x).toBe(7);
  });

  it('removes an element from local state when a remote delete arrives', () => {
    state.list.set([el('a'), el('b')]);
    collabStub.lastRemoteDelete.set({ elementId: 'a', from: 'peer' });
    TestBed.flushEffects();
    expect(state.getById('a')).toBeUndefined();
    expect(state.getById('b')).toBeDefined();
  });

  it('strips listed fields from the target element on a remote deleteFields', () => {
    state.list.set([el('a', { color: '#abcdef', text: 'hi' })]);
    collabStub.lastRemoteDeleteFields.set({
      elementId: 'a',
      fields: ['color'],
      from: 'peer',
    });
    TestBed.flushEffects();
    const after = state.getById('a') as IWireElement & { color?: string };
    expect(after?.color).toBeUndefined();
    expect(after?.text).toBe('hi');
  });
});
