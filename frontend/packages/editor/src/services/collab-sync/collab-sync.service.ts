import { Injectable, effect, inject, untracked } from '@angular/core';
import { CollabService, IRemoteEdit } from '@mocktail/collab';
import { CanvasGestureStore } from '../canvas-gesture/canvas-gesture.store';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorInlineEditService } from '../inline-edit/inline-edit.service';
import { applyRemotePatch } from './apply-remote-patch';

@Injectable()
export class EditorCollabSyncService {
  private readonly _collab = inject(CollabService);
  private readonly _state = inject(EditorElementsStateService);
  private readonly _inline = inject(EditorInlineEditService);
  private readonly _drr = inject(CanvasGestureStore);

  constructor() {
    effect(() => {
      const edit = this._collab.lastRemoteEdit();
      if (!edit || this._shouldSkip(edit)) return;
      untracked(() =>
        this._state.updateById(edit.elementId, (el) => applyRemotePatch(el, edit.patch)),
      );
    });

    effect(() => {
      const del = this._collab.lastRemoteDelete();
      if (!del) return;
      untracked(() => {
        this._state.list.update((els) => els.filter((e) => e.id !== del.elementId));
      });
    });

    effect(() => {
      const ev = this._collab.lastRemoteDeleteFields();
      if (!ev) return;
      untracked(() => {
        this._state.updateById(ev.elementId, (el) => {
          const next = { ...el } as Record<string, unknown>;
          for (const f of ev.fields) delete next[f];
          return next as unknown as typeof el;
        });
      });
    });
  }

  private _shouldSkip(edit: IRemoteEdit): boolean {
    return (
      this._drr.activeId() === edit.elementId ||
      (this._inline.editingId() === edit.elementId && 'text' in edit.patch)
    );
  }
}
