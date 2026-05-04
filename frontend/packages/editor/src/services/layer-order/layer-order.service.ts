import { Injectable, inject } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { IWireElement } from '@mocktail/projects';
import { EditorContextMenuService } from '../context-menu/context-menu.service';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorSelectionService } from '../selection/selection.service';

@Injectable({ providedIn: 'root' })
export class EditorLayerOrderService {
  private readonly _state = inject(EditorElementsStateService);
  private readonly _sel = inject(EditorSelectionService);
  private readonly _ctxMenu = inject(EditorContextMenuService);
  private readonly _collab = inject(CollabService);

  public async bringToFront(tid: string, pid: string, elId?: string): Promise<void> {
    const id = elId ?? this._sel.selectedId();
    if (!id) return;
    const zs = this._state.list().map((e) => e.zIndex);
    const max = zs.length ? Math.max(...zs) : 0;
    await this._state.patch(tid, pid, id, { zIndex: max + 1 });
    this._ctxMenu.close();
  }

  public async sendToBack(tid: string, pid: string, elId?: string): Promise<void> {
    const id = elId ?? this._sel.selectedId();
    if (!id) return;
    const zs = this._state.list().map((e) => e.zIndex);
    const min = zs.length ? Math.min(...zs) : 0;
    await this._state.patch(tid, pid, id, { zIndex: min - 1 });
    this._ctxMenu.close();
  }

  public async bringForward(tid: string, pid: string, elId?: string): Promise<void> {
    const id = elId ?? this._sel.selectedId();
    if (!id) return;
    const el = this._state.getById(id);
    if (!el) return;
    const above = this._state
      .list()
      .filter((e) => e.zIndex > el.zIndex)
      .sort((a, b) => a.zIndex - b.zIndex)[0];
    if (!above) return;
    await this._state.patch(tid, pid, id, { zIndex: above.zIndex + 1 });
    this._ctxMenu.close();
  }

  public async sendBackward(tid: string, pid: string, elId?: string): Promise<void> {
    const id = elId ?? this._sel.selectedId();
    if (!id) return;
    const el = this._state.getById(id);
    if (!el) return;
    const below = this._state
      .list()
      .filter((e) => e.zIndex < el.zIndex)
      .sort((a, b) => b.zIndex - a.zIndex)[0];
    if (!below) return;
    await this._state.patch(tid, pid, id, { zIndex: below.zIndex - 1 });
    this._ctxMenu.close();
  }

  public async toggleLock(tid: string, pid: string, elId?: string): Promise<void> {
    const id = elId ?? this._sel.selectedId();
    if (!id) return;
    const el = this._state.getById(id);
    if (!el) return;
    await this._state.patch(tid, pid, id, { locked: !el.locked });
    this._ctxMenu.close();
  }

  public async reorderLayer(
    _tid: string,
    _pid: string,
    fromId: string,
    toId: string,
    position: 'above' | 'below',
  ): Promise<void> {
    if (fromId === toId) return;
    const prev = this._state.list();
    const target = prev.find((e) => e.id === toId);
    if (!target) return;
    const tentativeZ = position === 'above' ? target.zIndex + 0.5 : target.zIndex - 0.5;
    const tentative = prev.map((e) => (e.id === fromId ? { ...e, zIndex: tentativeZ } : e));
    const sorted = [...tentative].sort((a, b) => a.zIndex - b.zIndex);
    const patches: { id: string; patch: Partial<IWireElement> }[] = [];
    const nextElements = [...prev];
    for (let i = 0; i < sorted.length; i++) {
      const el = sorted[i];
      const z = i + 1;
      if (el.zIndex !== z) {
        patches.push({ id: el.id, patch: { zIndex: z } });
        const idx = nextElements.findIndex((e) => e.id === el.id);
        if (idx >= 0) nextElements[idx] = { ...nextElements[idx], zIndex: z };
      }
    }
    if (patches.length === 0) return;
    this._state.list.set(nextElements);
    // The proxy coalesces these into one CommitRequest within the 33ms
    // throttle window, so this ends up as a single Firestore batch write.
    for (const p of patches) {
      this._collab.sendEdit(p.id, p.patch as Record<string, unknown>);
    }
    this._collab.flushPendingEdits();
  }
}
