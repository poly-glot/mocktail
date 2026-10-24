import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import {
  BorderStyle,
  COLOR_PRESETS,
  DIVIDER_STROKE_MAX,
  DIVIDER_STROKE_MIN,
  DividerStyle,
  FONT_SIZES,
  FontSize,
  GOOGLE_FONTS,
  HeadingLevel,
  IGridConfig,
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

const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];
const FONT_SIZE_KEYS: ReadonlySet<string> = new Set(FONT_SIZES.map((s) => s.key));

function clampNumeric(field: NumericField, n: number): number {
  if (field === 'w' || field === 'h') return Math.max(1, Math.min(10000, n));
  if (field === 'rotation') return ((n % 360) + 360) % 360;
  return Math.max(-10000, Math.min(10000, n));
}

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
  public readonly headingLevels = HEADING_LEVELS;

  public readonly isTextual = isTextual;
  public readonly hasTextField = hasTextField;
  public readonly buttonVariantOf = buttonVariantOf;
  public readonly dividerOrientation = dividerOrientation;
  public readonly dividerStrokeOf = dividerStrokeOf;
  public readonly dividerStyleOf = dividerStyleOf;
  public readonly hasBorder = hasBorder;
  public readonly hasBackground = hasBackground;
  public readonly hasIcon = hasIcon;
  public readonly imageRefOf = imageRefOf;
  public readonly iconNameOf = iconNameOf;
  public readonly hasCheckedState = hasCheckedState;
  public readonly isCheckedOf = isCheckedOf;
  public readonly borderStyleOf = borderStyleOf;
  public readonly hasRichText = hasRichText;
  public readonly textAlignOf = textAlignOf;
  public readonly isItalicOf = isItalicOf;
  public readonly isUnderlineOf = isUnderlineOf;
  public readonly fontFamilyOf = fontFamilyOf;
  public readonly hasFontSize = hasFontSize;
  public readonly fontSizeOf = fontSizeOf;

  private readonly _insp = inject(EditorInspectorService);
  private readonly _editor = inject(EditorElementEditorService);
  private readonly _panels = inject(EditorPanelsService);
  private readonly _session = inject(EditorSessionService);

  public onText(value: string): void {
    this._editor.updateSelected({ text: value });
  }

  public onNumber(field: NumericField, value: string): void {
    const n = parseFloat(value);
    if (!Number.isFinite(n)) return;
    this._editor.updateSelected({ [field]: clampNumeric(field, n) });
  }

  public onHeadingLevel(level: HeadingLevel): void {
    this._editor.setHeadingLevel(level);
  }

  public onColorInput(value: string): void {
    this._editor.setColor(value);
  }

  public onColorClear(): void {
    this._editor.clearColor();
  }

  public onButtonVariant(v: 'primary' | 'secondary' | 'tertiary'): void {
    void this._insp.setButtonVariant(v);
  }

  public onDividerOrientation(o: 'h' | 'v'): void {
    void this._insp.setDividerOrientation(o);
  }

  public onDividerStroke(value: string): void {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(DIVIDER_STROKE_MAX, Math.max(DIVIDER_STROKE_MIN, Math.round(n)));
    void this._insp.setDividerStroke(clamped);
  }

  public onDividerStyle(style: DividerStyle): void {
    void this._insp.setDividerStyle(style);
  }

  public onBorderStyle(style: BorderStyle): void {
    void this._insp.setBorderStyle(style);
  }

  public onFontFamily(value: string): void {
    void this._insp.setFontFamily(value === '' ? null : value);
  }

  public onFontSize(value: string): void {
    if (FONT_SIZE_KEYS.has(value)) void this._insp.setFontSize(value as FontSize);
  }

  public onIconName(name: string): void {
    void this._insp.setIconName(name);
  }

  public onChecked(value: boolean): void {
    void this._insp.setChecked(value);
  }

  public onTextAlign(a: TextAlign): void {
    void this._insp.setTextAlign(a);
  }

  public onItalicToggle(): void {
    void this._insp.toggleItalic();
  }

  public onUnderlineToggle(): void {
    void this._insp.toggleUnderline();
  }

  public onDuplicate(): void {
    this._editor.duplicateSelected();
  }

  public onDelete(): void {
    void this._editor.deleteSelected(this._session.tid(), this._session.pid());
  }

  public onImageReplace(): void {
    this._panels.setLeftPanel('images');
  }

  public onImageRemove(): void {
    void this._insp.removeImage();
  }

  public onGridConfigChange(cfg: IGridConfig): void {
    void this._session.setGridConfig(cfg);
  }

  public onCollapseToggle(): void {
    this._panels.toggleRight();
  }
}
