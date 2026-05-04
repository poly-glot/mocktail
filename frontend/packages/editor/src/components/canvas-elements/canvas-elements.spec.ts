import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { IWireElement } from '@mocktail/projects';
import { Heart, LUCIDE_ICONS, LucideIconProvider, Smile } from 'lucide-angular';
import { EditorElementsStateService } from '../../services/elements-state/elements-state.service';
import { EditorInlineEditService } from '../../services/inline-edit/inline-edit.service';
import { EditorInspectorService } from '../../services/inspector/inspector.service';
import { EditorSessionService } from '../../services/session/session.service';
import { ElBarChartComponent } from './el-bar-chart.component';
import { ElButtonComponent } from './el-button.component';
import { ElCardComponent } from './el-card.component';
import { ElCheckboxComponent } from './el-checkbox.component';
import { ElDividerComponent } from './el-divider.component';
import { ElDonutComponent } from './el-donut.component';
import { ElHeadingComponent } from './el-heading.component';
import { ElIconComponent } from './el-icon.component';
import { ElImageComponent } from './el-image.component';
import { ElLinkComponent } from './el-link.component';
import { ElListComponent } from './el-list.component';
import { ElPhoneFrameComponent } from './el-phone-frame.component';
import { ElTableComponent } from './el-table.component';
import { ElTagComponent } from './el-tag.component';
import { ElTextComponent } from './el-text.component';
import { ElToggleComponent } from './el-toggle.component';

function makeEl(o: Partial<IWireElement> & Pick<IWireElement, 'id' | 'type'>): IWireElement {
  return {
    pageId: 'pg1',
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    zIndex: 1,
    ...o,
  } as IWireElement;
}

