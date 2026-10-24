import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IWireElement } from '@mocktail/projects';
import { InlineTextDirective } from '../../directives/inline-text/inline-text.directive';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-link',
  standalone: true,
  imports: [InlineTextDirective],
  template: `<span class="el-link-text" [mkInlineText]="el()">{{
    el().text || 'Link text'
  }}</span>`,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElLinkComponent {
  public readonly el = input.required<IWireElement>();
}
