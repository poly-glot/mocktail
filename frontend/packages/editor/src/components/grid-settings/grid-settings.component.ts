import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IGridConfig } from '@mocktail/projects';

export type GridNumberField = 'columns' | 'gutter' | 'margin';

export function clampGridNumber(field: GridNumberField, raw: string): number | null {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  if (field === 'columns') return Math.min(Math.floor(n), 64);
  return Math.min(n, 1000);
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-grid-settings',
  standalone: true,
  templateUrl: './grid-settings.component.html',
  styleUrl: './grid-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridSettingsComponent {
  public readonly config = input.required<IGridConfig>();

  public readonly configChange = output<IGridConfig>();

  public toggleVisible(): void {
    this.configChange.emit({ ...this.config(), visible: !this.config().visible });
  }

  public toggleSnap(): void {
    this.configChange.emit({ ...this.config(), snap: !this.config().snap });
  }

  public updateNumber(field: GridNumberField, value: string): void {
    const n = clampGridNumber(field, value);
    if (n === null) return;
    this.configChange.emit({ ...this.config(), [field]: n });
  }
}
