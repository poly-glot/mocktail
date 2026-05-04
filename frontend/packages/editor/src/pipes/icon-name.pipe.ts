import { Pipe, PipeTransform } from '@angular/core';
import { IWireElement, iconNameOf } from '@mocktail/projects';

@Pipe({ name: 'iconName', standalone: true })
export class IconNamePipe implements PipeTransform {
  public transform(el: IWireElement): string {
    return iconNameOf(el);
  }
}
