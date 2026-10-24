import { Directive, computed, inject, input } from '@angular/core';
import {
  IWireElement,
  fontFamilyOf,
  hasRichText,
  isItalicOf,
  isUnderlineOf,
  textAlignOf,
} from '@mocktail/projects';
import {
  insertPlainTextAtSelection,
  outdentLineAtSelection,
  shouldCommitOnEnter,
  shouldIndentOnTab,
} from '../../services/inline-edit/inline-edit';
import { EditorInlineEditService } from '../../services/inline-edit/inline-edit.service';

@Directive({
  selector: '[mkInlineText]',
  standalone: true,
  host: {
    class: 'inline-editable',
    '[attr.data-testid]': "'inline-edit-' + el().id",
    '[class.editing]': 'editing()',
    '[contentEditable]': 'editing()',
    '[style.font-family]': 'richText() ? fontFamilyOf(el()) : null',
    '[style.font-style]': "richText() && isItalicOf(el()) ? 'italic' : null",
    '[style.text-align]': 'richText() ? textAlignOf(el()) : null',
    '[style.text-decoration]': "richText() ? (isUnderlineOf(el()) ? 'underline' : 'none') : null",
    '(blur)': 'onBlur($event)',
    '(keydown)': 'onKeydown($event)',
    '(paste)': 'onPaste($event)',
  },
})
export class InlineTextDirective {
  public readonly el = input.required<IWireElement>({ alias: 'mkInlineText' });

  private readonly _inline = inject(EditorInlineEditService);

  public readonly editing = computed(() => this._inline.editingId() === this.el().id);
  public readonly richText = computed(() => hasRichText(this.el().type));

  public readonly fontFamilyOf = fontFamilyOf;
  public readonly isItalicOf = isItalicOf;
  public readonly isUnderlineOf = isUnderlineOf;
  public readonly textAlignOf = textAlignOf;

  public onKeydown(ev: KeyboardEvent): void {
    const el = this.el();
    const host = ev.currentTarget as HTMLElement;

    if (ev.key === 'Escape') {
      ev.preventDefault();
      this._inline.commit(host, el, true);
      return;
    }

    if (ev.key === 'Enter' && shouldCommitOnEnter(el.type, ev.shiftKey)) {
      ev.preventDefault();
      this._inline.commit(host, el, false);
      return;
    }

    if (ev.key === 'Tab' && shouldIndentOnTab(el.type)) {
      ev.preventDefault();
      if (ev.shiftKey) outdentLineAtSelection();
      else insertPlainTextAtSelection('\t');
    }
  }

  public onPaste(ev: ClipboardEvent): void {
    ev.preventDefault();
    insertPlainTextAtSelection(ev.clipboardData?.getData('text/plain') ?? '');
  }

  public onBlur(ev: FocusEvent): void {
    this._inline.commit(ev.currentTarget as HTMLElement, this.el(), false);
  }
}
