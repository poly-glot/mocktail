import { TestBed } from '@angular/core/testing';
import { CollabService } from '@mocktail/collab';
import { IWireElement } from '@mocktail/projects';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorSelectionService } from '../selection/selection.service';
import { EditorInspectorService } from './inspector.service';

function el(id: string, overrides: Partial<IWireElement> = {}): IWireElement {
  return {
    id,
    type: 'text',
    x: 0,
    y: 0,
    w: 100,
    h: 30,
    rotation: 0,
    zIndex: 0,
    ...overrides,
  } as IWireElement;
}

describe('EditorInspectorService', () => {
  let svc: EditorInspectorService;
  let sel: EditorSelectionService;
  let state: EditorElementsStateService;
  let sendEdit: jasmine.Spy;

  beforeEach(() => {
    sendEdit = jasmine.createSpy('sendEdit');
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CollabService,
          useValue: {
            sendEdit,
            flushPendingEdits: jasmine.createSpy('flushPendingEdits'),
          } as Partial<CollabService>,
        },
      ],
    });
    svc = TestBed.inject(EditorInspectorService);
    sel = TestBed.inject(EditorSelectionService);
    state = TestBed.inject(EditorElementsStateService);
  });

  function seed(e: IWireElement): void {
    state.list.set([e]);
    sel.setPrimary(e.id);
  }

  function lastPatchSent(): Partial<IWireElement> {
    return sendEdit.calls.mostRecent().args[1];
  }

  describe('no selection', () => {
    it('all setters are no-ops when nothing is selected', async () => {
      await svc.setIconName('home');
      await svc.setButtonVariant('secondary');
      await svc.setFontSize('md');
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('setIconName', () => {
    it('patches data.iconName on icon elements', async () => {
      seed(el('a', { type: 'icon', data: { iconName: 'smile' } } as Partial<IWireElement>));
      await svc.setIconName('home');
      expect((lastPatchSent().data as Record<string, unknown>)['iconName']).toBe('home');
    });

    it('ignores non-icon elements', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setIconName('home');
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('skips when value is unchanged', async () => {
      seed(el('a', { type: 'icon', data: { iconName: 'home' } } as Partial<IWireElement>));
      await svc.setIconName('home');
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('setButtonVariant', () => {
    it('patches variant on button elements', async () => {
      seed(el('a', { type: 'button' }));
      await svc.setButtonVariant('secondary');
      expect(lastPatchSent().variant).toBe('secondary');
    });

    it('ignores non-button elements', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setButtonVariant('secondary');
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('skips when variant is unchanged', async () => {
      seed(el('a', { type: 'button', variant: 'secondary' } as Partial<IWireElement>));
      await svc.setButtonVariant('secondary');
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('setDividerOrientation', () => {
    it('flips a horizontal divider to vertical preserving the center', async () => {
      seed(
        el('d', {
          type: 'divider',
          x: 0,
          y: 100,
          w: 200,
          h: 1,
          variant: 'h',
        } as Partial<IWireElement>),
      );
      await svc.setDividerOrientation('v');
      const p = lastPatchSent();
      expect(p.variant).toBe('v');
      expect(p.w).toBe(1);
      expect(p.h).toBe(200);
      expect(p.x).toBe(100);
      expect(p.y).toBe(1);
    });

    it('ignores non-divider elements', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setDividerOrientation('v');
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('skips when orientation is unchanged', async () => {
      seed(el('d', { type: 'divider', variant: 'h' } as Partial<IWireElement>));
      await svc.setDividerOrientation('h');
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('setDividerStroke / setDividerStyle', () => {
    it('patches strokeWidth on a divider', async () => {
      seed(el('d', { type: 'divider', data: { strokeWidth: 1 } } as Partial<IWireElement>));
      await svc.setDividerStroke(4);
      expect((lastPatchSent().data as Record<string, unknown>)['strokeWidth']).toBe(4);
    });

    it('patches strokeStyle on a divider', async () => {
      seed(el('d', { type: 'divider' } as Partial<IWireElement>));
      await svc.setDividerStyle('dashed');
      expect((lastPatchSent().data as Record<string, unknown>)['strokeStyle']).toBe('dashed');
    });

    it('skips setDividerStroke on non-divider elements', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setDividerStroke(4);
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('skips setDividerStyle on non-divider elements', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setDividerStyle('dashed');
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('skips setDividerStroke when value is unchanged', async () => {
      seed(el('d', { type: 'divider', data: { strokeWidth: 4 } } as Partial<IWireElement>));
      await svc.setDividerStroke(4);
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('skips setDividerStyle when value is unchanged', async () => {
      seed(el('d', { type: 'divider', data: { strokeStyle: 'dashed' } } as Partial<IWireElement>));
      await svc.setDividerStyle('dashed');
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('setBorderStyle', () => {
    it('patches borderStyle on a bordered element', async () => {
      seed(el('a', { type: 'rect' } as Partial<IWireElement>));
      await svc.setBorderStyle('dashed');
      expect((lastPatchSent().data as Record<string, unknown>)['borderStyle']).toBe('dashed');
    });

    it('skips when element type has no border', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setBorderStyle('dashed');
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('setFontFamily', () => {
    it('sets a font family when rich text', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setFontFamily('Inter');
      expect((lastPatchSent().data as Record<string, unknown>)['fontFamily']).toBe('Inter');
    });

    it('removes the font family when given null', async () => {
      seed(el('a', { type: 'text', data: { fontFamily: 'Inter' } } as Partial<IWireElement>));
      await svc.setFontFamily(null);
      const data = lastPatchSent().data as Record<string, unknown>;
      expect('fontFamily' in data).toBeFalse();
    });

    it('skips when family is unchanged', async () => {
      seed(el('a', { type: 'text', data: { fontFamily: 'Inter' } } as Partial<IWireElement>));
      await svc.setFontFamily('Inter');
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('ignores non-rich-text elements', async () => {
      seed(el('a', { type: 'icon' } as Partial<IWireElement>));
      await svc.setFontFamily('Inter');
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('setFontSize', () => {
    it('patches data.fontSize', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setFontSize('lg');
      expect((lastPatchSent().data as Record<string, unknown>)['fontSize']).toBe('lg');
    });

    it('ignores elements without fontSize support', async () => {
      seed(el('a', { type: 'icon' } as Partial<IWireElement>));
      await svc.setFontSize('lg');
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('skips when size is unchanged', async () => {
      seed(el('a', { type: 'text', data: { fontSize: 'lg' } } as Partial<IWireElement>));
      await svc.setFontSize('lg');
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('setChecked', () => {
    it('patches data.checked on checkbox-capable elements', async () => {
      seed(el('a', { type: 'checkbox', data: { checked: true } } as Partial<IWireElement>));
      await svc.setChecked(false);
      expect((lastPatchSent().data as Record<string, unknown>)['checked']).toBeFalse();
    });

    it('ignores elements without checked state', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setChecked(true);
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('skips when checked is unchanged', async () => {
      seed(el('a', { type: 'checkbox', data: { checked: true } } as Partial<IWireElement>));
      await svc.setChecked(true);
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('setTextAlign', () => {
    it('patches data.textAlign on rich-text elements', async () => {
      seed(el('a', { type: 'text' }));
      await svc.setTextAlign('center');
      expect((lastPatchSent().data as Record<string, unknown>)['textAlign']).toBe('center');
    });

    it('ignores non-rich-text elements', async () => {
      seed(el('a', { type: 'icon' } as Partial<IWireElement>));
      await svc.setTextAlign('center');
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('skips when align is unchanged', async () => {
      seed(el('a', { type: 'text', data: { textAlign: 'center' } } as Partial<IWireElement>));
      await svc.setTextAlign('center');
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });

  describe('toggleItalic / toggleUnderline', () => {
    it('flips italic on a rich-text element', async () => {
      seed(el('a', { type: 'text' }));
      await svc.toggleItalic();
      expect((lastPatchSent().data as Record<string, unknown>)['italic']).toBeTrue();
    });

    it('flips underline on a rich-text element', async () => {
      seed(el('a', { type: 'text', data: { underline: true } } as Partial<IWireElement>));
      await svc.toggleUnderline();
      expect((lastPatchSent().data as Record<string, unknown>)['underline']).toBeFalse();
    });

    it('toggleItalic ignores non-rich-text elements', async () => {
      seed(el('a', { type: 'icon' } as Partial<IWireElement>));
      await svc.toggleItalic();
      expect(sendEdit).not.toHaveBeenCalled();
    });

    it('toggleUnderline ignores non-rich-text elements', async () => {
      seed(el('a', { type: 'icon' } as Partial<IWireElement>));
      await svc.toggleUnderline();
      expect(sendEdit).not.toHaveBeenCalled();
    });
  });
});
