import { Pipe, PipeTransform } from '@angular/core';

const HEADING_PX = [32, 26, 22, 18, 15, 13] as const;
const SMALLEST_PX = HEADING_PX[HEADING_PX.length - 1];

@Pipe({ name: 'headingFontSize', standalone: true })
export class HeadingFontSizePipe implements PipeTransform {
  public transform(level: number | undefined): number {
    return HEADING_PX[(level ?? 1) - 1] ?? SMALLEST_PX;
  }
}
