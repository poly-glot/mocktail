import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IWireElement } from '@mocktail/projects';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-tag',
  standalone: true,
  template: `
    <span class="tag-shape" [style.background-color]="el().color || null"></span>
    <span class="tag-hole"></span>
    <span class="tag-text">{{ el().text || 'Tag' }}</span>
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElTagComponent {
  public readonly el = input.required<IWireElement>();
}
