import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import {
  BorderStyle,
  COLOR_PRESETS,
  DIVIDER_STROKE_MAX,
  DIVIDER_STROKE_MIN,
  DividerStyle,
  ElementType,
  FONT_SIZES,
  FontSize,
  GOOGLE_FONTS,
  IGridConfig,
  IImageRef,
  IWireElement,
  TextAlign,
  borderStyleOf,
  buttonVariantOf,
  dividerOrientation,
  dividerStrokeOf,
  dividerStyleOf,
  fontFamilyOf,
  fontSizeOf,
  hasBackground,
  hasBorder,
  hasCheckedState,
  hasFontSize,
  hasIcon,
  hasRichText,
  hasTextField,
  iconNameOf,
  imageRefOf,
  isCheckedOf,
  isItalicOf,
  isTextual,
  isUnderlineOf,
  textAlignOf,
} from '@mocktail/projects';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Image as ImageIcon,
  Italic,
  LUCIDE_ICONS,
  LucideAngularModule,
  LucideIconProvider,
  PanelRightClose,
  Sparkles,
  Trash2,
  Underline,
  X,
} from 'lucide-angular';
import { EditorElementEditorService } from '../../services/element-editor/element-editor.service';
import { EditorInspectorService } from '../../services/inspector/inspector.service';
import { EditorPanelsService } from '../../services/panels/panels.service';
import { EditorSessionService } from '../../services/session/session.service';
import { GridSettingsComponent } from '../grid-settings/grid-settings.component';
import { IconPickerComponent } from '../icon-picker/icon-picker.component';

