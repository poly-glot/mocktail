import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IWireElement } from '@mocktail/projects';
import { InlineTextDirective } from '../../directives/inline-text/inline-text.directive';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-button',
  standalone: true,
  imports: [InlineTextDirective],
  template: `<span class="btn-text" [mkInlineText]="el()">{{ el().text || 'Button' }}</span>`,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElButtonComponent {
  public readonly el = input.required<IWireElement>();
}
