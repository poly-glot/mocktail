import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { DialogService } from '@mocktail/cdk';
import { CollabService } from '@mocktail/collab';
import { AiService, IWireElement, ProjectApiService } from '@mocktail/projects';
import { TenantService } from '@mocktail/tenant';
import { of } from 'rxjs';
import { EditorComponent } from './editor.component';
import { EditorShortcutsDirective } from '../../directives/editor-shortcuts/editor-shortcuts.directive';
import { CanvasGestureStore } from '../../services/canvas-gesture/canvas-gesture.store';
import { EditorElementEditorService } from '../../services/element-editor/element-editor.service';
import { IPaletteItem, PALETTES } from '../palette/palette.component';
import { iconForType, labelForElement } from '../layers-panel/layers-panel.component';

type Patch = Partial<IWireElement>;

function itemOf(type: string): IPaletteItem {
  const found = PALETTES.flatMap((p) => p.items).find((i) => i.type === type);
  if (!found) throw new Error(`unknown palette item type ${type}`);
  return found;
}

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

describe('EditorComponent', () => {
  let fixture: ComponentFixture<EditorComponent>;
  let cmp: EditorComponent;
  let drr: CanvasGestureStore;
  let editorSvc: EditorElementEditorService;
  let projects: jasmine.SpyObj<ProjectApiService>;
  let collab: {
    connected: ReturnType<typeof signal<boolean>>;
    cursors: ReturnType<typeof signal<Map<string, unknown>>>;
    lastRemoteEdit: ReturnType<typeof signal<unknown>>;
    lastRemoteDelete: ReturnType<typeof signal<unknown>>;
    lastRemoteDeleteFields: ReturnType<typeof signal<unknown>>;
    connect: jasmine.Spy;
    disconnect: jasmine.Spy;
    sendCursor: jasmine.Spy;
    sendEdit: jasmine.Spy;
    sendDelete: jasmine.Spy;
    sendDeleteFields: jasmine.Spy;
    sendSelection: jasmine.Spy;
    flushPendingEdits: jasmine.Spy;
  };
  let dialog: jasmine.SpyObj<DialogService>;

  beforeEach(async () => {
    projects = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', [
      'subscribePages',
      'subscribeElements',
      'subscribeComments',
      'subscribeProjectDoc',
      'upsertElement',
      'deleteElement',
      'writeActivity',
      'updateGridConfig',
      'addPage',
      'deletePage',
      'addElements',
      'replaceElements',
      'addComment',
      'resolveComment',
      'patchElements',
    ]);
    projects.subscribePages.and.returnValue(() => undefined);
    projects.subscribeElements.and.returnValue(() => undefined);
    projects.subscribeComments.and.returnValue(() => undefined);
    projects.subscribeProjectDoc.and.returnValue(() => undefined);
    projects.upsertElement.and.returnValue(Promise.resolve());
    projects.deleteElement.and.returnValue(Promise.resolve());
    projects.writeActivity.and.returnValue(Promise.resolve());
    projects.updateGridConfig.and.returnValue(Promise.resolve());
    projects.patchElements.and.returnValue(Promise.resolve());

    collab = {
      connected: signal(false),
      cursors: signal(new Map()),
      lastRemoteEdit: signal(null),
      lastRemoteDelete: signal(null),
      lastRemoteDeleteFields: signal(null),
      connect: jasmine.createSpy('connect'),
      disconnect: jasmine.createSpy('disconnect'),
      sendCursor: jasmine.createSpy('sendCursor'),
      sendEdit: jasmine.createSpy('sendEdit'),
      sendDelete: jasmine.createSpy('sendDelete'),
      sendDeleteFields: jasmine.createSpy('sendDeleteFields'),
      sendSelection: jasmine.createSpy('sendSelection'),
      flushPendingEdits: jasmine.createSpy('flushPendingEdits'),
    };

    dialog = jasmine.createSpyObj<DialogService>('DialogService', ['alert', 'confirm']);
    dialog.alert.and.returnValue(Promise.resolve());
    dialog.confirm.and.returnValue(Promise.resolve(true));

    await TestBed.configureTestingModule({
      imports: [EditorComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: of(convertToParamMap({ tid: 't1', pid: 'p1' })) },
        },
        { provide: ProjectApiService, useValue: projects },
        {
          provide: TenantService,
          useValue: {
            setCurrent: jasmine.createSpy('setCurrent'),
            current: signal({ id: 't1', name: 'Team' }),
            memberships: signal([]),
          },
        },
        { provide: CollabService, useValue: collab },
        {
          provide: AiService,
          useValue: {
            busy: signal(false),
            lastNotes: signal(null),
            lastSource: signal(null),
            generate: jasmine.createSpy('generate').and.resolveTo({ elements: [] }),
          },
        },
        { provide: DialogService, useValue: dialog },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EditorComponent);
    cmp = fixture.componentInstance;
    // CanvasGestureStore is component-scoped (provided by EditorComponent),
    // so reach into the component's injector to grab the same instance the
    // component uses.
    drr = fixture.debugElement.injector.get(CanvasGestureStore);
    editorSvc = TestBed.inject(EditorElementEditorService);
    fixture.detectChanges();
  });

  function fakeDrag(id: string, pageId = 'pg1', tid = 't1', pid = 'p1'): void {
    const el = makeEl({ id, type: 'rect', pageId });
    drr.beginDrag(el, { clientX: 0, clientY: 0 }, tid, pid);
  }
  function fakeResize(id: string, pageId = 'pg1', tid = 't1', pid = 'p1'): void {
    const el = makeEl({ id, type: 'rect', pageId });
    drr.beginResize(el, 'se', { clientX: 0, clientY: 0 }, tid, pid);
  }

  /**
   * Shortcut-layer compatibility shim: the keyboard shortcuts used to live on
   * EditorComponent as @HostListeners but were lifted into
   * EditorShortcutsDirective. These helpers instantiate the directive against
   * the live component's `shortcutsApi` so the existing assertions still
   * exercise the end-to-end reaction chain.
   */
  function makeShortcutDirective(): EditorShortcutsDirective {
    const injector = TestBed.inject(EnvironmentInjector);
    const dir = runInInjectionContext(injector, () => new EditorShortcutsDirective());
    Object.defineProperty(dir, 'api', { value: () => cmp.shortcutsApi });
    return dir;
  }
  function dispatchShortcut(ev: KeyboardEvent): void {
    makeShortcutDirective().onGlobalKey(ev);
  }
  function dispatchBlur(): void {
    makeShortcutDirective().onWindowBlur();
  }

  // ── Helpers: isTextual, hasTextField ─────

  it('isTextual returns true only for text/heading/link/button', () => {
    expect(cmp.isTextual('text')).toBe(true);
    expect(cmp.isTextual('heading')).toBe(true);
    expect(cmp.isTextual('link')).toBe(true);
    expect(cmp.isTextual('button')).toBe(true);
    expect(cmp.isTextual('rect')).toBe(false);
    expect(cmp.isTextual('divider')).toBe(false);
    expect(cmp.isTextual('image')).toBe(false);
    expect(cmp.isTextual('checkbox')).toBe(false);
  });

  it('hasTextField excludes divider/image/rect/checkbox/toggle/charts/phone', () => {
    expect(cmp.hasTextField('divider')).toBe(false);
    expect(cmp.hasTextField('image')).toBe(false);
    expect(cmp.hasTextField('rect')).toBe(false);
    expect(cmp.hasTextField('checkbox')).toBe(false);
    expect(cmp.hasTextField('toggle')).toBe(false);
    expect(cmp.hasTextField('bar-chart')).toBe(false);
    expect(cmp.hasTextField('donut')).toBe(false);
    expect(cmp.hasTextField('phone-frame')).toBe(false);
    expect(cmp.hasTextField('text')).toBe(true);
    expect(cmp.hasTextField('heading')).toBe(true);
    expect(cmp.hasTextField('link')).toBe(true);
    expect(cmp.hasTextField('button')).toBe(true);
    expect(cmp.hasTextField('tag')).toBe(true);
    expect(cmp.hasTextField('card')).toBe(true);
  });

  it('iconForType resolves known icons (via layers-panel util)', () => {
    expect(iconForType('heading')).toBe('heading-1');
    expect(iconForType('link')).toBe('link');
    expect(iconForType('button')).toBe('mouse-pointer-2');
    expect(iconForType('rect')).toBe('square');
  });

  it('labelForElement uses text when present, otherwise palette label', () => {
    expect(labelForElement(makeEl({ id: 'a', type: 'heading', text: 'Hi' }))).toBe('Hi');
    expect(labelForElement(makeEl({ id: 'a', type: 'heading' }))).toBe('Heading');
    expect(labelForElement(makeEl({ id: 'a', type: 'link' }))).toBe('Link');
  });

  // ── Heading level ─────────────────────────────────────────────────

  it('setHeadingLevel ignores NaN and out-of-range values', async () => {
    const heading = makeEl({ id: 'h1', type: 'heading', level: 1 });
    cmp.elements.set([heading]);
    cmp.selectedId.set('h1');
    await editorSvc.setHeadingLevel('t1', 'p1', 'abc');
    expect(collab.sendEdit).not.toHaveBeenCalled();
    await editorSvc.setHeadingLevel('t1', 'p1', '0');
    await editorSvc.setHeadingLevel('t1', 'p1', '7');
    expect(collab.sendEdit).not.toHaveBeenCalled();
    await editorSvc.setHeadingLevel('t1', 'p1', '3');
    expect(collab.sendEdit).toHaveBeenCalledWith('h1', { level: 3 });
    const updated = cmp.elements().find((e) => e.id === 'h1')!;
    expect(updated.level).toBe(3);
  });

  // ── Divider orientation ───────────────────────────────────────────

  it('dividerOrientation: variant="v" → "v", else "h"', () => {
    expect(cmp.dividerOrientation(makeEl({ id: 'd', type: 'divider' }))).toBe('h');
    expect(cmp.dividerOrientation(makeEl({ id: 'd', type: 'divider', variant: 'h' }))).toBe('h');
    expect(cmp.dividerOrientation(makeEl({ id: 'd', type: 'divider', variant: 'v' }))).toBe('v');
  });

  it('handleDirsFor restricts divider handles, returns all for other types', () => {
    expect(cmp.handleDirsFor(makeEl({ id: 'd', type: 'divider', variant: 'h' }))).toEqual([
      'e',
      'w',
    ]);
    expect(cmp.handleDirsFor(makeEl({ id: 'd', type: 'divider', variant: 'v' }))).toEqual([
      'n',
      's',
    ]);
    expect(cmp.handleDirsFor(makeEl({ id: 'r', type: 'rect' })).length).toBe(8);
  });

  // ── Button variant ────────────────────────────────────────────────

  it('buttonVariantOf returns primary/secondary/tertiary', () => {
    expect(cmp.buttonVariantOf(makeEl({ id: 'b', type: 'button' }))).toBe('primary');
    expect(cmp.buttonVariantOf(makeEl({ id: 'b', type: 'button', variant: 'secondary' }))).toBe(
      'secondary',
    );
    expect(cmp.buttonVariantOf(makeEl({ id: 'b', type: 'button', variant: 'tertiary' }))).toBe(
      'tertiary',
    );
    expect(cmp.buttonVariantOf(makeEl({ id: 'b', type: 'button', variant: 'garbage' }))).toBe(
      'primary',
    );
  });

  // ── Color setter / clearer ────────────────────────────────────────

  it('setColor stores a trimmed, lowercased hex value', async () => {
    const el = makeEl({ id: 't1', type: 'text' });
    cmp.elements.set([el]);
    cmp.selectedId.set('t1');
    await editorSvc.setColor('t1', 'p1', '  #FF00AA  ');
    expect(collab.sendEdit).toHaveBeenCalledWith('t1', { color: '#ff00aa' });
    const updated = cmp.elements().find((e) => e.id === 't1')!;
    expect(updated.color).toBe('#ff00aa');
  });

  it('setColor rejects invalid hex values (no commit)', async () => {
    const el = makeEl({ id: 't1', type: 'text' });
    cmp.elements.set([el]);
    cmp.selectedId.set('t1');
    collab.sendEdit.calls.reset();
    await editorSvc.setColor('t1', 'p1', 'not-a-color');
    await editorSvc.setColor('t1', 'p1', '#zzz');
    await editorSvc.setColor('t1', 'p1', '#12345'); // 5 chars — invalid
    await editorSvc.setColor('t1', 'p1', 'red'); // named color — not hex
    expect(collab.sendEdit).not.toHaveBeenCalled();
    expect(projects.upsertElement).not.toHaveBeenCalled();
  });

  it('setColor with empty value delegates to clearColor (forwarded as sendDeleteFields)', async () => {
    const el = makeEl({ id: 't1', type: 'text', color: '#123456' });
    cmp.elements.set([el]);
    cmp.selectedId.set('t1');
    await editorSvc.setColor('t1', 'p1', '');
    expect(collab.sendDeleteFields).toHaveBeenCalledWith('t1', ['color']);
    const after = cmp.elements().find((e) => e.id === 't1');
    expect(after?.color).toBeUndefined();
  });

  it('clearColor removes color from optimistic state and routes through sendDeleteFields', () => {
    const el = makeEl({ id: 't1', type: 'text', color: '#123456' });
    cmp.elements.set([el]);
    cmp.selectedId.set('t1');
    void editorSvc.clearColor('t1', 'p1');
    const after = cmp.elements().find((e) => e.id === 't1');
    expect(after?.color).toBeUndefined();
    expect(collab.sendDeleteFields).toHaveBeenCalledWith('t1', ['color']);
  });

  // ── Layer drag drop reorder ───────────────────────────────────────

  it('reorderLayer: "above" puts source above target (higher zIndex) after normalize', async () => {
    const els = [
      makeEl({ id: 'a', type: 'rect', zIndex: 1 }),
      makeEl({ id: 'b', type: 'rect', zIndex: 2 }),
      makeEl({ id: 'c', type: 'rect', zIndex: 3 }),
    ];
    cmp.elements.set(els);
    await cmp.reorderLayer('a', 'c', 'above');
    const byId = new Map(cmp.elements().map((e) => [e.id, e.zIndex]));
    expect(byId.get('a')!).toBeGreaterThan(byId.get('c')!);
    expect(Array.from(byId.values()).sort((x, y) => x - y)).toEqual([1, 2, 3]);
    expect(collab.sendEdit).toHaveBeenCalled();
  });

  it('reorderLayer: "below" puts source below target (lower zIndex) after normalize', async () => {
    cmp.elements.set([
      makeEl({ id: 'a', type: 'rect', zIndex: 1 }),
      makeEl({ id: 'b', type: 'rect', zIndex: 2 }),
      makeEl({ id: 'c', type: 'rect', zIndex: 3 }),
    ]);
    await cmp.reorderLayer('c', 'a', 'below');
    const byId = new Map(cmp.elements().map((e) => [e.id, e.zIndex]));
    expect(byId.get('c')!).toBeLessThan(byId.get('a')!);
  });

  it('reorderLayer: no-op when fromId === toId', async () => {
    cmp.elements.set([makeEl({ id: 'a', type: 'rect', zIndex: 1 })]);
    await cmp.reorderLayer('a', 'a', 'above');
    expect(projects.patchElements).not.toHaveBeenCalled();
  });

  it('onLayerReorder delegates to reorderLayer', async () => {
    const a = makeEl({ id: 'a', type: 'rect', zIndex: 1 });
    const b = makeEl({ id: 'b', type: 'rect', zIndex: 2 });
    cmp.elements.set([a, b]);
    await cmp.onLayerReorder({ fromId: 'a', toId: 'b', position: 'below' });
    expect(collab.sendEdit).toHaveBeenCalled();
  });

  // ── Inline edit ────────────────────────────────────────────────────

  it('onInlineEditDblClick enters edit mode for textual types', () => {
    const el = makeEl({ id: 't1', type: 'text', text: 'Hello' });
    cmp.elements.set([el]);
    const ev = new MouseEvent('dblclick');
    spyOn(ev, 'stopPropagation');
    spyOn(ev, 'preventDefault');
    cmp.onInlineEditDblClick(ev, el);
    expect(cmp.editingId()).toBe('t1');
    expect(cmp.selectedId()).toBe('t1');
  });

  it('onInlineEditDblClick ignores locked elements', () => {
    const el = makeEl({ id: 't1', type: 'text', locked: true });
    cmp.onInlineEditDblClick(new MouseEvent('dblclick'), el);
    expect(cmp.editingId()).toBeNull();
  });

  it('onInlineEditDblClick ignores non-textual elements', () => {
    const el = makeEl({ id: 'r1', type: 'rect' });
    cmp.onInlineEditDblClick(new MouseEvent('dblclick'), el);
    expect(cmp.editingId()).toBeNull();
  });

  // Inline-edit keydown/blur dispatch lives in the canvas-element components
  // (ElTextComponent et al.) and is covered by canvas-elements.spec.

  // ── Keyboard shortcuts: inField guard ────────────────────────────

  it('onGlobalKey: returns early when target is contentEditable', () => {
    const el = makeEl({ id: 'sel', type: 'text' });
    cmp.elements.set([el]);
    cmp.selectedId.set('sel');
    const host = document.createElement('span');
    host.setAttribute('contenteditable', 'true');
    const ev = new KeyboardEvent('keydown', { key: 'c', metaKey: true });
    Object.defineProperty(ev, 'target', { value: host });
    spyOn(ev, 'preventDefault');
    dispatchShortcut(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('onGlobalKey: returns early when target is INPUT', () => {
    const el = makeEl({ id: 'sel', type: 'text' });
    cmp.elements.set([el]);
    cmp.selectedId.set('sel');
    const host = document.createElement('input');
    const ev = new KeyboardEvent('keydown', { key: 'Backspace' });
    Object.defineProperty(ev, 'target', { value: host });
    spyOn(ev, 'preventDefault');
    dispatchShortcut(ev);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('onGlobalKey: Escape clears selection and context menu', () => {
    cmp.selectedId.set('foo');
    cmp.contextMenu.set({ x: 0, y: 0, elId: 'foo' });
    const ev = new KeyboardEvent('keydown', { key: 'Escape' });
    Object.defineProperty(ev, 'target', { value: document.body });
    dispatchShortcut(ev);
    expect(cmp.selectedId()).toBeNull();
    expect(cmp.contextMenu()).toBeNull();
  });

  it('onGlobalKey: Delete deletes selected non-locked element', async () => {
    const el = makeEl({ id: 'd1', type: 'rect' });
    cmp.elements.set([el]);
    cmp.selectedId.set('d1');
    const ev = new KeyboardEvent('keydown', { key: 'Delete' });
    Object.defineProperty(ev, 'target', { value: document.body });
    spyOn(ev, 'preventDefault');
    dispatchShortcut(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    await Promise.resolve();
    expect(collab.sendDelete).toHaveBeenCalledWith('d1');
  });

  it('deleteSelected is a no-op on locked elements', async () => {
    const el = makeEl({ id: 'x1', type: 'rect', locked: true });
    cmp.elements.set([el]);
    cmp.selectedId.set('x1');
    await cmp.deleteSelected();
    expect(collab.sendDelete).not.toHaveBeenCalled();
    expect(cmp.elements().find((e) => e.id === 'x1')).toBeTruthy();
  });

  // ── Collab echo: drag guard ─────────────────────────────────────

  it('remote edit does not overwrite local state during drag', () => {
    const el = makeEl({ id: 'z1', type: 'rect', x: 10, y: 10 });
    cmp.elements.set([el]);
    fakeDrag('z1');
    collab.lastRemoteEdit.set({ elementId: 'z1', patch: { x: 999 }, from: 'other' });
    fixture.detectChanges();
    expect(cmp.elements().find((e) => e.id === 'z1')?.x).toBe(10);
  });

  it('remote edit applies when element not currently dragging', () => {
    const el = makeEl({ id: 'z1', type: 'rect', x: 10, y: 10 });
    cmp.elements.set([el]);
    drr.cancel();
    collab.lastRemoteEdit.set({ elementId: 'z1', patch: { x: 999 }, from: 'other' });
    fixture.detectChanges();
    expect(cmp.elements().find((e) => e.id === 'z1')?.x).toBe(999);
  });

  it('remote text edit skipped while locally editing that element', () => {
    const el = makeEl({ id: 't1', type: 'text', text: 'Local' });
    cmp.elements.set([el]);
    cmp.editingId.set('t1');
    collab.lastRemoteEdit.set({ elementId: 't1', patch: { text: 'Remote' }, from: 'other' });
    fixture.detectChanges();
    expect(cmp.elements().find((e) => e.id === 't1')?.text).toBe('Local');
  });

  // ── Context menu & layer ops ─────────────────────────────────────

  it('openContextMenu selects element and stores coordinates', () => {
    const el = makeEl({ id: 'c1', type: 'rect' });
    cmp.elements.set([el]);
    const ev = new MouseEvent('contextmenu', { clientX: 120, clientY: 240 });
    spyOn(ev, 'preventDefault');
    spyOn(ev, 'stopPropagation');
    cmp.openContextMenu(ev, el);
    expect(cmp.selectedId()).toBe('c1');
    expect(cmp.contextMenu()).toEqual({ x: 120, y: 240, elId: 'c1' });
  });

  it('bringToFront sets selected zIndex to max+1', async () => {
    cmp.elements.set([
      makeEl({ id: 'a', type: 'rect', zIndex: 1 }),
      makeEl({ id: 'b', type: 'rect', zIndex: 5 }),
      makeEl({ id: 'c', type: 'rect', zIndex: 3 }),
    ]);
    cmp.selectedId.set('a');
    await cmp.bringToFront();
    expect(cmp.elements().find((e) => e.id === 'a')?.zIndex).toBe(6);
  });

  it('sendToBack places selected below the lowest zIndex', async () => {
    cmp.elements.set([
      makeEl({ id: 'a', type: 'rect', zIndex: 1 }),
      makeEl({ id: 'b', type: 'rect', zIndex: 5 }),
    ]);
    cmp.selectedId.set('b');
    await cmp.sendToBack();
    const a = cmp.elements().find((e) => e.id === 'a')!;
    const b = cmp.elements().find((e) => e.id === 'b')!;
    expect(b.zIndex).toBeLessThan(a.zIndex);
  });

  it('toggleLock flips locked flag', async () => {
    cmp.elements.set([makeEl({ id: 'a', type: 'rect', locked: false })]);
    cmp.selectedId.set('a');
    await cmp.toggleLock();
    const after = cmp.elements().find((e) => e.id === 'a');
    expect(after?.locked).toBe(true);
  });

  // ── Palette click: viewport center ───────────────────────────────

  it('onPaletteClick uses fallback position when board is not measurable', async () => {
    cmp.activePageId.set('pg1');
    cmp.elements.set([]);
    await cmp.onPaletteClick(itemOf('rect'));
    expect(collab.sendEdit).toHaveBeenCalled();
    const appended = cmp.elements()[cmp.elements().length - 1];
    expect(appended.type).toBe('rect');
    expect(appended.pageId).toBe('pg1');
  });

  it('onPaletteClick initializes heading level=1, divider variant=h, button variant=primary', async () => {
    cmp.activePageId.set('pg1');
    await cmp.onPaletteClick(itemOf('heading'));
    const els1 = cmp.elements();
    expect(els1[els1.length - 1].level).toBe(1);

    await cmp.onPaletteClick(itemOf('divider'));
    const els2 = cmp.elements();
    expect(els2[els2.length - 1].variant).toBe('h');

    await cmp.onPaletteClick(itemOf('button'));
    const els3 = cmp.elements();
    expect(els3[els3.length - 1].variant).toBe('primary');
  });

  // ── updateSelected ─────────────────────────────────────────────

  it('updateSelected merges patch into local state and broadcasts via collab (no direct upsert)', () => {
    const el = makeEl({ id: 's1', type: 'rect', x: 0 });
    cmp.elements.set([el]);
    cmp.selectedId.set('s1');
    editorSvc.updateSelected('t1', 'p1', { x: 42 } as Patch);
    const updated = cmp.elements().find((e) => e.id === 's1')!;
    expect(updated.x).toBe(42);
    expect(collab.sendEdit).toHaveBeenCalledWith('s1', { x: 42 });
    expect(collab.flushPendingEdits).toHaveBeenCalled();
    expect(projects.upsertElement).not.toHaveBeenCalled();
  });

  it('updateSelected is a no-op when nothing selected', () => {
    cmp.selectedId.set(null);
    editorSvc.updateSelected('t1', 'p1', { x: 1 });
    expect(collab.sendEdit).not.toHaveBeenCalled();
    expect(collab.flushPendingEdits).not.toHaveBeenCalled();
  });

  // ── Paste: uses activePageId (not project id) ────────────────────

  it('pasteClipboard uses current activePageId for the pasted copy', async () => {
    cmp.activePageId.set('pageX');
    const src = makeEl({ id: 'src', type: 'rect', pageId: 'other' });
    cmp.elements.set([src]);
    cmp.selectedId.set('src');
    cmp.copySelected();
    await cmp.pasteClipboard();
    const appended = cmp.elements()[cmp.elements().length - 1];
    expect(appended.pageId).toBe('pageX');
    expect(appended.id).not.toBe('src');
    expect(collab.sendEdit).toHaveBeenCalled();
  });

  // ── Round 2 fixes ─────────────────────────────────────────────

  it('remote edit with color:null deletes the color field (not store literal null)', () => {
    const el = makeEl({ id: 'r1', type: 'heading', color: '#ff0000' });
    cmp.elements.set([el]);
    collab.lastRemoteEdit.set({ elementId: 'r1', patch: { color: null } });
    // Trigger the effect.
    fixture.detectChanges();
    const after = cmp.elements().find((e) => e.id === 'r1')!;
    expect(after.color).toBeUndefined();
    expect('color' in (after as unknown as Record<string, unknown>)).toBe(false);
  });

  it('bringToFront uses Math.max and works when all zIndexes are negative', async () => {
    const a = makeEl({ id: 'a', type: 'rect', zIndex: -3 });
    const b = makeEl({ id: 'b', type: 'rect', zIndex: -1 });
    cmp.elements.set([a, b]);
    cmp.selectedId.set('a');
    await cmp.bringToFront();
    const [, patch] = collab.sendEdit.calls.mostRecent().args as [string, Partial<IWireElement>];
    expect(patch.zIndex).toBe(0); // max(-3, -1) + 1 = 0
  });

  it('sendToBack uses Math.min and goes below negative minimum', async () => {
    const a = makeEl({ id: 'a', type: 'rect', zIndex: -3 });
    const b = makeEl({ id: 'b', type: 'rect', zIndex: -1 });
    cmp.elements.set([a, b]);
    cmp.selectedId.set('b');
    await cmp.sendToBack();
    const [, patch] = collab.sendEdit.calls.mostRecent().args as [string, Partial<IWireElement>];
    expect(patch.zIndex).toBe(-4); // min(-3, -1) - 1 = -4
  });

  it('reorderLayer fans out one sendEdit per changed element and flushes', async () => {
    const a = makeEl({ id: 'a', type: 'rect', zIndex: 1 });
    const b = makeEl({ id: 'b', type: 'rect', zIndex: 2 });
    const c = makeEl({ id: 'c', type: 'rect', zIndex: 3 });
    cmp.elements.set([a, b, c]);
    await cmp.reorderLayer('a', 'c', 'above');
    const ids = collab.sendEdit.calls
      .allArgs()
      .map((x) => x[0] as string)
      .sort();
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(collab.flushPendingEdits).toHaveBeenCalled();
  });

  it('onPaletteDragEnd clears the pendingDropType so a later drop cannot reuse it', async () => {
    const dt = new DataTransfer();
    const dragEvent = new DragEvent('dragstart', { dataTransfer: dt }) as DragEvent;
    cmp.onPaletteDragStart({ item: itemOf('rect'), ev: dragEvent });
    cmp.onPaletteDragEnd();
    // Internal state is private — probe via a subsequent drop with empty dataTransfer.
    const emptyDt = new DataTransfer();
    const dropEvent = new DragEvent('drop', {
      dataTransfer: emptyDt,
      clientX: 10,
      clientY: 10,
    }) as DragEvent;
    cmp.activePageId.set('pg1');
    await cmp.onCanvasDrop(dropEvent);
    // No upsert should have fired because both getData and pendingDropType are empty.
    expect(collab.sendEdit).not.toHaveBeenCalled();
  });

  it('onCanvasDrop ignores invalid types that do not map to a palette entry', async () => {
    const dt = new DataTransfer();
    dt.setData('text/mocktail-element', 'not-a-real-type');
    const dropEvent = new DragEvent('drop', {
      dataTransfer: dt,
      clientX: 10,
      clientY: 10,
    }) as DragEvent;
    cmp.activePageId.set('pg1');
    await cmp.onCanvasDrop(dropEvent);
    expect(collab.sendEdit).not.toHaveBeenCalled();
  });

  it('onGlobalKey skips shortcuts while inline editing even if focus is on document', () => {
    cmp.editingId.set('anything');
    spyOn(cmp, 'deleteSelected');
    const ev = new KeyboardEvent('keydown', { key: 'Delete' });
    Object.defineProperty(ev, 'target', { value: document.body });
    dispatchShortcut(ev);
    expect(cmp.deleteSelected).not.toHaveBeenCalled();
  });

  it('onCanvasPointerUp aborts drag flush when active page changed mid-drag', () => {
    const el = makeEl({ id: 'x1', type: 'rect', pageId: 'pg1' });
    cmp.elements.set([el]);
    cmp.activePageId.set('pg1');
    fakeDrag('x1', 'pg1', 't1', 'p1');
    cmp.activePageId.set('pg2');
    collab.flushPendingEdits.calls.reset();
    cmp.onCanvasPointerUp();
    expect(collab.flushPendingEdits).not.toHaveBeenCalled();
  });

  it('onCanvasPointerUp aborts resize flush when project changed mid-resize', () => {
    const el = makeEl({ id: 'x1', type: 'rect', pageId: 'pg1' });
    cmp.elements.set([el]);
    cmp.activePageId.set('pg1');
    fakeResize('x1', 'pg1', 't1', 'p1');
    cmp.pid.set('p-different');
    collab.flushPendingEdits.calls.reset();
    cmp.onCanvasPointerUp();
    expect(collab.flushPendingEdits).not.toHaveBeenCalled();
  });

  it('onCanvasPointerUp flushes pending edits when drag ends with matching context', () => {
    const el = makeEl({ id: 'x1', type: 'rect', pageId: 'pg1' });
    cmp.elements.set([el]);
    cmp.activePageId.set('pg1');
    fakeDrag('x1', 'pg1', 't-captured', 'p-captured');
    cmp.tid.set('t-captured');
    cmp.pid.set('p-captured');
    collab.flushPendingEdits.calls.reset();
    cmp.onCanvasPointerUp();
    expect(collab.flushPendingEdits).toHaveBeenCalledTimes(1);
  });

  it('setActivePage clears drag/resize/rotate when switching pages', () => {
    fakeDrag('x', 'a');
    cmp.activePageId.set('a');
    fixture.detectChanges();
    cmp.setActivePage('b');
    fixture.detectChanges();
    expect(drr.drag).toBeNull();
  });

  it('onCanvasPointerCancel clears drag/resize/rotate state', () => {
    fakeDrag('x');
    cmp.onCanvasPointerCancel();
    expect(drr.drag).toBeNull();
  });

  it('onWindowBlur clears drag state to prevent stuck pointer', () => {
    fakeDrag('x');
    dispatchBlur();
    expect(drr.drag).toBeNull();
  });
});
