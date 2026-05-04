import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IWireElement } from '@mocktail/projects';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-card',
  standalone: true,
  template: `
    <div class="el-card-body">
      <div class="el-card-head">{{ el().text || 'Card' }}</div>
      <div class="el-card-thumb"></div>
      <div class="el-card-meta">
        <span class="el-card-title-line"></span>
        <span class="el-card-meta-line"></span>
      </div>
    </div>
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElCardComponent {
  public readonly el = input.required<IWireElement>();
}
