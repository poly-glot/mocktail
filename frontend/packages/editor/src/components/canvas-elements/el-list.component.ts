import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import {
  IWireElement,
  fontFamilyOf,
  isItalicOf,
  isUnderlineOf,
  textAlignOf,
} from '@mocktail/projects';
import { EditorInlineEditService } from '../../services/inline-edit/inline-edit.service';
import { EditorSessionService } from '../../services/session/session.service';
import {
  insertPlainTextAtSelection,
  outdentLineAtSelection,
  shouldCommitOnEnter,
  shouldIndentOnTab,
} from '../../services/inline-edit/inline-edit';
import { SafeListHtmlPipe } from '../../pipes/safe-list-html.pipe';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-list',
  standalone: true,
  imports: [SafeListHtmlPipe],
  template: `
    @if (_inline.editingId() === el().id) {
      <span
        class="el-list-edit inline-editable editing"
        contentEditable="true"
        [style.text-align]="textAlignOf(el())"
        [style.font-style]="isItalicOf(el()) ? 'italic' : null"
        [style.text-decoration]="isUnderlineOf(el()) ? 'underline' : null"
        [style.font-family]="fontFamilyOf(el())"
        (keydown)="onKeydown($event)"
        (paste)="onPaste($event)"
        (blur)="onBlur($event)"
        [attr.data-testid]="'inline-edit-' + el().id"
        >{{ el().text || 'List item' }}</span
      >
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

  public readonly _inline = inject(EditorInlineEditService);
  private readonly _session = inject(EditorSessionService);

  public textAlignOf = textAlignOf;
  public isItalicOf = isItalicOf;
  public isUnderlineOf = isUnderlineOf;
  public fontFamilyOf = fontFamilyOf;

  public onKeydown(ev: KeyboardEvent): void {
    const el = this.el();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      this._inline.commit(ev.currentTarget as HTMLElement, el, true, this._tid(), this._pid());
    } else if (ev.key === 'Enter' && shouldCommitOnEnter(el.type, ev.shiftKey)) {
      ev.preventDefault();
      this._inline.commit(ev.currentTarget as HTMLElement, el, false, this._tid(), this._pid());
    } else if (ev.key === 'Tab' && shouldIndentOnTab(el.type)) {
      ev.preventDefault();
      if (ev.shiftKey) outdentLineAtSelection();
      else insertPlainTextAtSelection('\t');
    }
  }

  public onPaste(ev: ClipboardEvent): void {
    ev.preventDefault();
    const text = ev.clipboardData?.getData('text/plain') ?? '';
    insertPlainTextAtSelection(text);
  }

  public onBlur(ev: FocusEvent): void {
    this._inline.commit(
      ev.currentTarget as HTMLElement,
      this.el(),
      false,
      this._tid(),
      this._pid(),
    );
  }

  private _tid(): string {
    return this._session.tid();
  }
  private _pid(): string {
    return this._session.pid();
  }
}