type NumericField = 'x' | 'y' | 'w' | 'h' | 'rotation';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-inspector-panel',
  standalone: true,
  imports: [LucideAngularModule, GridSettingsComponent, IconPickerComponent],
  providers: [
    {
      provide: LUCIDE_ICONS,
      multi: true,
      useValue: new LucideIconProvider({
        AlignCenter,
        AlignLeft,
        AlignRight,
        Image: ImageIcon,
        Italic,
        PanelRightClose,
        Sparkles,
        Trash2,
        Underline,
        X,
      }),
    },
  ],
  templateUrl: './inspector-panel.component.html',
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorPanelComponent {
  public readonly selected = input<IWireElement | null>(null);
  public readonly gridConfig = input.required<IGridConfig>();
  public readonly collapsed = input<boolean>(false);

  public readonly colorPresets = COLOR_PRESETS;
  public readonly fontSizes = FONT_SIZES;
  public readonly googleFonts = GOOGLE_FONTS;

  private readonly _insp = inject(EditorInspectorService);
  private readonly _editor = inject(EditorElementEditorService);
  private readonly _panels = inject(EditorPanelsService);
  private readonly _session = inject(EditorSessionService);

  public isTextual(type: ElementType): boolean {
    return isTextual(type);
  }

  public hasTextField(type: ElementType): boolean {
    return hasTextField(type);
  }

  public buttonVariantOf(el: IWireElement): 'primary' | 'secondary' | 'tertiary' {
    return buttonVariantOf(el);
  }

  public dividerOrientation(el: IWireElement): 'h' | 'v' {
    return dividerOrientation(el);
  }

  public dividerStrokeOf(el: IWireElement): number {
    return dividerStrokeOf(el);
  }

  public dividerStyleOf(el: IWireElement): DividerStyle {
    return dividerStyleOf(el);
  }

  public hasBorder(type: ElementType): boolean {
    return hasBorder(type);
  }

  public hasBackground(type: ElementType): boolean {
    return hasBackground(type);
  }

  public hasIcon(type: ElementType): boolean {
    return hasIcon(type);
  }

  public imageRefOf(el: IWireElement): IImageRef | null {
    return imageRefOf(el);
  }

  public iconNameOf(el: IWireElement): string {
    return iconNameOf(el);
  }

  public hasCheckedState(type: ElementType): boolean {
    return hasCheckedState(type);
  }

  public isCheckedOf(el: IWireElement): boolean {
    return isCheckedOf(el);
  }

  public borderStyleOf(el: IWireElement): BorderStyle {
    return borderStyleOf(el);
  }

  public hasRichText(type: ElementType): boolean {
    return hasRichText(type);
  }

  public textAlignOf(el: IWireElement): TextAlign {
    return textAlignOf(el);
  }

  public isItalicOf(el: IWireElement): boolean {
    return isItalicOf(el);
  }

  public isUnderlineOf(el: IWireElement): boolean {
    return isUnderlineOf(el);
  }

  public fontFamilyOf(el: IWireElement): string | null {
    return fontFamilyOf(el);
  }

  public hasFontSize(type: ElementType): boolean {
    return hasFontSize(type);
  }

  public fontSizeOf(el: IWireElement): FontSize {
    return fontSizeOf(el);
  }

  public onText(value: string): void {
    this._editor.updateSelected(this._tid(), this._pid(), { text: value });
  }

  public onNumber(field: NumericField, value: string): void {
    let n = parseFloat(value);
    if (!Number.isFinite(n)) return;
    if (field === 'w' || field === 'h') n = Math.max(1, Math.min(10000, n));
    else if (field === 'x' || field === 'y') n = Math.max(-10000, Math.min(10000, n));
    else if (field === 'rotation') n = ((n % 360) + 360) % 360;
    this._editor.updateSelected(this._tid(), this._pid(), { [field]: n } as Partial<IWireElement>);
  }

  public onHeadingLevel(value: string): void {
    void this._editor.setHeadingLevel(this._tid(), this._pid(), value);
  }

  public onColorInput(value: string): void {
    void this._editor.setColor(this._tid(), this._pid(), value);
  }

  public onColorClear(): void {
    void this._editor.clearColor(this._tid(), this._pid());
  }

  public onButtonVariant(v: 'primary' | 'secondary' | 'tertiary'): void {
    void this._insp.setButtonVariant(this._tid(), this._pid(), v);
  }

  public onDividerOrientation(o: 'h' | 'v'): void {
    void this._insp.setDividerOrientation(this._tid(), this._pid(), o);
  }

  public onDividerStroke(value: string): void {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(DIVIDER_STROKE_MAX, Math.max(DIVIDER_STROKE_MIN, Math.round(n)));
    void this._insp.setDividerStroke(this._tid(), this._pid(), clamped);
  }

  public onDividerStyle(style: DividerStyle): void {
    void this._insp.setDividerStyle(this._tid(), this._pid(), style);
  }

  public onBorderStyle(style: BorderStyle): void {
    void this._insp.setBorderStyle(this._tid(), this._pid(), style);
  }

  public onFontFamily(value: string): void {
    void this._insp.setFontFamily(this._tid(), this._pid(), value === '' ? null : value);
  }

  public onFontSize(value: string): void {
    if (value === 'xs' || value === 'sm' || value === 'md' || value === 'lg' || value === 'xl') {
      void this._insp.setFontSize(this._tid(), this._pid(), value);
    }
  }

  public onIconName(name: string): void {
    void this._insp.setIconName(this._tid(), this._pid(), name);
  }

  public onChecked(value: boolean): void {
    void this._insp.setChecked(this._tid(), this._pid(), value);
  }

  public onTextAlign(a: TextAlign): void {
    void this._insp.setTextAlign(this._tid(), this._pid(), a);
  }

  public onItalicToggle(): void {
    void this._insp.toggleItalic(this._tid(), this._pid());
  }

  public onUnderlineToggle(): void {
    void this._insp.toggleUnderline(this._tid(), this._pid());
  }

  public onDuplicate(): void {
    void this._editor.duplicateSelected(this._tid(), this._pid());
  }

  public onDelete(): void {
    void this._editor.deleteSelected(this._tid(), this._pid());
  }

  public onImageReplace(): void {
    this._panels.setLeftPanel('images');
  }

  public onImageRemove(): void {
    void this._insp.removeImage(this._tid(), this._pid());
  }

  public onGridConfigChange(cfg: IGridConfig): void {
    void this._session.setGridConfig(cfg);
  }

  public onCollapseToggle(): void {
    this._panels.toggleRight();
  }

  private _tid(): string {
    return this._session.tid();
  }

  private _pid(): string {
    return this._session.pid();
  }
}
