import { TestBed } from '@angular/core/testing';
import { EditorSelectionService } from './selection.service';

describe('EditorSelectionService', () => {
  let svc: EditorSelectionService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(EditorSelectionService);
  });

  it('defaults to empty selection and no marquee', () => {
    expect(svc.selectedId()).toBeNull();
    expect(svc.extraSelectedIds().size).toBe(0);
    expect(svc.marqueeRect()).toBeNull();
    expect(svc.selectionCount()).toBe(0);
    expect(svc.allSelectedIdSet().size).toBe(0);
  });

  it('allSelectedIdSet merges primary into extras', () => {
    svc.setSelection('a', new Set(['b', 'c']));
    const merged = svc.allSelectedIdSet();
    expect(merged.has('a')).toBeTrue();
    expect(merged.has('b')).toBeTrue();
    expect(merged.has('c')).toBeTrue();
    expect(svc.selectionCount()).toBe(3);
  });

  it('allSelectedIdSet returns extras unchanged if primary is already in extras', () => {
    svc.setSelection('a', new Set(['a', 'b']));
    expect(svc.allSelectedIdSet().size).toBe(2);
  });

  it('allSelectedIdSet returns empty extras when primary is null and extras empty', () => {
    expect(svc.allSelectedIdSet().size).toBe(0);
  });

  it('isSelected matches primary and extras', () => {
    svc.setSelection('a', new Set(['b']));
    expect(svc.isSelected('a')).toBeTrue();
    expect(svc.isSelected('b')).toBeTrue();
    expect(svc.isSelected('c')).toBeFalse();
  });

  it('clear resets primary and extras', () => {
    svc.setSelection('a', new Set(['b']));
    svc.clear();
    expect(svc.selectedId()).toBeNull();
    expect(svc.extraSelectedIds().size).toBe(0);
  });

  it('setPrimary + setExtras independent mutators', () => {
    svc.setPrimary('x');
    svc.setExtras(new Set(['y', 'z']));
    expect(svc.selectedId()).toBe('x');
    expect(svc.extraSelectedIds().size).toBe(2);
  });

  it('setMarquee stores and clears a rect', () => {
    svc.setMarquee({ x: 1, y: 2, w: 3, h: 4 });
    expect(svc.marqueeRect()).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    svc.setMarquee(null);
    expect(svc.marqueeRect()).toBeNull();
  });

  describe('toggleInSelection', () => {
    it('selects an id when nothing is selected and notifies primary change', () => {
      const spy = jasmine.createSpy('onPrimaryChanged');
      svc.toggleInSelection('a', spy);
      expect(svc.selectedId()).toBe('a');
      expect(spy).toHaveBeenCalledWith('a');
    });

    it('toggling the primary with no extras clears selection and notifies null', () => {
      const spy = jasmine.createSpy('onPrimaryChanged');
      svc.setPrimary('a');
      svc.toggleInSelection('a', spy);
      expect(svc.selectedId()).toBeNull();
      expect(svc.extraSelectedIds().size).toBe(0);
      expect(spy).toHaveBeenCalledWith(null);
    });

    it('toggling the primary with extras promotes one extra to primary', () => {
      const spy = jasmine.createSpy('onPrimaryChanged');
      svc.setSelection('a', new Set(['b', 'c']));
      svc.toggleInSelection('a', spy);
      expect(['b', 'c']).toContain(svc.selectedId()!);
      expect(svc.extraSelectedIds().size).toBe(1);
      expect(spy).toHaveBeenCalled();
    });

    it('toggling an extra removes it without notifying', () => {
      const spy = jasmine.createSpy('onPrimaryChanged');
      svc.setSelection('a', new Set(['b']));
      svc.toggleInSelection('b', spy);
      expect(svc.selectedId()).toBe('a');
      expect(svc.extraSelectedIds().has('b')).toBeFalse();
      expect(spy).not.toHaveBeenCalled();
    });

    it('adding an id when a primary exists puts it in extras without notifying', () => {
      const spy = jasmine.createSpy('onPrimaryChanged');
      svc.setPrimary('a');
      svc.toggleInSelection('b', spy);
      expect(svc.selectedId()).toBe('a');
      expect(svc.extraSelectedIds().has('b')).toBeTrue();
      expect(spy).not.toHaveBeenCalled();
    });

    it('works without a callback', () => {
      expect(() => svc.toggleInSelection('a')).not.toThrow();
      expect(svc.selectedId()).toBe('a');
    });
  });
});
