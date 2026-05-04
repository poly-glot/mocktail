import { Injectable, inject } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { IWireElement, ProjectApiService } from '@mocktail/projects';
import { EditorElementFactoryService } from '../element-factory/element-factory.service';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorSelectionService } from '../selection/selection.service';

/**
 * Owns mutation of the currently-selected element(s): shallow patches,
 * delete, duplicate, paste, and the two `color` operations (clearColor
 * removes the field rather than setting it to null). All Firestore writes
 * route through the Zig collab proxy, so this service only updates local
 * state and forwards intents — the proxy owns retry and durability.
 */
@Injectable({ providedIn: 'root' })
export class EditorElementEditorService {
  private readonly _state = inject(EditorElementsStateService);
  private readonly _sel = inject(EditorSelectionService);
  private readonly _factory = inject(EditorElementFactoryService);
  private readonly _projects = inject(ProjectApiService);
  private readonly _collab = inject(CollabService);

  private selected(): IWireElement | null {
    const id = this._sel.selectedId();
    if (!id) return null;
    return this._state.getById(id) ?? null;
  }

  public updateSelected(_tid: string, _pid: string, patch: Partial<IWireElement>): void {
    const sel = this.selected();
    if (!sel) return;
    const updated = { ...sel, ...patch } as IWireElement;
    this._state.list.update((els) => els.map((e) => (e.id === sel.id ? updated : e)));
    this._collab.sendEdit(sel.id, patch as Record<string, unknown>);
    this._collab.flushPendingEdits();
  }

  public async deleteSelected(tid: string, pid: string): Promise<void> {
    const ids = this._sel.allSelectedIdSet();
    if (ids.size === 0) return;
    const prev = this._state.list();
    const toDelete = prev.filter((e) => ids.has(e.id) && !e.locked);
    if (toDelete.length === 0) return;
    const deleteSet = new Set(toDelete.map((e) => e.id));
    this._state.list.update((els) => els.filter((e) => !deleteSet.has(e.id)));
    this._sel.setSelection(null, new Set());
    for (const e of toDelete) {
      this._collab.sendDelete(e.id);
    }
    const label =
      toDelete.length === 1 ? `deleted ${toDelete[0].type}` : `deleted ${toDelete.length} elements`;
    await this._projects.writeActivity(tid, pid, 'element-deleted', label);
  }

  public async duplicateSelected(_tid: string, _pid: string): Promise<string | null> {
    const sel = this.selected();
    if (!sel) return null;
    const copy = this._factory.cloneWithOffset(sel, 16, this._state.list());
    this._state.list.update((els) => [...els, copy]);
    this._collab.sendEdit(copy.id, this._fullElementPatch(copy));
    this._collab.flushPendingEdits();
    this._sel.setPrimary(copy.id);
    return copy.id;
  }

  public async paste(
    _tid: string,
    _pid: string,
    pageId: string,
    src: IWireElement,
  ): Promise<string> {
    const copy: IWireElement = {
      ...this._factory.cloneWithOffset(src, 16, this._state.list()),
      pageId,
    };
    this._state.list.update((els) => [...els, copy]);
    this._collab.sendEdit(copy.id, this._fullElementPatch(copy));
    this._collab.flushPendingEdits();
    this._sel.setPrimary(copy.id);
    return copy.id;
  }

  // Strip undefined keys so the wire payload is predictable — JSON.stringify
  // would drop them anyway, but explicit filtering keeps the contract clear.
  private _fullElementPatch(el: IWireElement): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  public async setHeadingLevel(tid: string, pid: string, raw: string): Promise<void> {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1 || n > 6) return;
    await this.updateSelected(tid, pid, { level: n as 1 | 2 | 3 | 4 | 5 | 6 });
  }

  public async setColor(tid: string, pid: string, value: string): Promise<void> {
    const v = (value ?? '').trim();
    if (!v) return this.clearColor(tid, pid);
    if (!/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return;
    await this.updateSelected(tid, pid, { color: v.toLowerCase() });
  }

  public async clearColor(_tid: string, _pid: string): Promise<void> {
    const sel = this.selected();
    if (!sel) return;
    const next: IWireElement = { ...sel };
    delete next.color;
    this._state.list.update((els) => els.map((e) => (e.id === sel.id ? next : e)));
    this._collab.sendDeleteFields(sel.id, ['color']);
  }
}
