import { TestBed } from '@angular/core/testing';
import { IWireElement } from '@mocktail/projects';
import { EditorClipboardService } from './clipboard.service';

function el(partial: Partial<IWireElement> = {}): IWireElement {
  return {
    id: 'el_1',
    pageId: 'pg1',
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    zIndex: 1,
    ...partial,
  } as IWireElement;
}

describe('EditorClipboardService', () => {
  let svc: EditorClipboardService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(EditorClipboardService);
  });

  it('starts empty; canPaste is false and peek returns null', () => {
    expect(svc.canPaste()).toBeFalse();
    expect(svc.peek()).toBeNull();
  });

  it('put stores a shallow clone that can be peeked', () => {
    const a = el({ id: 'a' });
    svc.put(a);
    expect(svc.canPaste()).toBeTrue();
    const got = svc.peek();
    expect(got?.id).toBe('a');
    expect(got).not.toBe(a);
  });

  it('put overwrites the previous value', () => {
    svc.put(el({ id: 'a' }));
    svc.put(el({ id: 'b' }));
    expect(svc.peek()?.id).toBe('b');
  });

  it('clear empties the clipboard and flips canPaste back to false', () => {
    svc.put(el());
    svc.clear();
    expect(svc.peek()).toBeNull();
    expect(svc.canPaste()).toBeFalse();
  });
});
