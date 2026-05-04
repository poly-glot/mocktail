import { Pipe, PipeTransform } from '@angular/core';
import { BorderStyle, IWireElement, borderStyleOf } from '@mocktail/projects';

@Pipe({ name: 'borderStyle', standalone: true })
export class BorderStylePipe implements PipeTransform {
  public transform(el: IWireElement): BorderStyle {
    return borderStyleOf(el);
  }
}
