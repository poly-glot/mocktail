import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-bar-chart',
  standalone: true,
  template: `
    <svg viewBox="0 0 320 180" width="100%" height="100%" preserveAspectRatio="none">
      <g fill="#0a0a0a">
        <rect x="8" y="110" width="20" height="60" />
        <rect x="40" y="80" width="20" height="90" />
        <rect x="72" y="120" width="20" height="50" />
        <rect x="104" y="60" width="20" height="110" />
        <rect x="136" y="90" width="20" height="80" />
        <rect x="168" y="40" width="20" height="130" />
        <rect x="200" y="70" width="20" height="100" />
        <rect x="232" y="30" width="20" height="140" />
        <rect x="264" y="80" width="20" height="90" />
        <rect x="296" y="50" width="20" height="120" />
      </g>
    </svg>
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElBarChartComponent {}
