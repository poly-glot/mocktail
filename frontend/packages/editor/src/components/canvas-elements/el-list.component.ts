import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import {
  IWireElement,
  fontFamilyOf,
  isItalicOf,
  isUnderlineOf,
  textAlignOf,
} from '@mocktail/projects';
import { InlineTextDirective } from '../../directives/inline-text/inline-text.directive';
import { SafeListHtmlPipe } from '../../pipes/safe-list-html.pipe';
import { EditorInlineEditService } from '../../services/inline-edit/inline-edit.service';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-list',
  standalone: true,
  imports: [InlineTextDirective, SafeListHtmlPipe],
  template: `
    @if (inline.editingId() === el().id) {
      <span class="el-list-edit" [mkInlineText]="el()">{{ el().text || 'List item' }}</span>
    } @else {
      <div
        class="el-list-body"
        [style.text-align]="textAlignOf(el())"
        [style.font-style]="isItalicOf(el()) ? 'italic' : null"
        [style.text-decoration]="isUnderlineOf(el()) ? 'underline' : null"
        [style.font-family]="fontFamilyOf(el())"
        [innerHTML]="el() | safeListHtml"
      ></div>
    }
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElListComponent {
  public readonly el = input.required<IWireElement>();

  public readonly inline = inject(EditorInlineEditService);

  public readonly textAlignOf = textAlignOf;
  public readonly isItalicOf = isItalicOf;
  public readonly isUnderlineOf = isUnderlineOf;
  public readonly fontFamilyOf = fontFamilyOf;
}