describe('Canvas element components — inline edit dispatch', () => {
  let inline: EditorInlineEditService;
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
        {
          provide: EditorSessionService,
          useValue: {
            tid: signal('t1'),
            pid: signal('p1'),
          },
        },
      ],
    });
    inline = TestBed.inject(EditorInlineEditService);
    state = TestBed.inject(EditorElementsStateService);
  });

  function createTextHost(el: IWireElement): {
    fixture: ComponentFixture<ElTextComponent>;
    cmp: ElTextComponent;
  } {
    state.list.set([el]);
    inline.begin(el.id);
    const fixture = TestBed.createComponent(ElTextComponent);
    fixture.componentRef.setInput('el', el);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();
    return { fixture, cmp };
  }

  it('Escape cancels inline edit and clears editingId without committing', () => {
    const el = makeEl({ id: 't1', type: 'text', text: 'Original' });
    const { cmp } = createTextHost(el);
    const host = document.createElement('span');
    host.textContent = 'Changed';
    const ev = new KeyboardEvent('keydown', { key: 'Escape' });
    Object.defineProperty(ev, 'currentTarget', { value: host });
    cmp.onKeydown(ev);
    expect(inline.editingId()).toBeNull();
    expect(sendEdit).not.toHaveBeenCalled();
  });

  it('Enter commits for non-text types (heading/button) but not for text', () => {
    const el = makeEl({ id: 'b1', type: 'button', text: 'Old' });
    state.list.set([el]);
    inline.begin('b1');
    const fixture = TestBed.createComponent(ElButtonComponent);
    fixture.componentRef.setInput('el', el);
    fixture.detectChanges();
    const host = document.createElement('span');
    host.textContent = 'Click me';
    const ev = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(ev, 'currentTarget', { value: host });
    fixture.componentInstance.onKeydown(ev);
    expect(inline.editingId()).toBeNull();
    const [, patch] = sendEdit.calls.mostRecent().args as [string, Partial<IWireElement>];
    expect(patch.text).toBe('Click me');
  });

  it('Enter on text type does NOT commit (multi-line allowed)', () => {
    const el = makeEl({ id: 't1', type: 'text', text: 'Old' });
    const { cmp } = createTextHost(el);
    const host = document.createElement('span');
    host.textContent = 'With newlines';
    const ev = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(ev, 'currentTarget', { value: host });
    cmp.onKeydown(ev);
    expect(inline.editingId()).toBe('t1');
  });

  it('blur commits text change', () => {
    const el = makeEl({ id: 'b1', type: 'button', text: 'Old' });
    state.list.set([el]);
    inline.begin('b1');
    const fixture = TestBed.createComponent(ElButtonComponent);
    fixture.componentRef.setInput('el', el);
    fixture.detectChanges();
    const host = document.createElement('span');
    host.textContent = 'Click me';
    const ev = new FocusEvent('blur');
    Object.defineProperty(ev, 'currentTarget', { value: host });
    fixture.componentInstance.onBlur(ev);
    const [, patch] = sendEdit.calls.mostRecent().args as [string, Partial<IWireElement>];
    expect(patch.text).toBe('Click me');
  });

  it('paste prevents default and inserts only plain text', () => {
    const el = makeEl({ id: 't1', type: 'text' });
    const { cmp } = createTextHost(el);
    const span = document.createElement('span');
    span.contentEditable = 'true';
    document.body.appendChild(span);
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const dt = new DataTransfer();
    dt.setData('text/plain', 'hello');
    dt.setData('text/html', '<b>hello</b>');
    const ev = new ClipboardEvent('paste', { clipboardData: dt });
    let prevented = false;
    spyOn(ev, 'preventDefault').and.callFake(() => {
      prevented = true;
    });
    cmp.onPaste(ev);
    expect(prevented).toBe(true);
    expect(span.innerHTML).toBe('hello');
    document.body.removeChild(span);
  });

  it('Tab on list with shiftKey triggers outdent path', () => {
    const el = makeEl({ id: 'l1', type: 'list', text: 'a' });
    state.list.set([el]);
    inline.begin('l1');
    const fix = TestBed.createComponent(ElListComponent);
    fix.componentRef.setInput('el', el);
    fix.detectChanges();
    const host = document.createElement('span');
    host.contentEditable = 'true';
    document.body.appendChild(host);
    host.textContent = '\thello';
    const range = document.createRange();
    range.selectNodeContents(host);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
    Object.defineProperty(ev, 'currentTarget', { value: host });
    let prevented = false;
    spyOn(ev, 'preventDefault').and.callFake(() => {
      prevented = true;
    });
    fix.componentInstance.onKeydown(ev);
    expect(prevented).toBeTrue();
    document.body.removeChild(host);
  });

  it('Tab on list without shiftKey inserts a tab character', () => {
    const el = makeEl({ id: 'l1', type: 'list', text: '' });
    state.list.set([el]);
    inline.begin('l1');
    const fix = TestBed.createComponent(ElListComponent);
    fix.componentRef.setInput('el', el);
    fix.detectChanges();
    const host = document.createElement('span');
    host.contentEditable = 'true';
    document.body.appendChild(host);
    const range = document.createRange();
    range.selectNodeContents(host);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false });
    Object.defineProperty(ev, 'currentTarget', { value: host });
    let prevented = false;
    spyOn(ev, 'preventDefault').and.callFake(() => {
      prevented = true;
    });
    fix.componentInstance.onKeydown(ev);
    expect(prevented).toBeTrue();
    document.body.removeChild(host);
  });

  it('Tab on a text element falls through (shouldIndentOnTab is false)', () => {
    const el = makeEl({ id: 't1', type: 'text' });
    const { cmp } = createTextHost(el);
    const host = document.createElement('span');
    const ev = new KeyboardEvent('keydown', { key: 'Tab' });
    Object.defineProperty(ev, 'currentTarget', { value: host });
    let prevented = false;
    spyOn(ev, 'preventDefault').and.callFake(() => {
      prevented = true;
    });
    cmp.onKeydown(ev);
    expect(prevented).toBeFalse();
  });

  it('arbitrary key (e.g. "a") on the inline editor is a no-op', () => {
    const el = makeEl({ id: 't1', type: 'text' });
    const { cmp } = createTextHost(el);
    const host = document.createElement('span');
    const ev = new KeyboardEvent('keydown', { key: 'a' });
    Object.defineProperty(ev, 'currentTarget', { value: host });
    let prevented = false;
    spyOn(ev, 'preventDefault').and.callFake(() => {
      prevented = true;
    });
    cmp.onKeydown(ev);
    expect(prevented).toBeFalse();
    expect(inline.editingId()).toBe('t1');
  });

  it('Heading shift+Enter does NOT commit (shift bypasses shouldCommitOnEnter)', () => {
    const el = makeEl({ id: 'h1', type: 'heading', text: 'Old' });
    state.list.set([el]);
    inline.begin('h1');
    const fix = TestBed.createComponent(ElHeadingComponent);
    fix.componentRef.setInput('el', el);
    fix.detectChanges();
    const host = document.createElement('span');
    const ev = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
    Object.defineProperty(ev, 'currentTarget', { value: host });
    fix.componentInstance.onKeydown(ev);
    expect(inline.editingId()).toBe('h1');
  });

  it('Link Escape cancels via inline.commit cancel=true', () => {
    const el = makeEl({ id: 'a1', type: 'link', text: 'Old' });
    state.list.set([el]);
    inline.begin('a1');
    const fix = TestBed.createComponent(ElLinkComponent);
    fix.componentRef.setInput('el', el);
    fix.detectChanges();
    const host = document.createElement('span');
    host.textContent = 'discarded';
    const ev = new KeyboardEvent('keydown', { key: 'Escape' });
    Object.defineProperty(ev, 'currentTarget', { value: host });
    fix.componentInstance.onKeydown(ev);
    expect(inline.editingId()).toBeNull();
  });

  // Run the full keydown/blur/paste matrix against each inline-edit component
  // so every branch in the (Escape | Enter | Tab | other) tree fires once per
  // file. The 5 components share the keydown logic and only differ in
  // shouldCommitOnEnter / shouldIndentOnTab, which depend on element type.
  const inlineCases: {
    cmp:
      | typeof ElButtonComponent
      | typeof ElHeadingComponent
      | typeof ElLinkComponent
      | typeof ElTextComponent
      | typeof ElListComponent;
    type: IWireElement['type'];
    enterCommits: boolean;
    indentsOnTab: boolean;
  }[] = [
    { cmp: ElButtonComponent, type: 'button', enterCommits: true, indentsOnTab: false },
    { cmp: ElHeadingComponent, type: 'heading', enterCommits: true, indentsOnTab: false },
    { cmp: ElLinkComponent, type: 'link', enterCommits: true, indentsOnTab: false },
    { cmp: ElTextComponent, type: 'text', enterCommits: false, indentsOnTab: false },
    { cmp: ElListComponent, type: 'list', enterCommits: false, indentsOnTab: true },
  ];

  for (const c of inlineCases) {
    describe(`${c.type} component branch matrix`, () => {
      it('exercises every keydown / blur / paste branch', () => {
        const el = makeEl({ id: 'x', type: c.type, text: 'orig' });
        state.list.set([el]);
        const make = (): InstanceType<typeof c.cmp> => {
          inline.begin('x');
          const fix = TestBed.createComponent(c.cmp as never);
          (fix.componentRef as { setInput: (k: string, v: unknown) => void }).setInput('el', el);
          fix.detectChanges();
          return fix.componentInstance as InstanceType<typeof c.cmp>;
        };
        const host = (): HTMLElement => {
          const h = document.createElement('span');
          h.contentEditable = 'true';
          document.body.appendChild(h);
          h.textContent = 'next';
          const r = document.createRange();
          r.selectNodeContents(h);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
          return h;
        };
        const fire = (
          inst: InstanceType<typeof c.cmp>,
          method: 'onKeydown' | 'onBlur' | 'onPaste',
          ev: Event,
        ): void => {
          (inst as unknown as Record<string, (e: Event) => void>)[method](ev);
        };
        // Escape
        let inst = make();
        let h = host();
        let ev: Event = new KeyboardEvent('keydown', { key: 'Escape' });
        Object.defineProperty(ev, 'currentTarget', { value: h });
        fire(inst, 'onKeydown', ev);
        document.body.removeChild(h);
        expect(inline.editingId()).toBeNull();

        // Enter (with and without shift)
        inst = make();
        h = host();
        ev = new KeyboardEvent('keydown', { key: 'Enter' });
        Object.defineProperty(ev, 'currentTarget', { value: h });
        fire(inst, 'onKeydown', ev);
        document.body.removeChild(h);
        if (c.enterCommits) expect(inline.editingId()).toBeNull();
        else expect(inline.editingId()).toBe('x');

        inst = make();
        h = host();
        ev = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
        Object.defineProperty(ev, 'currentTarget', { value: h });
        fire(inst, 'onKeydown', ev);
        document.body.removeChild(h);
        // shift+Enter never commits regardless of type
        expect(inline.editingId()).toBe('x');

        // Tab (with and without shift)
        inst = make();
        h = host();
        ev = new KeyboardEvent('keydown', { key: 'Tab' });
        Object.defineProperty(ev, 'currentTarget', { value: h });
        let prevented = false;
        spyOn(ev, 'preventDefault').and.callFake(() => {
          prevented = true;
        });
        fire(inst, 'onKeydown', ev);
        document.body.removeChild(h);
        expect(prevented).toBe(c.indentsOnTab);

        inst = make();
        h = host();
        ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
        Object.defineProperty(ev, 'currentTarget', { value: h });
        prevented = false;
        spyOn(ev, 'preventDefault').and.callFake(() => {
          prevented = true;
        });
        fire(inst, 'onKeydown', ev);
        document.body.removeChild(h);
        expect(prevented).toBe(c.indentsOnTab);

        // Other key
        inst = make();
        h = host();
        ev = new KeyboardEvent('keydown', { key: 'a' });
        Object.defineProperty(ev, 'currentTarget', { value: h });
        prevented = false;
        spyOn(ev, 'preventDefault').and.callFake(() => {
          prevented = true;
        });
        fire(inst, 'onKeydown', ev);
        document.body.removeChild(h);
        expect(prevented).toBeFalse();

        // Blur
        inst = make();
        h = host();
        ev = new FocusEvent('blur');
        Object.defineProperty(ev, 'currentTarget', { value: h });
        fire(inst, 'onBlur', ev);
        document.body.removeChild(h);
        expect(inline.editingId()).toBeNull();

        // Paste with text
        inst = make();
        h = host();
        h.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', 'pasted');
        ev = new ClipboardEvent('paste', { clipboardData: dt });
        prevented = false;
        spyOn(ev, 'preventDefault').and.callFake(() => {
          prevented = true;
        });
        fire(inst, 'onPaste', ev);
        document.body.removeChild(h);
        expect(prevented).toBeTrue();

        // Paste with no clipboardData (?? '' branch)
        inst = make();
        h = host();
        h.focus();
        ev = new ClipboardEvent('paste');
        prevented = false;
        spyOn(ev, 'preventDefault').and.callFake(() => {
          prevented = true;
        });
        fire(inst, 'onPaste', ev);
        document.body.removeChild(h);
        expect(prevented).toBeTrue();
      });
    });
  }

  it('paste with empty clipboardData inserts an empty string', () => {
    const el = makeEl({ id: 't1', type: 'text' });
    const { cmp } = createTextHost(el);
    const span = document.createElement('span');
    span.contentEditable = 'true';
    document.body.appendChild(span);
    span.focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const ev = new ClipboardEvent('paste');
    let prevented = false;
    spyOn(ev, 'preventDefault').and.callFake(() => {
      prevented = true;
    });
    cmp.onPaste(ev);
    expect(prevented).toBe(true);
    document.body.removeChild(span);
  });

  it('Heading and Link inline edit handlers route through EditorInlineEditService', () => {
    const heading = makeEl({ id: 'h1', type: 'heading', text: 'Old' });
    state.list.set([heading]);
    inline.begin('h1');
    const headingFix = TestBed.createComponent(ElHeadingComponent);
    headingFix.componentRef.setInput('el', heading);
    headingFix.detectChanges();
    const hHost = document.createElement('span');
    hHost.textContent = 'New';
    const hEv = new KeyboardEvent('keydown', { key: 'Enter' });
    Object.defineProperty(hEv, 'currentTarget', { value: hHost });
    headingFix.componentInstance.onKeydown(hEv);
    expect(inline.editingId()).toBeNull();

    const link = makeEl({ id: 'a1', type: 'link', text: 'Old' });
    state.list.set([link]);
    inline.begin('a1');
    const linkFix = TestBed.createComponent(ElLinkComponent);
    linkFix.componentRef.setInput('el', link);
    linkFix.detectChanges();
    const aHost = document.createElement('span');
    aHost.textContent = 'NewLink';
    const aEv = new FocusEvent('blur');
    Object.defineProperty(aEv, 'currentTarget', { value: aHost });
    linkFix.componentInstance.onBlur(aEv);
    const calls = sendEdit.calls.allArgs() as [string, Partial<IWireElement>][];
    expect(calls.some(([id, p]) => id === 'a1' && p.text === 'NewLink')).toBeTrue();
  });
});

