import { TestBed } from '@angular/core/testing';
import { CollabService } from '@mocktail/collab';
import { AiService, IWireElement, ProjectApiService } from '@mocktail/projects';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorAiOrchestratorService } from './ai-orchestrator.service';

function el(id: string, overrides: Partial<IWireElement> = {}): IWireElement {
  return {
    id,
    pageId: 'p1',
    type: 'text',
    x: 0,
    y: 0,
    w: 100,
    h: 30,
    rotation: 0,
    zIndex: 0,
    ...overrides,
  };
}

describe('EditorAiOrchestratorService', () => {
  let svc: EditorAiOrchestratorService;
  let state: EditorElementsStateService;
  let aiGenerate: jasmine.Spy;
  let sendEditSpy: jasmine.Spy;
  let sendDeleteSpy: jasmine.Spy;
  let flushSpy: jasmine.Spy;
  let writeActivity: jasmine.Spy;

  const TID = 't';
  const PID = 'p';
  const PAGE = 'page1';

  beforeEach(() => {
    aiGenerate = jasmine.createSpy('generate').and.resolveTo({ elements: [] });
    sendEditSpy = jasmine.createSpy('sendEdit');
    sendDeleteSpy = jasmine.createSpy('sendDelete');
    flushSpy = jasmine.createSpy('flushPendingEdits');
    writeActivity = jasmine.createSpy('writeActivity').and.resolveTo(undefined);

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AiService,
          useValue: { generate: aiGenerate } as Partial<AiService>,
        },
        {
          provide: ProjectApiService,
          useValue: { writeActivity } as Partial<ProjectApiService>,
        },
        {
          provide: CollabService,
          useValue: {
            sendEdit: sendEditSpy,
            sendDelete: sendDeleteSpy,
            flushPendingEdits: flushSpy,
          } as Partial<CollabService>,
        },
      ],
    });
    svc = TestBed.inject(EditorAiOrchestratorService);
    state = TestBed.inject(EditorElementsStateService);
  });

  describe('validation', () => {
    it('returns null and makes no service calls when prompt is empty', async () => {
      const result = await svc.generate({
        prompt: '   ',
        tid: TID,
        pid: PID,
        pageId: PAGE,
        existing: [],
        baseZIndex: 1,
      });
      expect(result).toBeNull();
      expect(aiGenerate).not.toHaveBeenCalled();
      expect(sendEditSpy).not.toHaveBeenCalled();
      expect(sendDeleteSpy).not.toHaveBeenCalled();
      expect(writeActivity).not.toHaveBeenCalled();
    });

    it('returns null and makes no service calls when pageId is missing', async () => {
      const result = await svc.generate({
        prompt: 'make a nav',
        tid: TID,
        pid: PID,
        pageId: '',
        existing: [],
        baseZIndex: 1,
      });
      expect(result).toBeNull();
      expect(aiGenerate).not.toHaveBeenCalled();
      expect(sendEditSpy).not.toHaveBeenCalled();
    });
  });

  describe('append path (default)', () => {
    it('calls _ai.generate, appends to state, fans out sendEdit per element, and writes activity', async () => {
      aiGenerate.and.resolveTo({
        elements: [
          { type: 'button', x: 10, y: 20, w: 150, h: 30, text: 'Click me' },
          { type: 'text', x: 12, y: 22, w: 200, h: 40, text: 'Hello' },
        ],
      });
      const existing = [el('e1'), el('e2')];
      state.list.set(existing);

      const result = await svc.generate({
        prompt: 'add a button and text',
        tid: TID,
        pid: PID,
        pageId: PAGE,
        existing,
        baseZIndex: 5,
      });

      expect(aiGenerate).toHaveBeenCalledWith('add a button and text', existing);
      expect(sendDeleteSpy).not.toHaveBeenCalled();
      expect(sendEditSpy).toHaveBeenCalledTimes(2);

      const listed = state.list();
      expect(listed.length).toBe(4);
      const newOnes = listed.slice(2);
      expect(newOnes[0].type).toBe('button');
      expect(newOnes[0].pageId).toBe(PAGE);
      expect(newOnes[0].x).toBe(10);
      expect(newOnes[0].y).toBe(20);
      expect(newOnes[0].w).toBe(150);
      expect(newOnes[0].h).toBe(30);
      expect(newOnes[0].zIndex).toBe(5);
      expect(newOnes[0].text).toBe('Click me');
      expect(newOnes[0].id).toMatch(/^el_/);
      expect(newOnes[1].x).toBe(13); // 12 + offset 1
      expect(newOnes[1].y).toBe(23); // 22 + offset 1
      expect(newOnes[1].zIndex).toBe(6);

      expect(flushSpy).toHaveBeenCalled();
      expect(writeActivity).toHaveBeenCalledWith(
        TID,
        PID,
        'ai-generated',
        'AI generated 2 elements for "add a button and text"',
      );
      expect(result).toEqual({ added: 2 });
    });

    it('truncates long prompts in the activity message to 40 chars', async () => {
      aiGenerate.and.resolveTo({ elements: [] });
      const longPrompt = 'a'.repeat(100);
      await svc.generate({
        prompt: longPrompt,
        tid: TID,
        pid: PID,
        pageId: PAGE,
        existing: [],
        baseZIndex: 1,
      });
      const summary = writeActivity.calls.mostRecent().args[3] as string;
      expect(summary).toBe(`AI generated 0 elements for "${'a'.repeat(40)}"`);
    });
  });

  describe('replace path', () => {
    it('deletes existing ids and sends edits for new elements when prompt starts with "replace"', async () => {
      aiGenerate.and.resolveTo({ elements: [{ type: 'rect' }] });
      const existing = [el('a'), el('b'), el('c')];
      state.list.set(existing);

      await svc.generate({
        prompt: 'replace with a hero section',
        tid: TID,
        pid: PID,
        pageId: PAGE,
        existing,
        baseZIndex: 10,
      });
      const deletedIds = sendDeleteSpy.calls
        .allArgs()
        .map((a) => a[0] as string)
        .sort();
      expect(deletedIds).toEqual(['a', 'b', 'c']);
      expect(sendEditSpy).toHaveBeenCalledTimes(1);
      const after = state.list();
      expect(after.length).toBe(1);
      expect(after[0].type).toBe('rect');
    });

    it('deletes existing when prompt starts with "reset" (case-insensitive)', async () => {
      aiGenerate.and.resolveTo({ elements: [] });
      state.list.set([el('x')]);
      await svc.generate({
        prompt: 'RESET the board',
        tid: TID,
        pid: PID,
        pageId: PAGE,
        existing: [el('x')],
        baseZIndex: 1,
      });
      expect(sendDeleteSpy).toHaveBeenCalledWith('x');
      expect(state.list().length).toBe(0);
    });

    it('tolerates leading whitespace before the replace/reset keyword', async () => {
      aiGenerate.and.resolveTo({ elements: [] });
      state.list.set([el('x')]);
      await svc.generate({
        prompt: '   replace all',
        tid: TID,
        pid: PID,
        pageId: PAGE,
        existing: [el('x')],
        baseZIndex: 1,
      });
      expect(sendDeleteSpy).toHaveBeenCalledWith('x');
    });
  });

  describe('element construction defaults', () => {
    async function runWith(elements: unknown[]): Promise<IWireElement[]> {
      aiGenerate.and.resolveTo({ elements });
      sendEditSpy.calls.reset();
      state.list.set([]);
      await svc.generate({
        prompt: 'generate',
        tid: TID,
        pid: PID,
        pageId: PAGE,
        existing: [],
        baseZIndex: 0,
      });
      return state.list();
    }

    it('applies x/y/w/h defaults when raw lacks them', async () => {
      const toWrite = await runWith([{ type: 'rect' }]);
      expect(toWrite[0].x).toBe(40);
      expect(toWrite[0].y).toBe(40);
      expect(toWrite[0].w).toBe(200);
      expect(toWrite[0].h).toBe(40);
      expect(toWrite[0].type).toBe('rect');
    });

    it('falls back type to "rect" when raw omits it', async () => {
      const toWrite = await runWith([{}]);
      expect(toWrite[0].type).toBe('rect');
    });

    it('falls back text to props.text, then props.placeholder', async () => {
      const toWrite = await runWith([
        { type: 'text', props: { text: 'from-props' } },
        { type: 'input', props: { placeholder: 'Enter value' } },
      ]);
      expect(toWrite[0].text).toBe('from-props');
      expect(toWrite[1].text).toBe('Enter value');
    });

    it('uses raw.data when present, falling back to props otherwise', async () => {
      const toWrite = await runWith([
        { type: 'rect', data: { custom: 'a' }, props: { other: 'b' } },
        { type: 'rect', props: { onlyProps: 'yes' } },
      ]);
      expect(toWrite[0].data).toEqual({ custom: 'a' });
      expect(toWrite[1].data).toEqual({ onlyProps: 'yes' });
    });

    it('applies variant from raw or falls back to props.variant', async () => {
      const toWrite = await runWith([
        { type: 'button', variant: 'primary' },
        { type: 'button', props: { variant: 'secondary' } },
      ]);
      expect(toWrite[0].variant).toBe('primary');
      expect(toWrite[1].variant).toBe('secondary');
    });
  });

  describe('error handling', () => {
    it('bubbles up errors from _ai.generate and does not touch state or activity', async () => {
      const boom = new Error('AI failed');
      aiGenerate.and.rejectWith(boom);

      await expectAsync(
        svc.generate({
          prompt: 'anything',
          tid: TID,
          pid: PID,
          pageId: PAGE,
          existing: [],
          baseZIndex: 0,
        }),
      ).toBeRejectedWith(boom);

      expect(sendEditSpy).not.toHaveBeenCalled();
      expect(sendDeleteSpy).not.toHaveBeenCalled();
      expect(writeActivity).not.toHaveBeenCalled();
    });
  });
});
