import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { IWireElement } from '@mocktail/projects';
import { EditorInlineEditService } from '../../services/inline-edit/inline-edit.service';
import { EditorSessionService } from '../../services/session/session.service';
import {
  insertPlainTextAtSelection,
  outdentLineAtSelection,
  shouldCommitOnEnter,
  shouldIndentOnTab,
} from '../../services/inline-edit/inline-edit';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-el-button',
  standalone: true,
  template: `
    <span
      class="btn-text inline-editable"
      [contentEditable]="_inline.editingId() === el().id"
      [class.editing]="_inline.editingId() === el().id"
      (keydown)="onKeydown($event)"
      (paste)="onPaste($event)"
      (blur)="onBlur($event)"
      [attr.data-testid]="'inline-edit-' + el().id"
      >{{ el().text || 'Button' }}</span
    >
  `,
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ElButtonComponent {
  public readonly el = input.required<IWireElement>();

  public readonly _inline = inject(EditorInlineEditService);
  private readonly _session = inject(EditorSessionService);

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
