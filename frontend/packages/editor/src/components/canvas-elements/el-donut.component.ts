import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-donut',
  standalone: true,
  template: `
    <svg viewBox="0 0 80 80" width="100%" height="100%" preserveAspectRatio="none">
      <circle cx="40" cy="40" r="28" fill="none" stroke="#e5e5e5" stroke-width="10" />
      <circle
        cx="40"
        cy="40"
        r="28"
        fill="none"
        stroke="#0a0a0a"
        stroke-width="10"
        stroke-dasharray="175.9"
        stroke-dashoffset="70"
        transform="rotate(-90 40 40)"
      />
    </svg>
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElDonutComponent {}
