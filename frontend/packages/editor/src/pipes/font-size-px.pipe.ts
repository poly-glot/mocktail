import { Pipe, PipeTransform } from '@angular/core';
import { FONT_SIZES, IWireElement, fontSizeOf } from '@mocktail/projects';

/**
 * Maps an element's normalized font-size key to its CSS pixel value.
 */
@Pipe({ name: 'fontSizePx', standalone: true })
export class FontSizePxPipe implements PipeTransform {
  public transform(el: IWireElement): number {
    const found = FONT_SIZES.find((o) => o.key === fontSizeOf(el));
    return found ? found.px : 13;
  }
}
