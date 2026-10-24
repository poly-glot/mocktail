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

  public async setIconName(name: string): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'icon' || iconNameOf(sel) === name) return;
    const data = { ...(sel.data ?? {}), iconName: name };
    await this._state.patch(sel.id, { data });
  }

  public async setButtonVariant(variant: 'primary' | 'secondary' | 'tertiary'): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'button' || buttonVariantOf(sel) === variant) return;
    await this._state.patch(sel.id, { variant } as Partial<IWireElement>);
  }

  public async setDividerOrientation(orientation: 'h' | 'v'): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'divider' || dividerOrientation(sel) === orientation) return;
    const length = Math.max(sel.w, sel.h);
    const centerX = sel.x + sel.w / 2;
    const centerY = sel.y + sel.h / 2;
    const w = orientation === 'h' ? length : 1;
    const h = orientation === 'v' ? length : 1;
    const x = Math.round(centerX - w / 2);
    const y = Math.round(centerY - h / 2);
    await this._state.patch(sel.id, {
      variant: orientation,
      w,
      h,
      x,
      y,
    } as Partial<IWireElement>);
  }

  public async setDividerStroke(stroke: number): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'divider' || dividerStrokeOf(sel) === stroke) return;
    const data = { ...(sel.data ?? {}), strokeWidth: stroke };
    await this._state.patch(sel.id, { data });
  }

  public async setDividerStyle(style: DividerStyle): Promise<void> {
    const sel = this.selected();
    if (!sel || sel.type !== 'divider' || dividerStyleOf(sel) === style) return;
    const data = { ...(sel.data ?? {}), strokeStyle: style };
    await this._state.patch(sel.id, { data });
  }

  public async setBorderStyle(style: BorderStyle): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasBorder(sel.type) || borderStyleOf(sel) === style) return;
    const data = { ...(sel.data ?? {}), borderStyle: style };
    await this._state.patch(sel.id, { data });
  }

  public async setFontFamily(family: string | null): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasRichText(sel.type) || fontFamilyOf(sel) === family) return;
    const data: Record<string, unknown> = { ...(sel.data ?? {}) };
    if (family === null) delete data['fontFamily'];
    else data['fontFamily'] = family;
    await this._state.patch(sel.id, { data });
  }

  public async setFontSize(size: FontSize): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasFontSize(sel.type) || fontSizeOf(sel) === size) return;
    const data = { ...(sel.data ?? {}), fontSize: size };
    await this._state.patch(sel.id, { data });
  }

  public async setChecked(value: boolean): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasCheckedState(sel.type) || isCheckedOf(sel) === value) return;
    const data = { ...(sel.data ?? {}), checked: value };
    await this._state.patch(sel.id, { data });
  }

  public async setTextAlign(align: TextAlign): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasRichText(sel.type) || textAlignOf(sel) === align) return;
    const data = { ...(sel.data ?? {}), textAlign: align };
    await this._state.patch(sel.id, { data });
  }

  public async toggleItalic(): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasRichText(sel.type)) return;
    const data = { ...(sel.data ?? {}), italic: !isItalicOf(sel) };
    await this._state.patch(sel.id, { data });
  }

  public async toggleUnderline(): Promise<void> {
    const sel = this.selected();
    if (!sel || !hasRichText(sel.type)) return;
    const data = { ...(sel.data ?? {}), underline: !isUnderlineOf(sel) };
    await this._state.patch(sel.id, { data });
  }

  public async removeImage(id?: string): Promise<void> {
    const target = id ? this._state.getById(id) : this.selected();
    if (!target || target.type !== 'image') return;
    const rest = { ...(target.data ?? {}) } as Record<string, unknown>;
    if (!('image' in rest)) return;
    delete rest['image'];
    await this._state.patch(target.id, { data: rest });
  }
}
