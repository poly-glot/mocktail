import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IGridConfig } from '@mocktail/projects';

export interface IColumnRegion {
  readonly left: number;
  readonly width: number;
}

export function computeColumnRegions(config: IGridConfig, pageWidth: number): IColumnRegion[] {
  if (!config.visible) return [];
  const inner = pageWidth - config.margin * 2;
  if (inner <= 0 || config.columns <= 0) return [];
  const colW = (inner - config.gutter * (config.columns - 1)) / config.columns;
  if (colW <= 0) return [];
  const regions: IColumnRegion[] = [];
  for (let i = 0; i < config.columns; i++) {
    regions.push({
      left: config.margin + i * (colW + config.gutter),
      width: colW,
    });
  }
  return regions;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-grid-overlay',
  standalone: true,
  templateUrl: './grid-overlay.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GridOverlayComponent {
  public readonly config = input.required<IGridConfig>();
  public readonly pageWidth = input.required<number>();

  public readonly regions = computed<IColumnRegion[]>(() =>
    computeColumnRegions(this.config(), this.pageWidth()),
  );

  public readonly visible = computed(() => this.config().visible);
}
