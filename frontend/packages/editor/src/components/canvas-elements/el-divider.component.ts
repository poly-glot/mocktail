import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IWireElement, dividerOrientation, dividerStyleOf } from '@mocktail/projects';
import { DividerStrokePipe } from '../../pipes/divider-stroke.pipe';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-divider',
  standalone: true,
  imports: [DividerStrokePipe],
  template: `
    <span
      class="divider-line"
      [style.border-top-width.px]="dividerOrientation(el()) === 'h' ? (el() | dividerStroke) : null"
      [style.border-top-style]="dividerOrientation(el()) === 'h' ? dividerStyleOf(el()) : null"
      [style.border-top-color]="dividerOrientation(el()) === 'h' ? el().color || null : null"
      [style.border-left-width.px]="
        dividerOrientation(el()) === 'v' ? (el() | dividerStroke) : null
      "
      [style.border-left-style]="dividerOrientation(el()) === 'v' ? dividerStyleOf(el()) : null"
      [style.border-left-color]="dividerOrientation(el()) === 'v' ? el().color || null : null"
    ></span>
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElDividerComponent {
  public readonly el = input.required<IWireElement>();

  public dividerOrientation = dividerOrientation;
  public dividerStyleOf = dividerStyleOf;
}
