import { Injectable, computed, signal } from '@angular/core';
import { IWireElement } from '@mocktail/projects';

@Injectable({ providedIn: 'root' })
export class EditorClipboardService {
  private readonly _el = signal<IWireElement | null>(null);

  public readonly canPaste = computed(() => this._el() !== null);

  public put(el: IWireElement): void {
    this._el.set({ ...el });
  }

  public peek(): IWireElement | null {
    return this._el();
  }

  public clear(): void {
    this._el.set(null);
  }
}
