import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EditorShortcutsDirective, IEditorShortcutsApi } from './editor-shortcuts.directive';

interface ApiSpies {
  isEditing: jasmine.Spy<() => boolean>;
  canPaste: jasmine.Spy<() => boolean>;
  hasSelection: jasmine.Spy<() => boolean>;
  selectionCount: jasmine.Spy<() => number>;
  commentMode: jasmine.Spy<() => boolean>;
  toggleLeft: jasmine.Spy<() => void>;
  toggleRight: jasmine.Spy<() => void>;
  toggleGrid: jasmine.Spy<() => void>;
  copySelected: jasmine.Spy<() => void>;
  pasteClipboard: jasmine.Spy<() => void>;
  duplicateSelected: jasmine.Spy<() => void>;
  deleteSelected: jasmine.Spy<() => void>;
  cancelInteractions: jasmine.Spy<() => void>;
  clearSelection: jasmine.Spy<() => void>;
  closeCommentPin: jasmine.Spy<() => void>;
  toggleCommentMode: jasmine.Spy<() => void>;
  closeContextMenu: jasmine.Spy<() => void>;
}

function makeApi(overrides: Partial<{ [K in keyof ApiSpies]: ReturnType<ApiSpies[K]> }> = {}): {
  api: IEditorShortcutsApi;
  spies: ApiSpies;
} {
  const spies: ApiSpies = {
    isEditing: jasmine.createSpy('isEditing').and.returnValue(overrides.isEditing ?? false),
    canPaste: jasmine.createSpy('canPaste').and.returnValue(overrides.canPaste ?? false),
    hasSelection: jasmine
      .createSpy('hasSelection')
      .and.returnValue(overrides.hasSelection ?? false),
    selectionCount: jasmine
      .createSpy('selectionCount')
      .and.returnValue(overrides.selectionCount ?? 0),
    commentMode: jasmine.createSpy('commentMode').and.returnValue(overrides.commentMode ?? false),
    toggleLeft: jasmine.createSpy('toggleLeft'),
    toggleRight: jasmine.createSpy('toggleRight'),
    toggleGrid: jasmine.createSpy('toggleGrid'),
    copySelected: jasmine.createSpy('copySelected'),
    pasteClipboard: jasmine.createSpy('pasteClipboard'),
    duplicateSelected: jasmine.createSpy('duplicateSelected'),
    deleteSelected: jasmine.createSpy('deleteSelected'),
    cancelInteractions: jasmine.createSpy('cancelInteractions'),
    clearSelection: jasmine.createSpy('clearSelection'),
    closeCommentPin: jasmine.createSpy('closeCommentPin'),
    toggleCommentMode: jasmine.createSpy('toggleCommentMode'),
    closeContextMenu: jasmine.createSpy('closeContextMenu'),
  };
  const api: IEditorShortcutsApi = {
    isEditing: () => spies.isEditing(),
    canPaste: () => spies.canPaste(),
    hasSelection: () => spies.hasSelection(),
    selectionCount: () => spies.selectionCount(),
    commentMode: () => spies.commentMode(),
    toggleLeft: () => spies.toggleLeft(),
    toggleRight: () => spies.toggleRight(),
    toggleGrid: () => spies.toggleGrid(),
    copySelected: () => spies.copySelected(),
    pasteClipboard: () => spies.pasteClipboard(),
    duplicateSelected: () => spies.duplicateSelected(),
    deleteSelected: () => spies.deleteSelected(),
    cancelInteractions: () => spies.cancelInteractions(),
    clearSelection: () => spies.clearSelection(),
    closeCommentPin: () => spies.closeCommentPin(),
    toggleCommentMode: () => spies.toggleCommentMode(),
    closeContextMenu: () => spies.closeContextMenu(),
  };
  return { api, spies };
}

