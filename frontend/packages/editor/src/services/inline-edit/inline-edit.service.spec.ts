import { TestBed } from '@angular/core/testing';
import { ElementType, IWireElement } from '@mocktail/projects';
import { EditorElementFactoryService } from '../element-factory/element-factory.service';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorInlineEditService } from './inline-edit.service';

function el(id: string, overrides: Partial<IWireElement> = {}): IWireElement {
  return {
    id,
    type: 'text' as ElementType,
    x: 0,
    y: 0,
    w: 100,
    h: 30,
    rotation: 0,
    zIndex: 0,
    ...overrides,
  } as IWireElement;
}

describe('EditorInlineEditService', () => {
  let svc: EditorInlineEditService;
  let patchSpy: jasmine.Spy;
  let defaultTextForSpy: jasmine.Spy;

  const TID = 't';
  const PID = 'p';

  beforeEach(() => {
    patchSpy = jasmine.createSpy('patch').and.resolveTo(undefined);
    defaultTextForSpy = jasmine.createSpy('defaultTextFor').and.returnValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: EditorElementsStateService,
          useValue: { patch: patchSpy } as Partial<EditorElementsStateService>,
        },
        {
          provide: EditorElementFactoryService,
          useValue: {
            defaultTextFor: defaultTextForSpy,
          } as Partial<EditorElementFactoryService>,
        },
      ],
    });
    svc = TestBed.inject(EditorInlineEditService);
  });

  describe('basic state', () => {
    it('starts with no id being edited', () => {
      expect(svc.editingId()).toBeNull();
      expect(svc.isEditing('any')).toBeFalse();
    });

    it('begin sets the editing id', () => {
      svc.begin('el_1');
      expect(svc.editingId()).toBe('el_1');
      expect(svc.isEditing('el_1')).toBeTrue();
      expect(svc.isEditing('el_2')).toBeFalse();
    });

    it('begin replaces any previous id', () => {
      svc.begin('a');
      svc.begin('b');
      expect(svc.editingId()).toBe('b');
    });

    it('stop clears the editing id', () => {
      svc.begin('a');
      svc.stop();
      expect(svc.editingId()).toBeNull();
      expect(svc.isEditing('a')).toBeFalse();
    });
  });

  describe('beginWithFocus', () => {
    let host: HTMLElement;

    beforeEach(() => {
      jasmine.clock().install();
      host = document.createElement('div');
      host.setAttribute('data-testid', 'inline-edit-el_x');
      host.contentEditable = 'true';
      host.textContent = 'Hello world';
      document.body.appendChild(host);
    });

    afterEach(() => {
      jasmine.clock().uninstall();
      if (host.parentNode) host.parentNode.removeChild(host);
    });

    it('sets editing id synchronously and focuses host + selects contents after microtask', () => {
      const focusSpy = spyOn(host, 'focus').and.callThrough();
      svc.beginWithFocus('el_x');
      expect(svc.editingId()).toBe('el_x');
      expect(focusSpy).not.toHaveBeenCalled();
      jasmine.clock().tick(1);
      expect(focusSpy).toHaveBeenCalled();
      const sel = window.getSelection();
      expect(sel).not.toBeNull();
      expect(sel!.rangeCount).toBeGreaterThan(0);
      const range = sel!.getRangeAt(0);
      expect(range.startContainer === host || host.contains(range.startContainer)).toBeTrue();
      expect(range.endContainer === host || host.contains(range.endContainer)).toBeTrue();
    });

    it('is a no-op (no focus) when host is not present', () => {
      if (host.parentNode) host.parentNode.removeChild(host);
      const focusSpy = spyOn(host, 'focus').and.callThrough();
      svc.beginWithFocus('el_x');
      jasmine.clock().tick(1);
      expect(focusSpy).not.toHaveBeenCalled();
    });

    it('is a no-op (no focus) when host is not contentEditable', () => {
      host.contentEditable = 'false';
      const focusSpy = spyOn(host, 'focus').and.callThrough();
      svc.beginWithFocus('el_x');
      jasmine.clock().tick(1);
      expect(focusSpy).not.toHaveBeenCalled();
    });
  });

  describe('commit', () => {
    let host: HTMLElement;

    beforeEach(() => {
      host = document.createElement('div');
      document.body.appendChild(host);
    });

    afterEach(() => {
      if (host.parentNode) host.parentNode.removeChild(host);
    });

    it('early-returns when not editing the given id', () => {
      const stopSpy = spyOn(svc, 'stop').and.callThrough();
      const element = el('a', { text: 'hi' });
      host.innerText = 'ignored';
      svc.commit(host, element, false, TID, PID);
      expect(stopSpy).not.toHaveBeenCalled();
      expect(patchSpy).not.toHaveBeenCalled();
    });

    describe('cancel path', () => {
      it('restores host.innerText to el.text when present and skips patch', () => {
        const element = el('a', { text: 'original' });
        svc.begin('a');
        host.innerText = 'user was typing';
        const stopSpy = spyOn(svc, 'stop').and.callThrough();

        svc.commit(host, element, true, TID, PID);

        expect(stopSpy).toHaveBeenCalled();
        expect(host.innerText).toBe('original');
        expect(patchSpy).not.toHaveBeenCalled();
      });

      it('falls back to factory.defaultTextFor when el.text is undefined', () => {
        const element = el('a', { type: 'heading' as ElementType, text: undefined });
        defaultTextForSpy.and.returnValue('Heading');
        svc.begin('a');
        host.innerText = 'typed';

        svc.commit(host, element, true, TID, PID);

        expect(defaultTextForSpy).toHaveBeenCalledWith('heading');
        expect(host.innerText).toBe('Heading');
        expect(patchSpy).not.toHaveBeenCalled();
      });

      it('falls back to empty string when both el.text and factory fallback are nullish', () => {
        const element = el('a', { type: 'rect' as ElementType, text: undefined });
        defaultTextForSpy.and.returnValue(undefined);
        svc.begin('a');
        host.innerText = 'typed';

        svc.commit(host, element, true, TID, PID);

        expect(host.innerText).toBe('');
        expect(patchSpy).not.toHaveBeenCalled();
      });
    });

    describe('commit (non-cancel) path', () => {
      it('patches with sanitized text (including \\r\\n -> \\n) when changed', () => {
        const element = el('a', { text: 'old' });
        svc.begin('a');
        // innerText setter differs per platform — use textContent + mock innerText getter
        Object.defineProperty(host, 'innerText', {
          configurable: true,
          value: 'line1\r\nline2',
        });

        svc.commit(host, element, false, TID, PID);

        expect(patchSpy).toHaveBeenCalledTimes(1);
        expect(patchSpy).toHaveBeenCalledWith(TID, PID, 'a', { text: 'line1\nline2' });
        expect(svc.editingId()).toBeNull();
      });

      it('does not call patch when sanitized text equals el.text, but still calls stop', () => {
        const element = el('a', { text: 'hello' });
        svc.begin('a');
        Object.defineProperty(host, 'innerText', {
          configurable: true,
          value: 'hello',
        });
        const stopSpy = spyOn(svc, 'stop').and.callThrough();

        svc.commit(host, element, false, TID, PID);

        expect(stopSpy).toHaveBeenCalled();
        expect(patchSpy).not.toHaveBeenCalled();
      });

      it('treats undefined el.text as empty string when comparing', () => {
        const element = el('a', { text: undefined });
        svc.begin('a');
        Object.defineProperty(host, 'innerText', {
          configurable: true,
          value: '',
        });

        svc.commit(host, element, false, TID, PID);

        expect(patchSpy).not.toHaveBeenCalled();
      });
    });
  });
});
