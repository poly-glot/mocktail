import { Injectable, inject, signal } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { IWireElement } from '@mocktail/projects';

@Injectable({ providedIn: 'root' })
export class EditorElementsStateService {
  public readonly list = signal<IWireElement[]>([]);

  private readonly _collab = inject(CollabService);

  public reset(): void {
    this.list.set([]);
  }

  public getById(id: string): IWireElement | undefined {
    return this.list().find((e) => e.id === id);
  }

  public updateById(id: string, updater: (el: IWireElement) => IWireElement): void {
    this.list.update((els) => {
      const idx = els.findIndex((e) => e.id === id);
      if (idx < 0) return els;
      const next = [...els];
      next[idx] = updater(els[idx]);
      return next;
    });
  }

  public async patch(
    _tid: string,
    _pid: string,
    id: string,
    patch: Partial<IWireElement>,
  ): Promise<void> {
    const el = this.getById(id);
    if (!el) return;
    const next: IWireElement = { ...el, ...patch };
    this.list.update((els) => els.map((e) => (e.id === id ? next : e)));
    this._collab.sendEdit(id, patch as Record<string, unknown>);
    this._collab.flushPendingEdits();
  }
}
