import { Pipe, PipeTransform } from '@angular/core';

/**
 * Default heading sizes (px) for `<h1>`–`<h6>`.
 */
@Pipe({ name: 'headingFontSize', standalone: true })
export class HeadingFontSizePipe implements PipeTransform {
  public transform(level: number | undefined): number {
    switch (level ?? 1) {
      case 1:
        return 32;
      case 2:
        return 26;
      case 3:
        return 22;
      case 4:
        return 18;
      case 5:
        return 15;
      case 6:
      default:
        return 13;
    }
  }
}
