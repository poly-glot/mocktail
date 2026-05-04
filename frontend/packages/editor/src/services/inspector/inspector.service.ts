import { Injectable, inject } from '@angular/core';
import {
  BorderStyle,
  DividerStyle,
  FontSize,
  IWireElement,
  TextAlign,
  borderStyleOf,
  buttonVariantOf,
  dividerOrientation,
  dividerStrokeOf,
  dividerStyleOf,
  fontFamilyOf,
  fontSizeOf,
  hasBorder,
  hasCheckedState,
  hasFontSize,
  hasRichText,
  iconNameOf,
  isCheckedOf,
  isItalicOf,
  isUnderlineOf,
  textAlignOf,
} from '@mocktail/projects';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorSelectionService } from '../selection/selection.service';

@Injectable({ providedIn: 'root' })
export class EditorInspectorService {
  private readonly _sel = inject(EditorSelectionService);
  private readonly _state = inject(EditorElementsStateService);

  private selected(): IWireElement | null {
    const id = this._sel.selectedId();
    if (!id) return null;
    return this._state.getById(id) ?? null;
  }

  public async setIconName(tid: string, pid: string, name: string): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'icon' || iconNameOf(sel) === name) return;
    const data = { ...(sel.data ?? {}), iconName: name };
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async setButtonVariant(
    tid: string,
    pid: string,
    variant: 'primary' | 'secondary' | 'tertiary',
  ): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'button' || buttonVariantOf(sel) === variant) return;
    await this._state.patch(tid, pid, sel.id, { variant } as Partial<IWireElement>);
  }

  public async setDividerOrientation(
    tid: string,
    pid: string,
    orientation: 'h' | 'v',
  ): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'divider' || dividerOrientation(sel) === orientation) return;
    const length = Math.max(sel.w, sel.h);
    const centerX = sel.x + sel.w / 2;
    const centerY = sel.y + sel.h / 2;
    const w = orientation === 'h' ? length : 1;
    const h = orientation === 'v' ? length : 1;
    const x = Math.round(centerX - w / 2);
    const y = Math.round(centerY - h / 2);
    await this._state.patch(tid, pid, sel.id, {
      variant: orientation,
      w,
      h,
      x,
      y,
    } as Partial<IWireElement>);
  }

  public async setDividerStroke(tid: string, pid: string, stroke: number): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'divider' || dividerStrokeOf(sel) === stroke) return;
    const data = { ...(sel.data ?? {}), strokeWidth: stroke };
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async setDividerStyle(tid: string, pid: string, style: DividerStyle): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'divider' || dividerStyleOf(sel) === style) return;
    const data = { ...(sel.data ?? {}), strokeStyle: style };
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async setBorderStyle(tid: string, pid: string, style: BorderStyle): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasBorder(sel.type) || borderStyleOf(sel) === style) return;
    const data = { ...(sel.data ?? {}), borderStyle: style };
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async setFontFamily(tid: string, pid: string, family: string | null): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasRichText(sel.type) || fontFamilyOf(sel) === family) return;
    const data: Record<string, unknown> = { ...(sel.data ?? {}) };
    if (family === null) delete data['fontFamily'];
    else data['fontFamily'] = family;
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async setFontSize(tid: string, pid: string, size: FontSize): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasFontSize(sel.type) || fontSizeOf(sel) === size) return;
    const data = { ...(sel.data ?? {}), fontSize: size };
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async setChecked(tid: string, pid: string, value: boolean): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasCheckedState(sel.type) || isCheckedOf(sel) === value) return;
    const data = { ...(sel.data ?? {}), checked: value };
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async setTextAlign(tid: string, pid: string, align: TextAlign): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasRichText(sel.type) || textAlignOf(sel) === align) return;
    const data = { ...(sel.data ?? {}), textAlign: align };
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async toggleItalic(tid: string, pid: string): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasRichText(sel.type)) return;
    const data = { ...(sel.data ?? {}), italic: !isItalicOf(sel) };
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async toggleUnderline(tid: string, pid: string): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasRichText(sel.type)) return;
    const data = { ...(sel.data ?? {}), underline: !isUnderlineOf(sel) };
    await this._state.patch(tid, pid, sel.id, { data });
  }

  public async removeImage(tid: string, pid: string, id?: string): Promise<void> {
    const target = id ? this._state.getById(id) : this.selected();
    if (!target || target.type !== 'image') return;
    const rest = { ...(target.data ?? {}) } as Record<string, unknown>;
    if (!('image' in rest)) return;
    delete rest['image'];
    await this._state.patch(tid, pid, target.id, { data: rest });
  }
}
