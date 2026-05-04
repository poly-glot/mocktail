import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IWireElement } from '@mocktail/projects';
import { LucideAngularModule } from 'lucide-angular';
import { IconNamePipe } from '../../pipes/icon-name.pipe';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-icon',
  standalone: true,
  imports: [LucideAngularModule, IconNamePipe],
  template: `
    <lucide-icon
      class="icon-glyph"
      [name]="el() | iconName"
      [style.color]="el().color || null"
    ></lucide-icon>
    @if (el().text) {
      <span class="icon-label">{{ el().text }}</span>
    }
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElIconComponent {
  public readonly el = input.required<IWireElement>();
}
