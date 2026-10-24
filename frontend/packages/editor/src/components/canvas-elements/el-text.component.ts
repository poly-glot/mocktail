import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IWireElement } from '@mocktail/projects';
import { InlineTextDirective } from '../../directives/inline-text/inline-text.directive';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-text',
  standalone: true,
  imports: [InlineTextDirective],
  template: `<span class="el-text-body" [mkInlineText]="el()">{{
    el().text || 'Text block'
  }}</span>`,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElTextComponent {
  public readonly el = input.required<IWireElement>();
}
