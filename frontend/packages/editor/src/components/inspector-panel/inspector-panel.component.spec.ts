import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  COLOR_PRESETS,
  IGridConfig,
  IWireElement,
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
  isCheckedOf,
  isItalicOf,
  isTextual,
  isUnderlineOf,
  textAlignOf,
} from '@mocktail/projects';
import { EditorElementEditorService } from '../../services/element-editor/element-editor.service';
import { EditorInspectorService } from '../../services/inspector/inspector.service';
import { EditorPanelsService } from '../../services/panels/panels.service';
import { EditorSessionService } from '../../services/session/session.service';
import { InspectorPanelComponent } from './inspector-panel.component';

function makeEl(o: Partial<IWireElement> & Pick<IWireElement, 'id' | 'type'>): IWireElement {
  return {
    pageId: 'pg1',
    x: 10,
    y: 20,
    w: 100,
    h: 40,
    zIndex: 1,
    ...o,
  } as IWireElement;
}

const GRID: IGridConfig = { visible: false, columns: 12, gutter: 16, margin: 40, snap: true };
const TID = 'tid-1';
const PID = 'pid-1';

describe('Inspector pure helpers', () => {
  it('isTextual returns true only for text/heading/link/button', () => {
    expect(isTextual('text')).toBe(true);
    expect(isTextual('heading')).toBe(true);
    expect(isTextual('link')).toBe(true);
    expect(isTextual('button')).toBe(true);
    expect(isTextual('rect')).toBe(false);
    expect(isTextual('divider')).toBe(false);
    expect(isTextual('image')).toBe(false);
    expect(isTextual('checkbox')).toBe(false);
  });

  it('hasTextField excludes non-textual primitives', () => {
    expect(hasTextField('divider')).toBe(false);
    expect(hasTextField('image')).toBe(false);
    expect(hasTextField('rect')).toBe(false);
    expect(hasTextField('circle')).toBe(false);
    expect(hasTextField('list')).toBe(false);
    expect(hasTextField('checkbox')).toBe(false);
    expect(hasTextField('toggle')).toBe(false);
    expect(hasTextField('bar-chart')).toBe(false);
    expect(hasTextField('donut')).toBe(false);
    expect(hasTextField('phone-frame')).toBe(false);
    expect(hasTextField('text')).toBe(true);
    expect(hasTextField('heading')).toBe(true);
    expect(hasTextField('tag')).toBe(true);
    expect(hasTextField('card')).toBe(true);
    expect(hasTextField('icon')).toBe(true);
  });

  it('buttonVariantOf returns primary/secondary/tertiary, defaulting to primary', () => {
    expect(buttonVariantOf(makeEl({ id: 'b', type: 'button' }))).toBe('primary');
    expect(buttonVariantOf(makeEl({ id: 'b', type: 'button', variant: 'secondary' }))).toBe(
      'secondary',
    );
    expect(buttonVariantOf(makeEl({ id: 'b', type: 'button', variant: 'tertiary' }))).toBe(
      'tertiary',
    );
    expect(buttonVariantOf(makeEl({ id: 'b', type: 'button', variant: 'garbage' }))).toBe(
      'primary',
    );
  });

  it('dividerOrientation maps variant="v" to v, anything else to h', () => {
    expect(dividerOrientation(makeEl({ id: 'd', type: 'divider' }))).toBe('h');
    expect(dividerOrientation(makeEl({ id: 'd', type: 'divider', variant: 'h' }))).toBe('h');
    expect(dividerOrientation(makeEl({ id: 'd', type: 'divider', variant: 'v' }))).toBe('v');
    expect(dividerOrientation(makeEl({ id: 'd', type: 'divider', variant: 'junk' }))).toBe('h');
  });

  it('hasRichText is true for text, heading, link, and list', () => {
    expect(hasRichText('text')).toBe(true);
    expect(hasRichText('heading')).toBe(true);
    expect(hasRichText('link')).toBe(true);
    expect(hasRichText('list')).toBe(true);
    expect(hasRichText('button')).toBe(false);
    expect(hasRichText('rect')).toBe(false);
  });

  it('textAlignOf defaults to left, accepts center/right, rejects unknown', () => {
    expect(textAlignOf(makeEl({ id: 't', type: 'text' }))).toBe('left');
    expect(textAlignOf(makeEl({ id: 't', type: 'text', data: { textAlign: 'center' } }))).toBe(
      'center',
    );
    expect(textAlignOf(makeEl({ id: 't', type: 'text', data: { textAlign: 'right' } }))).toBe(
      'right',
    );
    expect(textAlignOf(makeEl({ id: 't', type: 'text', data: { textAlign: 'middle' } }))).toBe(
      'left',
    );
  });

  it('isItalicOf / isUnderlineOf read booleans strictly', () => {
    expect(isItalicOf(makeEl({ id: 't', type: 'text' }))).toBe(false);
    expect(isItalicOf(makeEl({ id: 't', type: 'text', data: { italic: true } }))).toBe(true);
    expect(isItalicOf(makeEl({ id: 't', type: 'text', data: { italic: 'yes' } }))).toBe(false);
    expect(isUnderlineOf(makeEl({ id: 't', type: 'text' }))).toBe(false);
    expect(isUnderlineOf(makeEl({ id: 't', type: 'text', data: { underline: true } }))).toBe(true);
  });

  it('isUnderlineOf defaults to true for link, false otherwise; explicit wins', () => {
    expect(isUnderlineOf(makeEl({ id: 't', type: 'link' }))).toBe(true);
    expect(isUnderlineOf(makeEl({ id: 't', type: 'link', data: { underline: false } }))).toBe(
      false,
    );
    expect(isUnderlineOf(makeEl({ id: 't', type: 'link', data: { underline: true } }))).toBe(true);
  });

  it('fontFamilyOf returns string or null', () => {
    expect(fontFamilyOf(makeEl({ id: 't', type: 'text' }))).toBeNull();
    expect(fontFamilyOf(makeEl({ id: 't', type: 'text', data: { fontFamily: 'Inter' } }))).toBe(
      'Inter',
    );
    expect(fontFamilyOf(makeEl({ id: 't', type: 'text', data: { fontFamily: '' } }))).toBeNull();
  });

  it('hasBorder is true for rect and card', () => {
    expect(hasBorder('rect')).toBe(true);
    expect(hasBorder('card')).toBe(true);
    expect(hasBorder('circle')).toBe(false);
    expect(hasBorder('divider')).toBe(false);
    expect(hasBorder('text')).toBe(false);
    expect(hasBorder('button')).toBe(false);
  });

  it('hasFontSize is true for text/link/list only', () => {
    expect(hasFontSize('text')).toBe(true);
    expect(hasFontSize('link')).toBe(true);
    expect(hasFontSize('list')).toBe(true);
    expect(hasFontSize('heading')).toBe(false);
    expect(hasFontSize('button')).toBe(false);
    expect(hasFontSize('rect')).toBe(false);
  });

  it('fontSizeOf defaults to sm, accepts enum keys, rejects garbage', () => {
    expect(fontSizeOf(makeEl({ id: 't', type: 'text' }))).toBe('sm');
    expect(fontSizeOf(makeEl({ id: 't', type: 'text', data: { fontSize: 'xs' } }))).toBe('xs');
    expect(fontSizeOf(makeEl({ id: 't', type: 'text', data: { fontSize: 'lg' } }))).toBe('lg');
    expect(fontSizeOf(makeEl({ id: 't', type: 'text', data: { fontSize: 'huge' } }))).toBe('sm');
  });

  it('hasCheckedState is true only for checkbox and toggle', () => {
    expect(hasCheckedState('checkbox')).toBe(true);
    expect(hasCheckedState('toggle')).toBe(true);
    expect(hasCheckedState('text')).toBe(false);
    expect(hasCheckedState('button')).toBe(false);
  });

  it('isCheckedOf defaults to true, respects explicit false', () => {
    expect(isCheckedOf(makeEl({ id: 'c', type: 'checkbox' }))).toBe(true);
    expect(isCheckedOf(makeEl({ id: 'c', type: 'checkbox', data: { checked: false } }))).toBe(
      false,
    );
    expect(isCheckedOf(makeEl({ id: 'c', type: 'checkbox', data: { checked: true } }))).toBe(true);
  });

  it('hasIcon is true only for icon', () => {
    expect(hasIcon('icon')).toBe(true);
    expect(hasIcon('rect')).toBe(false);
    expect(hasIcon('tag')).toBe(false);
    expect(hasIcon('text')).toBe(false);
  });

  it('iconNameOf returns stored string or defaults to smile', () => {
    expect(iconNameOf(makeEl({ id: 'i', type: 'icon' }))).toBe('smile');
    expect(iconNameOf(makeEl({ id: 'i', type: 'icon', data: { iconName: 'heart' } }))).toBe(
      'heart',
    );
    expect(iconNameOf(makeEl({ id: 'i', type: 'icon', data: { iconName: '' } }))).toBe('smile');
  });

  it('hasBackground is true for tag and circle', () => {
    expect(hasBackground('tag')).toBe(true);
    expect(hasBackground('circle')).toBe(true);
    expect(hasBackground('rect')).toBe(false);
    expect(hasBackground('card')).toBe(false);
    expect(hasBackground('text')).toBe(false);
  });

  it('borderStyleOf defaults to solid, accepts dashed/dotted, rejects unknown', () => {
    expect(borderStyleOf(makeEl({ id: 'r', type: 'rect' }))).toBe('solid');
    expect(borderStyleOf(makeEl({ id: 'r', type: 'rect', data: { borderStyle: 'dashed' } }))).toBe(
      'dashed',
    );
    expect(borderStyleOf(makeEl({ id: 'r', type: 'rect', data: { borderStyle: 'dotted' } }))).toBe(
      'dotted',
    );
    expect(borderStyleOf(makeEl({ id: 'r', type: 'rect', data: { borderStyle: 'wat' } }))).toBe(
      'solid',
    );
  });

  it('dividerStyleOf defaults to solid, accepts dashed/dotted, rejects unknown', () => {
    expect(dividerStyleOf(makeEl({ id: 'd', type: 'divider' }))).toBe('solid');
    expect(
      dividerStyleOf(makeEl({ id: 'd', type: 'divider', data: { strokeStyle: 'dashed' } })),
    ).toBe('dashed');
    expect(
      dividerStyleOf(makeEl({ id: 'd', type: 'divider', data: { strokeStyle: 'dotted' } })),
    ).toBe('dotted');
    expect(
      dividerStyleOf(makeEl({ id: 'd', type: 'divider', data: { strokeStyle: 'wiggly' } })),
    ).toBe('solid');
  });

  it('dividerStrokeOf defaults to 1, reads data.strokeWidth, clamps to [1,16]', () => {
    expect(dividerStrokeOf(makeEl({ id: 'd', type: 'divider' }))).toBe(1);
    expect(dividerStrokeOf(makeEl({ id: 'd', type: 'divider', data: { strokeWidth: 4 } }))).toBe(4);
    expect(dividerStrokeOf(makeEl({ id: 'd', type: 'divider', data: { strokeWidth: 0 } }))).toBe(1);
    expect(dividerStrokeOf(makeEl({ id: 'd', type: 'divider', data: { strokeWidth: 999 } }))).toBe(
      16,
    );
    expect(dividerStrokeOf(makeEl({ id: 'd', type: 'divider', data: { strokeWidth: 3.7 } }))).toBe(
      4,
    );
    expect(
      dividerStrokeOf(makeEl({ id: 'd', type: 'divider', data: { strokeWidth: 'junk' } })),
    ).toBe(1);
  });

  it('COLOR_PRESETS contains 11 hex values starting with #', () => {
    expect(COLOR_PRESETS.length).toBe(11);
    for (const c of COLOR_PRESETS) {
      expect(c.startsWith('#')).toBe(true);
      expect(/^#[0-9a-f]{6}$/i.test(c)).toBe(true);
    }
  });
});

describe('InspectorPanelComponent', () => {
  let fixture: ComponentFixture<InspectorPanelComponent>;
  let cmp: InspectorPanelComponent;
  let editorSvc: jasmine.SpyObj<EditorElementEditorService>;
  let inspSvc: jasmine.SpyObj<EditorInspectorService>;
  let panelsSvc: jasmine.SpyObj<EditorPanelsService>;
  let sessionStub: {
    tid: ReturnType<typeof signal<string>>;
    pid: ReturnType<typeof signal<string>>;
    setGridConfig: jasmine.Spy;
  };

  beforeEach(async () => {
    editorSvc = jasmine.createSpyObj<EditorElementEditorService>('EditorElementEditorService', [
      'updateSelected',
      'setHeadingLevel',
      'setColor',
      'clearColor',
      'duplicateSelected',
      'deleteSelected',
    ]);
    editorSvc.setHeadingLevel.and.returnValue(Promise.resolve());
    editorSvc.setColor.and.returnValue(Promise.resolve());
    editorSvc.clearColor.and.returnValue(Promise.resolve());
    editorSvc.duplicateSelected.and.returnValue(Promise.resolve(null));
    editorSvc.deleteSelected.and.returnValue(Promise.resolve());

    inspSvc = jasmine.createSpyObj<EditorInspectorService>('EditorInspectorService', [
      'setIconName',
      'setButtonVariant',
      'setDividerOrientation',
      'setDividerStroke',
      'setDividerStyle',
      'setBorderStyle',
      'setFontFamily',
      'setFontSize',
      'setChecked',
      'setTextAlign',
      'toggleItalic',
      'toggleUnderline',
      'removeImage',
    ]);
    for (const m of [
      inspSvc.setIconName,
      inspSvc.setButtonVariant,
      inspSvc.setDividerOrientation,
      inspSvc.setDividerStroke,
      inspSvc.setDividerStyle,
      inspSvc.setBorderStyle,
      inspSvc.setFontFamily,
      inspSvc.setFontSize,
      inspSvc.setChecked,
      inspSvc.setTextAlign,
      inspSvc.toggleItalic,
      inspSvc.toggleUnderline,
      inspSvc.removeImage,
    ]) {
      m.and.returnValue(Promise.resolve());
    }

    panelsSvc = jasmine.createSpyObj<EditorPanelsService>('EditorPanelsService', [
      'setLeftPanel',
      'toggleRight',
    ]);

    sessionStub = {
      tid: signal(TID),
      pid: signal(PID),
      setGridConfig: jasmine.createSpy('setGridConfig').and.returnValue(Promise.resolve()),
    };

    await TestBed.configureTestingModule({
      imports: [InspectorPanelComponent],
      providers: [
        { provide: EditorElementEditorService, useValue: editorSvc },
        { provide: EditorInspectorService, useValue: inspSvc },
        { provide: EditorPanelsService, useValue: panelsSvc },
        { provide: EditorSessionService, useValue: sessionStub },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(InspectorPanelComponent);
    cmp = fixture.componentInstance;
    fixture.componentRef.setInput('gridConfig', { ...GRID });
    fixture.detectChanges();
  });

  function setSelected(el: IWireElement | null): void {
    fixture.componentRef.setInput('selected', el);
    fixture.detectChanges();
  }

  it('renders empty state and grid-settings when nothing is selected', () => {
    setSelected(null);
    const empty = fixture.nativeElement.querySelector('.empty-inspector');
    const gridSettings = fixture.nativeElement.querySelector('mt-grid-settings');
    expect(empty).not.toBeNull();
    expect(gridSettings).not.toBeNull();
  });

  it('renders type tag in header when an element is selected', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    const tag = fixture.nativeElement.querySelector('.panel-head .tag') as HTMLElement;
    expect(tag.textContent?.trim()).toBe('rect');
  });

  it('shows text input for types with hasTextField (button)', () => {
    setSelected(makeEl({ id: 'a', type: 'button', text: 'Go' }));
    const input = fixture.nativeElement.querySelector(
      '[data-testid="inspect-text"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('Go');
  });

  it('hides text input for divider/image/rect', () => {
    setSelected(makeEl({ id: 'a', type: 'divider' }));
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-text"]')).toBeNull();
    setSelected(makeEl({ id: 'a', type: 'image' }));
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-text"]')).toBeNull();
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-text"]')).toBeNull();
  });

  it('shows heading level chooser only for heading', () => {
    setSelected(makeEl({ id: 'a', type: 'heading', level: 2 }));
    expect(fixture.nativeElement.querySelector('[data-testid="level-2"]')).not.toBeNull();
    const active = fixture.nativeElement.querySelector('[data-testid="level-2"]') as HTMLElement;
    expect(active.classList.contains('active')).toBe(true);
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    expect(fixture.nativeElement.querySelector('[data-testid="level-1"]')).toBeNull();
  });

  it('shows color picker for textual, divider, and bordered types', () => {
    setSelected(makeEl({ id: 'a', type: 'text' }));
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-color"]')).not.toBeNull();
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-color"]')).not.toBeNull();
    setSelected(makeEl({ id: 'a', type: 'image' }));
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-color"]')).toBeNull();
  });

  it('shows button variant segment for button', () => {
    setSelected(makeEl({ id: 'a', type: 'button', variant: 'secondary' }));
    const sec = fixture.nativeElement.querySelector('[data-testid="btn-secondary"]') as HTMLElement;
    expect(sec.classList.contains('active')).toBe(true);
  });

  it('shows divider orientation segment only for divider', () => {
    setSelected(makeEl({ id: 'a', type: 'divider', variant: 'v' }));
    const v = fixture.nativeElement.querySelector('[data-testid="divider-v"]') as HTMLElement;
    expect(v.classList.contains('active')).toBe(true);
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    expect(fixture.nativeElement.querySelector('[data-testid="divider-h"]')).toBeNull();
  });

  it('renders position, size, rotation fields for any selection', () => {
    setSelected(makeEl({ id: 'a', type: 'rect', x: 50, y: 75, w: 200, h: 120, rotation: 45 }));
    const rotation = fixture.nativeElement.querySelector(
      '[data-testid="inspect-rotation"]',
    ) as HTMLInputElement;
    expect(rotation.value).toBe('45');
    const numberInputs = fixture.nativeElement.querySelectorAll('input[type="number"]');
    expect(numberInputs.length).toBe(4);
  });

  it('updates text via service on text input', () => {
    setSelected(makeEl({ id: 'a', type: 'text' }));
    const input = fixture.nativeElement.querySelector(
      '[data-testid="inspect-text"]',
    ) as HTMLInputElement;
    input.value = 'Hello';
    input.dispatchEvent(new Event('input'));
    expect(editorSvc.updateSelected).toHaveBeenCalledWith(TID, PID, { text: 'Hello' });
  });

  it('parses and clamps numeric inputs before calling updateSelected', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    const inputs = fixture.nativeElement.querySelectorAll(
      'input[type="number"]',
    ) as NodeListOf<HTMLInputElement>;
    inputs[0].value = '99';
    inputs[0].dispatchEvent(new Event('input'));
    expect(editorSvc.updateSelected).toHaveBeenCalledWith(TID, PID, { x: 99 });
    inputs[3].value = '5';
    inputs[3].dispatchEvent(new Event('input'));
    expect(editorSvc.updateSelected).toHaveBeenCalledWith(TID, PID, { h: 5 });
  });

  it('clamps width below 1 to 1, and rejects non-finite values', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    const inputs = fixture.nativeElement.querySelectorAll(
      'input[type="number"]',
    ) as NodeListOf<HTMLInputElement>;
    inputs[2].value = '-500';
    inputs[2].dispatchEvent(new Event('input'));
    expect(editorSvc.updateSelected).toHaveBeenCalledWith(TID, PID, { w: 1 });
    editorSvc.updateSelected.calls.reset();
    inputs[2].value = '';
    inputs[2].dispatchEvent(new Event('input'));
    expect(editorSvc.updateSelected).not.toHaveBeenCalled();
  });

  it('normalizes rotation values into [0, 360) before calling updateSelected', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    cmp.onNumber('rotation', '450');
    expect(editorSvc.updateSelected).toHaveBeenCalledWith(TID, PID, { rotation: 90 });
    cmp.onNumber('rotation', '-30');
    expect(editorSvc.updateSelected).toHaveBeenCalledWith(TID, PID, { rotation: 330 });
  });

  it('calls setHeadingLevel on level button click', () => {
    setSelected(makeEl({ id: 'a', type: 'heading', level: 1 }));
    const btn = fixture.nativeElement.querySelector('[data-testid="level-3"]') as HTMLElement;
    btn.click();
    expect(editorSvc.setHeadingLevel).toHaveBeenCalledWith(TID, PID, '3');
  });

  it('calls setColor when preset swatch is clicked', () => {
    setSelected(makeEl({ id: 'a', type: 'text' }));
    const preset = fixture.nativeElement.querySelector(
      '[data-testid="preset-ef4444"]',
    ) as HTMLElement;
    preset.click();
    expect(editorSvc.setColor).toHaveBeenCalledWith(TID, PID, '#ef4444');
  });

  it('calls clearColor when clear button is clicked', () => {
    setSelected(makeEl({ id: 'a', type: 'text', color: '#ff00aa' }));
    const clear = fixture.nativeElement.querySelector('.color-row .btn.ghost') as HTMLElement;
    clear.click();
    expect(editorSvc.clearColor).toHaveBeenCalledWith(TID, PID);
  });

  it('calls clearColor when "no color" chip is clicked', () => {
    setSelected(makeEl({ id: 'a', type: 'text' }));
    const noneChip = fixture.nativeElement.querySelector('.palette-chip.none') as HTMLElement;
    noneChip.click();
    expect(editorSvc.clearColor).toHaveBeenCalledWith(TID, PID);
  });

  it('calls setButtonVariant when a variant is clicked', () => {
    setSelected(makeEl({ id: 'a', type: 'button' }));
    const tertiary = fixture.nativeElement.querySelector(
      '[data-testid="btn-tertiary"]',
    ) as HTMLElement;
    tertiary.click();
    expect(inspSvc.setButtonVariant).toHaveBeenCalledWith(TID, PID, 'tertiary');
  });

  it('calls setDividerOrientation when an orientation is clicked', () => {
    setSelected(makeEl({ id: 'a', type: 'divider' }));
    const vbtn = fixture.nativeElement.querySelector('[data-testid="divider-v"]') as HTMLElement;
    vbtn.click();
    expect(inspSvc.setDividerOrientation).toHaveBeenCalledWith(TID, PID, 'v');
  });

  it('calls setDividerStroke (clamped + rounded) when stroke slider changes', () => {
    setSelected(makeEl({ id: 'a', type: 'divider' }));
    const slider = fixture.nativeElement.querySelector(
      '[data-testid="divider-stroke"]',
    ) as HTMLInputElement;
    slider.value = '7';
    slider.dispatchEvent(new Event('input'));
    expect(inspSvc.setDividerStroke).toHaveBeenCalledWith(TID, PID, 7);
    slider.value = '9999';
    slider.dispatchEvent(new Event('input'));
    expect(inspSvc.setDividerStroke).toHaveBeenCalledWith(TID, PID, 16);
    slider.value = '0';
    slider.dispatchEvent(new Event('input'));
    expect(inspSvc.setDividerStroke).toHaveBeenCalledWith(TID, PID, 1);
  });

  it('hides stroke slider for non-divider elements', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    expect(fixture.nativeElement.querySelector('[data-testid="divider-stroke"]')).toBeNull();
  });

  it('calls setDividerStyle when style button clicked', () => {
    setSelected(makeEl({ id: 'a', type: 'divider' }));
    (
      fixture.nativeElement.querySelector('[data-testid="divider-style-dashed"]') as HTMLElement
    ).click();
    expect(inspSvc.setDividerStyle).toHaveBeenCalledWith(TID, PID, 'dashed');
    (
      fixture.nativeElement.querySelector('[data-testid="divider-style-dotted"]') as HTMLElement
    ).click();
    expect(inspSvc.setDividerStyle).toHaveBeenCalledWith(TID, PID, 'dotted');
  });

  it('shows color picker for divider', () => {
    setSelected(makeEl({ id: 'a', type: 'divider' }));
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-color"]')).not.toBeNull();
  });

  it('shows Border style + Border color for rect and card', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    expect(
      fixture.nativeElement.querySelector('[data-testid="border-style-solid"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-color"]')).not.toBeNull();
    setSelected(makeEl({ id: 'b', type: 'card' }));
    expect(
      fixture.nativeElement.querySelector('[data-testid="border-style-dashed"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-color"]')).not.toBeNull();
  });

  it('shows checked/unchecked seg for checkbox/toggle and calls setChecked', () => {
    setSelected(makeEl({ id: 'a', type: 'checkbox' }));
    const onBtn = fixture.nativeElement.querySelector('[data-testid="checked-on"]') as HTMLElement;
    const offBtn = fixture.nativeElement.querySelector(
      '[data-testid="checked-off"]',
    ) as HTMLElement;
    expect(onBtn.classList.contains('active')).toBe(true);
    offBtn.click();
    expect(inspSvc.setChecked).toHaveBeenCalledWith(TID, PID, false);
    setSelected(makeEl({ id: 'a', type: 'toggle', data: { checked: false } }));
    expect(
      (
        fixture.nativeElement.querySelector('[data-testid="checked-off"]') as HTMLElement
      ).classList.contains('active'),
    ).toBe(true);
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    expect(fixture.nativeElement.querySelector('[data-testid="checked-on"]')).toBeNull();
  });

  it('shows font size picker for text/link/list and calls setFontSize', () => {
    setSelected(makeEl({ id: 'a', type: 'text' }));
    const select = fixture.nativeElement.querySelector(
      '[data-testid="font-size"]',
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    select.value = 'lg';
    select.dispatchEvent(new Event('change'));
    expect(inspSvc.setFontSize).toHaveBeenCalledWith(TID, PID, 'lg');
    setSelected(makeEl({ id: 'a', type: 'heading' }));
    expect(fixture.nativeElement.querySelector('[data-testid="font-size"]')).toBeNull();
  });

  it('shows icon picker only for icon type and calls setIconName', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    expect(fixture.nativeElement.querySelector('mt-icon-picker')).toBeNull();
    setSelected(makeEl({ id: 'a', type: 'icon' }));
    expect(fixture.nativeElement.querySelector('mt-icon-picker')).not.toBeNull();
    cmp.onIconName('heart');
    expect(inspSvc.setIconName).toHaveBeenCalledWith(TID, PID, 'heart');
  });

  it('shows Background color label for tag', () => {
    setSelected(makeEl({ id: 'a', type: 'tag' }));
    expect(fixture.nativeElement.querySelector('[data-testid="inspect-color"]')).not.toBeNull();
    const labels = Array.from(
      fixture.nativeElement.querySelectorAll('.field label'),
    ) as HTMLElement[];
    expect(labels.some((l) => l.textContent?.includes('Background color'))).toBe(true);
  });

  it('calls setBorderStyle when style button clicked (rect/card)', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    (
      fixture.nativeElement.querySelector('[data-testid="border-style-dotted"]') as HTMLElement
    ).click();
    expect(inspSvc.setBorderStyle).toHaveBeenCalledWith(TID, PID, 'dotted');
  });

  it('hides border style for non-bordered types (divider/text/button)', () => {
    setSelected(makeEl({ id: 'a', type: 'divider' }));
    expect(fixture.nativeElement.querySelector('[data-testid="border-style-solid"]')).toBeNull();
    setSelected(makeEl({ id: 'b', type: 'text' }));
    expect(fixture.nativeElement.querySelector('[data-testid="border-style-solid"]')).toBeNull();
  });

  it('shows Font + Alignment + Style for text and heading', () => {
    setSelected(makeEl({ id: 'a', type: 'text' }));
    expect(fixture.nativeElement.querySelector('[data-testid="font-family"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="align-center"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="text-italic"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="text-underline"]')).not.toBeNull();
    setSelected(makeEl({ id: 'b', type: 'heading' }));
    expect(fixture.nativeElement.querySelector('[data-testid="font-family"]')).not.toBeNull();
  });

  it('hides rich-text controls for non-text types', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    expect(fixture.nativeElement.querySelector('[data-testid="font-family"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="align-left"]')).toBeNull();
  });

  it('calls setFontFamily (null for empty), setTextAlign, toggleItalic, toggleUnderline', () => {
    setSelected(makeEl({ id: 'a', type: 'text' }));
    const sel = fixture.nativeElement.querySelector(
      '[data-testid="font-family"]',
    ) as HTMLSelectElement;
    sel.value = 'Inter';
    sel.dispatchEvent(new Event('change'));
    expect(inspSvc.setFontFamily).toHaveBeenCalledWith(TID, PID, 'Inter');
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    expect(inspSvc.setFontFamily).toHaveBeenCalledWith(TID, PID, null);
    (fixture.nativeElement.querySelector('[data-testid="align-right"]') as HTMLElement).click();
    expect(inspSvc.setTextAlign).toHaveBeenCalledWith(TID, PID, 'right');
    (fixture.nativeElement.querySelector('[data-testid="text-italic"]') as HTMLElement).click();
    expect(inspSvc.toggleItalic).toHaveBeenCalledWith(TID, PID);
    (fixture.nativeElement.querySelector('[data-testid="text-underline"]') as HTMLElement).click();
    expect(inspSvc.toggleUnderline).toHaveBeenCalledWith(TID, PID);
  });

  it('calls duplicateSelected and deleteSelected on action buttons', () => {
    setSelected(makeEl({ id: 'a', type: 'rect' }));
    const buttons = fixture.nativeElement.querySelectorAll(
      '.inspector-actions .btn',
    ) as NodeListOf<HTMLElement>;
    buttons[0].click();
    buttons[1].click();
    expect(editorSvc.duplicateSelected).toHaveBeenCalledWith(TID, PID);
    expect(editorSvc.deleteSelected).toHaveBeenCalledWith(TID, PID);
  });

  it('calls toggleRight on collapse button', () => {
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="collapse-right"]',
    ) as HTMLElement;
    btn.click();
    expect(panelsSvc.toggleRight).toHaveBeenCalled();
  });

  it('opens images panel on Replace image click', () => {
    setSelected(makeEl({ id: 'a', type: 'image' }));
    const btn = fixture.nativeElement.querySelector('[data-testid="image-replace"]') as HTMLElement;
    btn.click();
    expect(panelsSvc.setLeftPanel).toHaveBeenCalledWith('images');
  });

  it('calls removeImage on Remove click for selected image', () => {
    setSelected(
      makeEl({
        id: 'a',
        type: 'image',
        data: {
          image: {
            src: 'x',
            thumb: 'x',
            source: 'unsplash',
            photographer: 'p',
            photographerUrl: 'u',
          },
        },
      }),
    );
    const btn = fixture.nativeElement.querySelector('[data-testid="image-remove"]') as HTMLElement;
    btn.click();
    expect(inspSvc.removeImage).toHaveBeenCalledWith(TID, PID);
  });

  it('forwards gridConfigChange via session.setGridConfig when nothing selected', () => {
    setSelected(null);
    const next: IGridConfig = { ...GRID, visible: true };
    cmp.onGridConfigChange(next);
    expect(sessionStub.setGridConfig).toHaveBeenCalledWith(next);
  });

  it('applies .collapsed class and aria-hidden when collapsed=true', () => {
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('[data-testid="inspector"]') as HTMLElement;
    expect(panel.classList.contains('collapsed')).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('wraps pure helpers via instance methods', () => {
    expect(cmp.isTextual('text')).toBe(true);
    expect(cmp.hasTextField('image')).toBe(false);
    expect(cmp.buttonVariantOf(makeEl({ id: 'a', type: 'button', variant: 'secondary' }))).toBe(
      'secondary',
    );
    expect(cmp.dividerOrientation(makeEl({ id: 'a', type: 'divider', variant: 'v' }))).toBe('v');
  });

  it('shows "no color" chip active when selected has no color', () => {
    setSelected(makeEl({ id: 'a', type: 'text' }));
    const noneChip = fixture.nativeElement.querySelector('.palette-chip.none') as HTMLElement;
    expect(noneChip.classList.contains('active')).toBe(true);
  });

  it('shows color preset chip active when matching selected.color', () => {
    setSelected(makeEl({ id: 'a', type: 'text', color: '#ef4444' }));
    const preset = fixture.nativeElement.querySelector(
      '[data-testid="preset-ef4444"]',
    ) as HTMLElement;
    expect(preset.classList.contains('active')).toBe(true);
  });
});