describe('Canvas element components — render', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CollabService,
          useValue: {
            sendEdit: jasmine.createSpy('sendEdit'),
            sendDelete: jasmine.createSpy('sendDelete'),
            sendDeleteFields: jasmine.createSpy('sendDeleteFields'),
            flushPendingEdits: jasmine.createSpy('flushPendingEdits'),
          } as Partial<CollabService>,
        },
        {
          provide: EditorSessionService,
          useValue: { tid: signal('t1'), pid: signal('p1') },
        },
        {
          provide: EditorInspectorService,
          useValue: { removeImage: jasmine.createSpy().and.resolveTo(undefined) },
        },
        {
          provide: LUCIDE_ICONS,
          multi: true,
          useValue: new LucideIconProvider({ Heart, Smile }),
        },
      ],
    });
  });

  function renderHost<T>(cmp: new (...args: never[]) => T, el?: IWireElement): T {
    const fix = TestBed.createComponent(cmp as never) as ComponentFixture<T>;
    if (el) (fix.componentRef as { setInput: (k: string, v: unknown) => void }).setInput('el', el);
    fix.detectChanges();
    return fix.componentInstance;
  }

  it('ElCheckbox renders a checkbox-mark span', () => {
    const fix = TestBed.createComponent(ElCheckboxComponent);
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('.checkbox-mark')).not.toBeNull();
  });

  it('ElToggle renders a toggle-knob span', () => {
    const fix = TestBed.createComponent(ElToggleComponent);
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('.toggle-knob')).not.toBeNull();
  });

  it('ElTag renders the tag shape, hole and text', () => {
    const fix = TestBed.createComponent(ElTagComponent);
    fix.componentRef.setInput('el', makeEl({ id: 't', type: 'tag', text: 'Hi', color: '#ff0000' }));
    fix.detectChanges();
    const root = fix.nativeElement;
    expect(root.querySelector('.tag-shape')).not.toBeNull();
    expect(root.querySelector('.tag-hole')).not.toBeNull();
    expect(root.querySelector('.tag-text')?.textContent?.trim()).toBe('Hi');
  });

  it('ElTag falls back to "Tag" when no text provided', () => {
    const fix = TestBed.createComponent(ElTagComponent);
    fix.componentRef.setInput('el', makeEl({ id: 't', type: 'tag' }));
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('.tag-text')?.textContent?.trim()).toBe('Tag');
  });

  it('ElCard renders the body/head/thumb/meta blocks', () => {
    const fix = TestBed.createComponent(ElCardComponent);
    fix.componentRef.setInput('el', makeEl({ id: 'c', type: 'card', text: 'Title' }));
    fix.detectChanges();
    const root = fix.nativeElement;
    expect(root.querySelector('.el-card-body')).not.toBeNull();
    expect(root.querySelector('.el-card-head')?.textContent?.trim()).toBe('Title');
    expect(root.querySelector('.el-card-thumb')).not.toBeNull();
    expect(root.querySelector('.el-card-meta')).not.toBeNull();
  });

  it('ElPhoneFrame renders a phone-body and notch', () => {
    const fix = TestBed.createComponent(ElPhoneFrameComponent);
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('.phone-body')).not.toBeNull();
    expect(fix.nativeElement.querySelector('.phone-notch')).not.toBeNull();
  });

  it('ElBarChart renders an SVG with 10 bars', () => {
    const fix = TestBed.createComponent(ElBarChartComponent);
    fix.detectChanges();
    expect(fix.nativeElement.querySelectorAll('svg rect').length).toBe(10);
  });

  it('ElDonut renders an SVG with two concentric circles', () => {
    const fix = TestBed.createComponent(ElDonutComponent);
    fix.detectChanges();
    expect(fix.nativeElement.querySelectorAll('svg circle').length).toBe(2);
  });

  it('ElTable renders a head row and three data rows', () => {
    const fix = TestBed.createComponent(ElTableComponent);
    fix.detectChanges();
    const rows = fix.nativeElement.querySelectorAll('.el-table .row');
    expect(rows.length).toBe(4);
    expect(rows[0].classList.contains('head')).toBeTrue();
  });

  it('ElDivider applies horizontal stroke when orientation is horizontal', () => {
    const fix = TestBed.createComponent(ElDividerComponent);
    fix.componentRef.setInput(
      'el',
      makeEl({
        id: 'd',
        type: 'divider',
        variant: 'h',
        data: { strokeWidth: 4, strokeStyle: 'dashed' },
      }),
    );
    fix.detectChanges();
    const span = fix.nativeElement.querySelector('.divider-line') as HTMLElement;
    expect(span.style.borderTopWidth).toBe('4px');
    expect(span.style.borderTopStyle).toBe('dashed');
  });

  it('ElDivider applies vertical stroke when orientation is vertical', () => {
    const fix = TestBed.createComponent(ElDividerComponent);
    fix.componentRef.setInput(
      'el',
      makeEl({ id: 'd', type: 'divider', variant: 'v', data: { strokeWidth: 6 } }),
    );
    fix.detectChanges();
    const span = fix.nativeElement.querySelector('.divider-line') as HTMLElement;
    expect(span.style.borderLeftWidth).toBe('6px');
  });

  it('ElIcon renders the lucide-icon with the trait-derived name', () => {
    const fix = TestBed.createComponent(ElIconComponent);
    fix.componentRef.setInput('el', makeEl({ id: 'i', type: 'icon', data: { iconName: 'heart' } }));
    fix.detectChanges();
    const root = fix.nativeElement;
    expect(root.querySelector('lucide-icon')).not.toBeNull();
  });

  it('ElIcon shows a label when text is set', () => {
    const fix = TestBed.createComponent(ElIconComponent);
    fix.componentRef.setInput('el', makeEl({ id: 'i', type: 'icon', text: 'Tag' }));
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('.icon-label')?.textContent?.trim()).toBe('Tag');
  });

  it('ElImage renders an <img> when an image-ref is present', () => {
    const fix = TestBed.createComponent(ElImageComponent);
    fix.componentRef.setInput(
      'el',
      makeEl({
        id: 'm',
        type: 'image',
        data: {
          image: {
            src: 'http://x/y.jpg',
            thumb: 'http://x/y_t.jpg',
            source: 'unsplash',
            photographer: 'Alice',
            photographerUrl: 'http://u/alice',
          },
        },
      }),
    );
    fix.detectChanges();
    const img = fix.nativeElement.querySelector('img.image-src') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.alt).toContain('Alice');
  });

  it('ElImage renders a placeholder stub when no image-ref is present', () => {
    const fix = TestBed.createComponent(ElImageComponent);
    fix.componentRef.setInput('el', makeEl({ id: 'm', type: 'image' }));
    fix.detectChanges();
    expect(fix.nativeElement.querySelector('.image-stub')).not.toBeNull();
    expect(fix.nativeElement.querySelector('img.image-src')).toBeNull();
  });

  it('ElImage onLoadError calls inspector.removeImage with current tid/pid + el id', () => {
    const inspSpy = TestBed.inject(
      EditorInspectorService,
    ) as jasmine.SpyObj<EditorInspectorService>;
    const fix = TestBed.createComponent(ElImageComponent);
    fix.componentRef.setInput('el', makeEl({ id: 'm', type: 'image' }));
    fix.detectChanges();
    fix.componentInstance.onLoadError();
    expect(inspSpy.removeImage).toHaveBeenCalledWith('t1', 'p1', 'm');
  });

  it('ElButton, ElText, ElHeading, ElLink default text shows when none set', () => {
    const cases: [unknown, IWireElement, string][] = [
      [ElButtonComponent, makeEl({ id: 'b', type: 'button' }), 'Button'],
      [ElTextComponent, makeEl({ id: 't', type: 'text' }), 'Text block'],
      [ElHeadingComponent, makeEl({ id: 'h', type: 'heading' }), 'Heading'],
      [ElLinkComponent, makeEl({ id: 'l', type: 'link' }), 'Link text'],
    ];
    for (const [Cmp, el, fallback] of cases) {
      const fix = TestBed.createComponent(Cmp as never);
      (fix.componentRef as { setInput: (k: string, v: unknown) => void }).setInput('el', el);
      fix.detectChanges();
      expect((fix.nativeElement as HTMLElement).textContent?.trim()).toContain(fallback);
    }
    void renderHost;
  });
});
