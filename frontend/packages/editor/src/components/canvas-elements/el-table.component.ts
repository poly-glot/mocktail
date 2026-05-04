import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-table',
  standalone: true,
  template: `
    <div class="el-table">
      <div class="row head"><span>Col 1</span><span>Col 2</span><span>Col 3</span></div>
      <div class="row"><span>—</span><span>—</span><span>—</span></div>
      <div class="row"><span>—</span><span>—</span><span>—</span></div>
      <div class="row"><span>—</span><span>—</span><span>—</span></div>
    </div>
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElTableComponent {}
