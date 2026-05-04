import { TestBed } from '@angular/core/testing';
import { EditorContextMenuService } from './context-menu.service';

describe('EditorContextMenuService', () => {
  let svc: EditorContextMenuService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(EditorContextMenuService);
  });

  it('starts closed', () => {
    expect(svc.menu()).toBeNull();
    expect(svc.isOpenFor('anything')).toBeFalse();
  });

  it('openAt records position and element id', () => {
    svc.openAt(120, 80, 'el_1');
    expect(svc.menu()).toEqual({ x: 120, y: 80, elId: 'el_1' });
    expect(svc.isOpenFor('el_1')).toBeTrue();
    expect(svc.isOpenFor('el_2')).toBeFalse();
  });

  it('openAt replaces any previous state', () => {
    svc.openAt(10, 10, 'a');
    svc.openAt(50, 60, 'b');
    expect(svc.menu()?.elId).toBe('b');
    expect(svc.menu()?.x).toBe(50);
  });

  it('close clears the menu state', () => {
    svc.openAt(0, 0, 'a');
    svc.close();
    expect(svc.menu()).toBeNull();
    expect(svc.isOpenFor('a')).toBeFalse();
  });
});
