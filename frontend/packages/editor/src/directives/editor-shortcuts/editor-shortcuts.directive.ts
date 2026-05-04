import { Directive, HostListener, input } from '@angular/core';

/**
 * Contract surface the directive needs from its host component to implement
 * the editor-wide keyboard + window-blur shortcuts. Keeping this as a small
 * interface (rather than injecting the component directly) lets us unit-test
 * the directive without spinning up the full editor.
 */
export interface IEditorShortcutsApi {
  isEditing(): boolean;
  canPaste(): boolean;
  hasSelection(): boolean;
  selectionCount(): number;
  commentMode(): boolean;
  toggleLeft(): void;
  toggleRight(): void;
  toggleGrid(): void;
  copySelected(): void;
  pasteClipboard(): void | Promise<void>;
  duplicateSelected(): void | Promise<void>;
  deleteSelected(): void | Promise<void>;
  cancelInteractions(): void;
  clearSelection(): void;
  closeCommentPin(): void;
  toggleCommentMode(): void;
  closeContextMenu(): void;
}

/**
 * Listens at the document/window level for the editor's global keyboard
 * shortcuts and pointer-cancel signal. The directive owns no state — every
 * reaction is delegated back to the host component via the IEditorShortcutsApi
 * passed in through the `mkEditorShortcuts` input.
 */
@Directive({
  selector: '[mkEditorShortcuts]',
  standalone: true,
})
export class EditorShortcutsDirective {
  public readonly api = input.required<IEditorShortcutsApi>({ alias: 'mkEditorShortcuts' });

  @HostListener('window:blur')
  public onWindowBlur(): void {
    this.api().cancelInteractions();
  }

  @HostListener('document:keydown', ['$event'])
  public onGlobalKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    const inField =
      !!target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable === true);
    if (inField) return;
    const api = this.api();
    if (api.isEditing()) return;
    const meta = ev.metaKey || ev.ctrlKey;
    const key = ev.key.toLowerCase();
    if (meta && (ev.key === '\\' || key === 'b')) {
      ev.preventDefault();
      api.toggleLeft();
    } else if (meta && (ev.key === ']' || key === 'i')) {
      ev.preventDefault();
      api.toggleRight();
    } else if (meta && ev.key === "'") {
      ev.preventDefault();
      api.toggleGrid();
    } else if (meta && key === 'c') {
      if (api.hasSelection()) {
        ev.preventDefault();
        api.copySelected();
      }
    } else if (meta && key === 'v') {
      if (api.canPaste()) {
        ev.preventDefault();
        void api.pasteClipboard();
      }
    } else if (meta && key === 'd') {
      if (api.hasSelection()) {
        ev.preventDefault();
        void api.duplicateSelected();
      }
    } else if (!meta && (ev.key === 'Delete' || ev.key === 'Backspace')) {
      if (api.selectionCount() > 0) {
        ev.preventDefault();
        void api.deleteSelected();
      }
    } else if (!meta && ev.key === 'Escape') {
      api.clearSelection();
      api.closeCommentPin();
      if (api.commentMode()) api.toggleCommentMode();
      api.closeContextMenu();
    }
  }
}
