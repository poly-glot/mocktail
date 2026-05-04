import { Pipe, PipeTransform } from '@angular/core';
import { IWireElement } from '@mocktail/projects';
import { transformFor } from '../utils/presentation';

@Pipe({ name: 'transformFor', standalone: true })
export class TransformForPipe implements PipeTransform {
  public transform(el: IWireElement): string {
    return transformFor(el);
  }
}
