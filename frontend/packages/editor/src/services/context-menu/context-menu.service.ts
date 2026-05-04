import { Injectable, signal } from '@angular/core';

export interface IContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly elId: string;
}

@Injectable({ providedIn: 'root' })
export class EditorContextMenuService {
  public readonly menu = signal<IContextMenuState | null>(null);

  public openAt(x: number, y: number, elId: string): void {
    this.menu.set({ x, y, elId });
  }

  public close(): void {
    this.menu.set(null);
  }

  public isOpenFor(elId: string): boolean {
    return this.menu()?.elId === elId;
  }
}
