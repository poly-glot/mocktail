import { Injectable, inject } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { HeadingLevel, IWireElement, ActivityRepository, toWirePatch } from '@mocktail/projects';
import { EditorElementFactoryService } from '../element-factory/element-factory.service';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorSelectionService } from '../selection/selection.service';

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

@Injectable({ providedIn: 'root' })
export class EditorElementEditorService {
  private readonly _state = inject(EditorElementsStateService);
  private readonly _sel = inject(EditorSelectionService);
  private readonly _factory = inject(EditorElementFactoryService);
  private readonly _activity = inject(ActivityRepository);
  private readonly _collab = inject(CollabService);

  private selected(): IWireElement | null {
    const id = this._sel.selectedId();
    if (!id) return null;
    return this._state.getById(id) ?? null;
  }

  public updateSelected(patch: Partial<IWireElement>): void {
    const sel = this.selected();
    if (!sel) return;
    this._state.patch(sel.id, patch);
  }

  public async deleteSelected(tid: string, pid: string): Promise<void> {
    const ids = this._sel.allSelectedIdSet();
    if (ids.size === 0) return;

    const toDelete = this._state.list().filter((e) => ids.has(e.id) && !e.locked);
    if (toDelete.length === 0) return;

    const deleteSet = new Set(toDelete.map((e) => e.id));
    this._state.list.update((els) => els.filter((e) => !deleteSet.has(e.id)));
    this._sel.setSelection(null, new Set());
    for (const e of toDelete) this._collab.sendDelete(e.id);

    const label =
      toDelete.length === 1 ? `deleted ${toDelete[0].type}` : `deleted ${toDelete.length} elements`;
    await this._activity.writeActivity(tid, pid, 'element-deleted', label);
  }

  public duplicateSelected(): string | null {
    const sel = this.selected();
    if (!sel) return null;
    return this._insertCopy(this._factory.cloneWithOffset(sel, 16, this._state.list()));
  }

  public paste(pageId: string, src: IWireElement): string {
    return this._insertCopy({
      ...this._factory.cloneWithOffset(src, 16, this._state.list()),
      pageId,
    });
  }

  public setHeadingLevel(level: HeadingLevel): void {
    this.updateSelected({ level });
  }

  public setColor(value: string): void {
    const v = value.trim();
    if (!v) return this.clearColor();
    if (!HEX_COLOR.test(v)) return;
    this.updateSelected({ color: v.toLowerCase() });
  }

  public clearColor(): void {
    const sel = this.selected();
    if (!sel) return;
    const next: IWireElement = { ...sel };
    delete next.color;
    this._state.list.update((els) => els.map((e) => (e.id === sel.id ? next : e)));
    this._collab.sendDeleteFields(sel.id, ['color']);
  }

  private _insertCopy(copy: IWireElement): string {
    this._state.list.update((els) => [...els, copy]);
    this._collab.sendEdit(copy.id, toWirePatch(copy));
    this._collab.flushPendingEdits();
    this._sel.setPrimary(copy.id);
    return copy.id;
  }
}
