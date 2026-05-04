import { Injectable, inject, signal } from '@angular/core';
import { IWireElement } from '@mocktail/projects';
import { EditorElementFactoryService } from '../element-factory/element-factory.service';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { sanitizeInlineText } from './inline-edit';

@Injectable({ providedIn: 'root' })
export class EditorInlineEditService {
  private readonly _elsState = inject(EditorElementsStateService);
  private readonly _factory = inject(EditorElementFactoryService);

  public readonly editingId = signal<string | null>(null);

  public begin(id: string): void {
    this.editingId.set(id);
  }

  public stop(): void {
    this.editingId.set(null);
  }

  public isEditing(id: string): boolean {
    return this.editingId() === id;
  }

  public beginWithFocus(elId: string): void {
    this.begin(elId);
    setTimeout(() => {
      const host = document.querySelector<HTMLElement>(`[data-testid="inline-edit-${elId}"]`);
      if (host && host.isContentEditable) {
        host.focus();
        const r = document.createRange();
        r.selectNodeContents(host);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
      }
    }, 0);
  }

  public commit(
    host: HTMLElement,
    el: IWireElement,
    cancel: boolean,
    tid: string,
    pid: string,
  ): void {
    if (!this.isEditing(el.id)) return;
    const raw = cancel ? (el.text ?? '') : (host.innerText ?? '').replace(/\r\n/g, '\n');
    const text = sanitizeInlineText(raw);
    this.stop();
    if (cancel) {
      // Angular won't re-render identical bindings, so restore the DOM text
      // directly when the user bailed out mid-edit.
      host.innerText = el.text ?? this._factory.defaultTextFor(el.type) ?? '';
    } else if (text !== (el.text ?? '')) {
      void this._elsState.patch(tid, pid, el.id, { text });
    }
  }
}
