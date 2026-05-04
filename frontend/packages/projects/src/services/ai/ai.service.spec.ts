import { TestBed } from '@angular/core/testing';
import { AiService } from './ai.service';

describe('AiService', () => {
  let service: AiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AiService);
  });

  it('initializes with busy=false', () => {
    expect(service.busy()).toBe(false);
    expect(service.lastNotes()).toBeNull();
  });

  it('generate() posts to /api/ai/generate and updates signals', async () => {
    const payload = {
      elements: [{ type: 'rect', x: 1, y: 2, w: 10, h: 10, zIndex: 1 }],
      notes: 'n',
      source: 'gemini' as const,
    };
    spyOn(window, 'fetch').and.resolveTo(new Response(JSON.stringify(payload), { status: 200 }));
    const out = await service.generate('test', []);
    expect(out.notes).toBe('n');
    expect(service.lastSource()).toBe('gemini');
    expect(service.busy()).toBe(false);
  });

  it('generate() throws on non-ok response', async () => {
    spyOn(window, 'fetch').and.resolveTo(new Response('err', { status: 500 }));
    await expectAsync(service.generate('p')).toBeRejected();
    expect(service.busy()).toBe(false);
  });

  it('review() returns [] on non-ok', async () => {
    spyOn(window, 'fetch').and.resolveTo(new Response('err', { status: 500 }));
    const issues = await service.review([]);
    expect(issues).toEqual([]);
  });

  it('review() returns issues from response body', async () => {
    spyOn(window, 'fetch').and.resolveTo(
      new Response(JSON.stringify({ issues: [{ severity: 'warn', message: 'm' }] }), {
        status: 200,
      }),
    );
    const issues = await service.review([]);
    expect(issues.length).toBe(1);
    expect(issues[0].severity).toBe('warn');
  });
});
