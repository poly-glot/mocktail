import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-phone-frame',
  standalone: true,
  template: `
    <div class="phone-body">
      <div class="phone-notch"></div>
    </div>
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElPhoneFrameComponent {}
