import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IWireElement } from '@mocktail/projects';
import { InlineTextDirective } from '../../directives/inline-text/inline-text.directive';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-heading',
  standalone: true,
  imports: [InlineTextDirective],
  template: `<span class="el-heading-text" [mkInlineText]="el()">{{
    el().text || 'Heading'
  }}</span>`,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElHeadingComponent {
  public readonly el = input.required<IWireElement>();
}
