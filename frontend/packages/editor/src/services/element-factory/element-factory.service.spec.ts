import { TestBed } from '@angular/core/testing';
import { CollabService } from '@mocktail/collab';
import { IWireElement, ProjectApiService } from '@mocktail/projects';
import { IPaletteItem } from '../../components/palette/palette.component';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorElementFactoryService } from './element-factory.service';

function el(id: string, overrides: Partial<IWireElement> = {}): IWireElement {
  return {
    id,
    pageId: 'pg',
    type: 'rect',
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    zIndex: 0,
    ...overrides,
  } as IWireElement;
}

function palItem(overrides: Partial<IPaletteItem> = {}): IPaletteItem {
  return {
    type: 'rect',
    label: 'Rect',
    w: 200,
    h: 120,
    icon: 'square',
    ...overrides,
  };
}

describe('EditorElementFactoryService', () => {
  let svc: EditorElementFactoryService;
  let state: EditorElementsStateService;
  let sendEditSpy: jasmine.Spy;
  let flushSpy: jasmine.Spy;
  let writeActivitySpy: jasmine.Spy;

  beforeEach(() => {
    sendEditSpy = jasmine.createSpy('sendEdit');
    flushSpy = jasmine.createSpy('flushPendingEdits');
    writeActivitySpy = jasmine.createSpy('writeActivity').and.resolveTo(undefined);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ProjectApiService,
          useValue: {
            writeActivity: writeActivitySpy,
          } as Partial<ProjectApiService>,
        },
        {
          provide: CollabService,
          useValue: {
            sendEdit: sendEditSpy,
            flushPendingEdits: flushSpy,
          } as Partial<CollabService>,
        },
      ],
    });
    svc = TestBed.inject(EditorElementFactoryService);
    state = TestBed.inject(EditorElementsStateService);
  });

  function lastAppended(): IWireElement {
    const list = state.list();
    return list[list.length - 1];
  }

  describe('genId', () => {
    it('returns an id with the "el_" prefix and 20 hex chars', () => {
      const id = svc.genId();
      expect(id.startsWith('el_')).toBe(true);
      expect(id.length).toBe(3 + 20);
      expect(/^el_[0-9a-f]{20}$/.test(id)).toBe(true);
    });

    it('returns a different id on each call', () => {
      const a = svc.genId();
      const b = svc.genId();
      expect(a).not.toBe(b);
    });
  });

  describe('nextZIndex', () => {
    it('returns 1 for an empty list', () => {
      expect(svc.nextZIndex([])).toBe(1);
    });

    it('returns max zIndex + 1 for a populated list', () => {
      const list = [el('a', { zIndex: 2 }), el('b', { zIndex: 5 }), el('c', { zIndex: 3 })];
      expect(svc.nextZIndex(list)).toBe(6);
    });
  });

  describe('defaultTextFor', () => {
    it('returns the expected label for each textual type', () => {
      expect(svc.defaultTextFor('heading')).toBe('Heading');
      expect(svc.defaultTextFor('text')).toBe('Lorem ipsum dolor sit amet.');
      expect(svc.defaultTextFor('link')).toBe('Link text');
      expect(svc.defaultTextFor('button')).toBe('Button');
      expect(svc.defaultTextFor('input')).toBe('Placeholder');
      expect(svc.defaultTextFor('tag')).toBe('Tag');
      expect(svc.defaultTextFor('card')).toBe('Card');
    });

    it('returns undefined for non-textual types', () => {
      expect(svc.defaultTextFor('rect')).toBeUndefined();
      expect(svc.defaultTextFor('image')).toBeUndefined();
      // Unknown/unmapped types cast via the ElementType union fallback.
      expect(svc.defaultTextFor('circle')).toBeUndefined();
    });
  });

  describe('initialProps', () => {
    it('returns {level: 1} for heading', () => {
      expect(svc.initialProps('heading')).toEqual({ level: 1 });
    });

    it('returns {variant: "h"} for divider', () => {
      expect(svc.initialProps('divider')).toEqual({ variant: 'h' });
    });

    it('returns {variant: "primary"} for button', () => {
      expect(svc.initialProps('button')).toEqual({ variant: 'primary' });
    });

    it('returns {} for other types', () => {
      expect(svc.initialProps('rect')).toEqual({});
      expect(svc.initialProps('image')).toEqual({});
    });
  });

  describe('cloneWithOffset', () => {
    it('returns a new object with a fresh id, shifted x/y, bumped zIndex, and same other fields', () => {
      const src = el('src', {
        x: 10,
        y: 20,
        w: 120,
        h: 40,
        zIndex: 3,
        type: 'heading',
        text: 'Hi',
        color: '#abc',
      });
      const list = [src, el('other', { zIndex: 9 })];
      const copy = svc.cloneWithOffset(src, 16, list);
      expect(copy).not.toBe(src);
      expect(copy.id).not.toBe(src.id);
      expect(copy.id.startsWith('el_')).toBe(true);
      expect(copy.x).toBe(26);
      expect(copy.y).toBe(36);
      expect(copy.zIndex).toBe(10); // max(3, 9) + 1
      expect(copy.w).toBe(120);
      expect(copy.h).toBe(40);
      expect(copy.type).toBe('heading');
      expect(copy.text).toBe('Hi');
      expect(copy.color).toBe('#abc');
    });
  });

  describe('createFromPalette', () => {
    it('appends locally, forwards a full-element patch through collab, and writes activity', async () => {
      const item = palItem({ type: 'button', w: 120, h: 36 });
      const id = await svc.createFromPalette(item, { x: 50, y: 60 }, 'pg1', 'tid-1', 'pid-1', [
        el('x', { zIndex: 4 }),
      ]);
      expect(id.startsWith('el_')).toBe(true);
      const appended = lastAppended();
      expect(appended.id).toBe(id);
      expect(appended.pageId).toBe('pg1');
      expect(appended.type).toBe('button');
      expect(appended.x).toBe(50);
      expect(appended.y).toBe(60);
      expect(appended.w).toBe(120);
      expect(appended.h).toBe(36);
      expect(appended.zIndex).toBe(5);
      expect(appended.text).toBe('Button');
      expect(appended.variant).toBe('primary');

      expect(sendEditSpy).toHaveBeenCalledTimes(1);
      const [sentId, patch] = sendEditSpy.calls.mostRecent().args as [
        string,
        Record<string, unknown>,
      ];
      expect(sentId).toBe(id);
      expect(patch['type']).toBe('button');
      expect(patch['zIndex']).toBe(5);
      expect(flushSpy).toHaveBeenCalled();

      expect(writeActivitySpy).toHaveBeenCalledWith(
        'tid-1',
        'pid-1',
        'element-added',
        'added button',
      );
    });

    it('initializes heading with level=1 and no variant', async () => {
      const item = palItem({ type: 'heading', w: 240, h: 32 });
      await svc.createFromPalette(item, { x: 0, y: 0 }, 'pg', 't', 'p', []);
      const appended = lastAppended();
      expect(appended.level).toBe(1);
      expect(appended.variant).toBeUndefined();
      expect(appended.text).toBe('Heading');
    });
  });

  describe('createFromDrop', () => {
    it('looks up preset dimensions from PALETTES and clamps within page bounds', async () => {
      // 'rect' is in PALETTES at 200x120. Dropping at (500, 400) centers at (400, 340).
      const id = await svc.createFromDrop({
        type: 'rect',
        point: { x: 500, y: 400 },
        pageW: 1200,
        pageH: 800,
        pageId: 'pg1',
        tid: 't',
        pid: 'p',
        elements: [],
      });
      expect(id.startsWith('el_')).toBe(true);
      const passed = lastAppended();
      expect(passed.w).toBe(200);
      expect(passed.h).toBe(120);
      expect(passed.x).toBe(400); // 500 - 200/2
      expect(passed.y).toBe(340); // 400 - 120/2
      expect(writeActivitySpy).toHaveBeenCalledWith('t', 'p', 'element-added', 'added rect');
    });

    it('clamps x to [0, pageW-w] and y to [0, pageH-h]', async () => {
      // rect is 200x120. Point far off the right/bottom edge should snap to max.
      await svc.createFromDrop({
        type: 'rect',
        point: { x: 99999, y: 99999 },
        pageW: 1000,
        pageH: 700,
        pageId: 'pg',
        tid: 't',
        pid: 'p',
        elements: [],
      });
      let passed = lastAppended();
      expect(passed.x).toBe(800); // 1000 - 200
      expect(passed.y).toBe(580); // 700 - 120

      // Point far to the upper-left should snap to 0.
      await svc.createFromDrop({
        type: 'rect',
        point: { x: -500, y: -500 },
        pageW: 1000,
        pageH: 700,
        pageId: 'pg',
        tid: 't',
        pid: 'p',
        elements: [],
      });
      passed = lastAppended();
      expect(passed.x).toBe(0);
      expect(passed.y).toBe(0);
    });

    it('defaults to 120x40 when the preset is not found (unknown type fallback)', async () => {
      // Cast an unknown string through ElementType; the factory still produces
      // a safe default so callers can recover gracefully.
      await svc.createFromDrop({
        type: 'not-a-real-type' as unknown as IWireElement['type'],
        point: { x: 100, y: 100 },
        pageW: 800,
        pageH: 600,
        pageId: 'pg',
        tid: 't',
        pid: 'p',
        elements: [],
      });
      const passed = lastAppended();
      expect(passed.w).toBe(120);
      expect(passed.h).toBe(40);
      expect(passed.x).toBe(40); // 100 - 120/2
      expect(passed.y).toBe(80); // 100 - 40/2
    });
  });
});
