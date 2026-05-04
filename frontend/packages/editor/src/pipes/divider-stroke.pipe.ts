import { Pipe, PipeTransform } from '@angular/core';
import { IWireElement, dividerStrokeOf } from '@mocktail/projects';

@Pipe({ name: 'dividerStroke', standalone: true })
export class DividerStrokePipe implements PipeTransform {
  public transform(el: IWireElement): number {
    return dividerStrokeOf(el);
  }
}
