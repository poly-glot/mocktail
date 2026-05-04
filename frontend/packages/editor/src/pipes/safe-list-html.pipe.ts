import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { IWireElement } from '@mocktail/projects';
import { buildListItemHtml } from '../utils/list-render';

@Pipe({ name: 'safeListHtml', standalone: true })
export class SafeListHtmlPipe implements PipeTransform {
  private readonly _sanitizer = inject(DomSanitizer);

  public transform(el: IWireElement): SafeHtml {
    return this._sanitizer.bypassSecurityTrustHtml(buildListItemHtml(el.text ?? ''));
  }
}
