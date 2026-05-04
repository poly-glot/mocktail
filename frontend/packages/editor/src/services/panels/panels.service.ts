import { Injectable, signal } from '@angular/core';

export type LeftPanel = 'components' | 'symbols' | 'images';

@Injectable({ providedIn: 'root' })
export class EditorPanelsService {
  public readonly collapseLeft = signal(false);
  public readonly collapseRight = signal(false);
  public readonly leftPanel = signal<LeftPanel>('components');

  public toggleLeft(): void {
    this.collapseLeft.update((v) => !v);
  }

  public toggleRight(): void {
    this.collapseRight.update((v) => !v);
  }

  public setLeftPanel(panel: LeftPanel): void {
    this.leftPanel.set(panel);
    if (this.collapseLeft()) this.collapseLeft.set(false);
  }
}