@Component({
  standalone: true,
  imports: [EditorShortcutsDirective],
  template: `<div [mkEditorShortcuts]="api()"></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HostComponent {
  public readonly api = signal<IEditorShortcutsApi>({
    isEditing: () => false,
    canPaste: () => false,
    hasSelection: () => false,
    selectionCount: () => 0,
    commentMode: () => false,
    toggleLeft: () => undefined,
    toggleRight: () => undefined,
    toggleGrid: () => undefined,
    copySelected: () => undefined,
    pasteClipboard: () => undefined,
    duplicateSelected: () => undefined,
    deleteSelected: () => undefined,
    cancelInteractions: () => undefined,
    clearSelection: () => undefined,
    closeCommentPin: () => undefined,
    toggleCommentMode: () => undefined,
    closeContextMenu: () => undefined,
  });
}

/**
 * The directive attaches its listeners at `document:keydown` and `window:blur`
 * scope via @HostListener. We exercise those paths end-to-end through the host
 * component so the listener wiring itself is under test, and we use direct
 * method calls for fine-grained guard assertions.
 */
describe('EditorShortcutsDirective', () => {
  function setup(apiArg?: IEditorShortcutsApi): {
    directive: EditorShortcutsDirective;
    hostEl: HTMLElement;
    destroy: () => void;
  } {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    if (apiArg) fixture.componentInstance.api.set(apiArg);
    fixture.detectChanges();
    const dirDebug = fixture.debugElement.children[0];
    const directive = dirDebug.injector.get(EditorShortcutsDirective);
    return {
      directive,
      hostEl: dirDebug.nativeElement as HTMLElement,
      destroy: () => fixture.destroy(),
    };
  }

  function keydown(init: KeyboardEventInit & { target?: EventTarget }): KeyboardEvent {
    const ev = new KeyboardEvent('keydown', init);
    if (init.target) Object.defineProperty(ev, 'target', { value: init.target });
    spyOn(ev, 'preventDefault').and.callThrough();
    return ev;
  }

  // ── Modifier-based shortcuts ────────────────────────────────────────

  it('Meta+\\ calls toggleLeft and preventDefault', () => {
    const { api, spies } = makeApi();
    const { directive } = setup(api);
    const ev = keydown({ key: '\\', metaKey: true, target: document.body });
    directive.onGlobalKey(ev);
    expect(spies.toggleLeft).toHaveBeenCalled();
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('Ctrl+b (lowercase) calls toggleLeft', () => {
    const { api, spies } = makeApi();
    const { directive } = setup(api);
    directive.onGlobalKey(keydown({ key: 'b', ctrlKey: true, target: document.body }));
    expect(spies.toggleLeft).toHaveBeenCalled();
  });

  it('Meta+B (uppercase) is case-insensitive for toggleLeft', () => {
    const { api, spies } = makeApi();
    const { directive } = setup(api);
    directive.onGlobalKey(keydown({ key: 'B', metaKey: true, target: document.body }));
    expect(spies.toggleLeft).toHaveBeenCalled();
  });

  it('Meta+] calls toggleRight', () => {
    const { api, spies } = makeApi();
    const { directive } = setup(api);
    directive.onGlobalKey(keydown({ key: ']', metaKey: true, target: document.body }));
    expect(spies.toggleRight).toHaveBeenCalled();
  });

  it('Meta+i calls toggleRight', () => {
    const { api, spies } = makeApi();
    const { directive } = setup(api);
    directive.onGlobalKey(keydown({ key: 'i', metaKey: true, target: document.body }));
    expect(spies.toggleRight).toHaveBeenCalled();
  });

  it("Meta+' calls toggleGrid", () => {
    const { api, spies } = makeApi();
    const { directive } = setup(api);
    directive.onGlobalKey(keydown({ key: "'", metaKey: true, target: document.body }));
    expect(spies.toggleGrid).toHaveBeenCalled();
  });

  it('Meta+c with selection calls copySelected', () => {
    const { api, spies } = makeApi({ hasSelection: true });
    const { directive } = setup(api);
    const ev = keydown({ key: 'c', metaKey: true, target: document.body });
    directive.onGlobalKey(ev);
    expect(spies.copySelected).toHaveBeenCalled();
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('Meta+c without selection is a no-op', () => {
    const { api, spies } = makeApi({ hasSelection: false });
    const { directive } = setup(api);
    const ev = keydown({ key: 'c', metaKey: true, target: document.body });
    directive.onGlobalKey(ev);
    expect(spies.copySelected).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('Meta+v with canPaste true calls pasteClipboard', () => {
    const { api, spies } = makeApi({ canPaste: true });
    const { directive } = setup(api);
    const ev = keydown({ key: 'v', metaKey: true, target: document.body });
    directive.onGlobalKey(ev);
    expect(spies.pasteClipboard).toHaveBeenCalled();
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('Meta+v without canPaste is a no-op', () => {
    const { api, spies } = makeApi({ canPaste: false });
    const { directive } = setup(api);
    const ev = keydown({ key: 'v', metaKey: true, target: document.body });
    directive.onGlobalKey(ev);
    expect(spies.pasteClipboard).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('Meta+d with selection calls duplicateSelected', () => {
    const { api, spies } = makeApi({ hasSelection: true });
    const { directive } = setup(api);
    const ev = keydown({ key: 'd', metaKey: true, target: document.body });
    directive.onGlobalKey(ev);
    expect(spies.duplicateSelected).toHaveBeenCalled();
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('Meta+d without selection is a no-op', () => {
    const { api, spies } = makeApi({ hasSelection: false });
    const { directive } = setup(api);
    const ev = keydown({ key: 'd', metaKey: true, target: document.body });
    directive.onGlobalKey(ev);
    expect(spies.duplicateSelected).not.toHaveBeenCalled();
  });

  // ── Non-meta shortcuts ──────────────────────────────────────────────

  it('Delete with selection calls deleteSelected', () => {
    const { api, spies } = makeApi({ selectionCount: 1 });
    const { directive } = setup(api);
    const ev = keydown({ key: 'Delete', target: document.body });
    directive.onGlobalKey(ev);
    expect(spies.deleteSelected).toHaveBeenCalled();
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('Backspace with selection calls deleteSelected', () => {
    const { api, spies } = makeApi({ selectionCount: 2 });
    const { directive } = setup(api);
    directive.onGlobalKey(keydown({ key: 'Backspace', target: document.body }));
    expect(spies.deleteSelected).toHaveBeenCalled();
  });

  it('Delete with no selection is a no-op', () => {
    const { api, spies } = makeApi({ selectionCount: 0 });
    const { directive } = setup(api);
    const ev = keydown({ key: 'Delete', target: document.body });
    directive.onGlobalKey(ev);
    expect(spies.deleteSelected).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('Meta+Delete does NOT trigger deleteSelected (meta guard)', () => {
    const { api, spies } = makeApi({ selectionCount: 1 });
    const { directive } = setup(api);
    directive.onGlobalKey(keydown({ key: 'Delete', metaKey: true, target: document.body }));
    expect(spies.deleteSelected).not.toHaveBeenCalled();
  });

  // ── Escape sequence ─────────────────────────────────────────────────

  it('Escape calls clearSelection -> closeCommentPin -> (no toggleMode when !commentMode) -> closeContextMenu in order', () => {
    const { api, spies } = makeApi({ commentMode: false });
    const { directive } = setup(api);
    const calls: string[] = [];
    spies.clearSelection.and.callFake(() => {
      calls.push('clearSelection');
    });
    spies.closeCommentPin.and.callFake(() => {
      calls.push('closeCommentPin');
    });
    spies.toggleCommentMode.and.callFake(() => {
      calls.push('toggleCommentMode');
    });
    spies.closeContextMenu.and.callFake(() => {
      calls.push('closeContextMenu');
    });
    directive.onGlobalKey(keydown({ key: 'Escape', target: document.body }));
    expect(calls).toEqual(['clearSelection', 'closeCommentPin', 'closeContextMenu']);
    expect(spies.toggleCommentMode).not.toHaveBeenCalled();
  });

  it('Escape invokes toggleCommentMode only when commentMode is active', () => {
    const { api, spies } = makeApi({ commentMode: true });
    const { directive } = setup(api);
    const calls: string[] = [];
    spies.clearSelection.and.callFake(() => calls.push('clearSelection'));
    spies.closeCommentPin.and.callFake(() => calls.push('closeCommentPin'));
    spies.toggleCommentMode.and.callFake(() => calls.push('toggleCommentMode'));
    spies.closeContextMenu.and.callFake(() => calls.push('closeContextMenu'));
    directive.onGlobalKey(keydown({ key: 'Escape', target: document.body }));
    expect(calls).toEqual([
      'clearSelection',
      'closeCommentPin',
      'toggleCommentMode',
      'closeContextMenu',
    ]);
  });

  it('Meta+Escape does NOT run escape sequence', () => {
    const { api, spies } = makeApi();
    const { directive } = setup(api);
    directive.onGlobalKey(keydown({ key: 'Escape', metaKey: true, target: document.body }));
    expect(spies.clearSelection).not.toHaveBeenCalled();
    expect(spies.closeContextMenu).not.toHaveBeenCalled();
  });

  // ── Field / editing guards ─────────────────────────────────────────

  it('skips all shortcuts when target is <input>', () => {
    const { api, spies } = makeApi({ hasSelection: true });
    const { directive } = setup(api);
    const input = document.createElement('input');
    directive.onGlobalKey(keydown({ key: 'c', metaKey: true, target: input }));
    expect(spies.copySelected).not.toHaveBeenCalled();
  });

  it('skips all shortcuts when target is <textarea>', () => {
    const { api, spies } = makeApi({ selectionCount: 1 });
    const { directive } = setup(api);
    const ta = document.createElement('textarea');
    directive.onGlobalKey(keydown({ key: 'Delete', target: ta }));
    expect(spies.deleteSelected).not.toHaveBeenCalled();
  });

  it('skips all shortcuts when target is contentEditable', () => {
    const { api, spies } = makeApi({ hasSelection: true });
    const { directive } = setup(api);
    const span = document.createElement('span');
    span.setAttribute('contenteditable', 'true');
    directive.onGlobalKey(keydown({ key: 'c', metaKey: true, target: span }));
    expect(spies.copySelected).not.toHaveBeenCalled();
  });

  it('skips all shortcuts when isEditing() returns true', () => {
    const { api, spies } = makeApi({ selectionCount: 1, isEditing: true });
    const { directive } = setup(api);
    directive.onGlobalKey(keydown({ key: 'Delete', target: document.body }));
    expect(spies.deleteSelected).not.toHaveBeenCalled();
  });

  // ── Window blur ─────────────────────────────────────────────────────

  it('window:blur dispatches cancelInteractions', () => {
    const { api, spies } = makeApi();
    const { destroy } = setup(api);
    window.dispatchEvent(new Event('blur'));
    expect(spies.cancelInteractions).toHaveBeenCalled();
    destroy();
  });

  it('onWindowBlur() method calls cancelInteractions directly', () => {
    const { api, spies } = makeApi();
    const { directive } = setup(api);
    directive.onWindowBlur();
    expect(spies.cancelInteractions).toHaveBeenCalled();
  });

  // ── Document keydown wiring ─────────────────────────────────────────

  it('document:keydown wiring triggers the host shortcut (Meta+\\ -> toggleLeft)', () => {
    const { api, spies } = makeApi();
    const { destroy } = setup(api);
    const ev = new KeyboardEvent('keydown', { key: '\\', metaKey: true, bubbles: true });
    document.dispatchEvent(ev);
    expect(spies.toggleLeft).toHaveBeenCalled();
    destroy();
  });
});
