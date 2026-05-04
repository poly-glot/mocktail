import { TestBed } from '@angular/core/testing';
import { ProjectApiService } from '@mocktail/projects';
import { EditorCommentsService } from './comments.service';

describe('EditorCommentsService', () => {
  let svc: EditorCommentsService;
  let projects: jasmine.SpyObj<ProjectApiService>;

  beforeEach(() => {
    projects = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', [
      'addComment',
      'resolveComment',
      'writeActivity',
    ]);
    projects.addComment.and.resolveTo('new-cid');
    projects.resolveComment.and.resolveTo();
    projects.writeActivity.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [{ provide: ProjectApiService, useValue: projects }],
    });
    svc = TestBed.inject(EditorCommentsService);
  });

  it('defaults all state to empty / off', () => {
    expect(svc.commentMode()).toBeFalse();
    expect(svc.draft()).toBeNull();
    expect(svc.openPinId()).toBeNull();
  });

  it('toggleMode flips mode and clears draft', () => {
    svc.draft.set({ x: 1, y: 2, text: 'hi' });
    svc.toggleMode();
    expect(svc.commentMode()).toBeTrue();
    expect(svc.draft()).toBeNull();
    svc.toggleMode();
    expect(svc.commentMode()).toBeFalse();
  });

  it('startDraft stores coords + empty text and leaves comment-mode', () => {
    svc.commentMode.set(true);
    svc.startDraft(30, 40);
    expect(svc.draft()).toEqual({ x: 30, y: 40, text: '' });
    expect(svc.commentMode()).toBeFalse();
  });

  it('updateDraftText mutates only when a draft exists', () => {
    svc.updateDraftText('ignored');
    expect(svc.draft()).toBeNull();
    svc.startDraft(0, 0);
    svc.updateDraftText('Logo is small');
    expect(svc.draft()?.text).toBe('Logo is small');
    expect(svc.draft()?.x).toBe(0);
  });

  it('cancelDraft clears the draft', () => {
    svc.startDraft(1, 1);
    svc.cancelDraft();
    expect(svc.draft()).toBeNull();
  });

  it('togglePin opens a new id; toggling the same id closes it', () => {
    svc.togglePin('c1');
    expect(svc.openPinId()).toBe('c1');
    svc.togglePin('c1');
    expect(svc.openPinId()).toBeNull();
  });

  it('togglePin switches between different ids', () => {
    svc.togglePin('c1');
    svc.togglePin('c2');
    expect(svc.openPinId()).toBe('c2');
  });

  it('openPin sets an explicit id regardless of prior state', () => {
    svc.openPin('c9');
    expect(svc.openPinId()).toBe('c9');
    svc.openPin('c9');
    expect(svc.openPinId()).toBe('c9');
  });

  it('closePin clears whichever pin is open', () => {
    svc.togglePin('c1');
    svc.closePin();
    expect(svc.openPinId()).toBeNull();
  });

  describe('saveDraft', () => {
    it('cancels empty/whitespace drafts without calling the API', async () => {
      svc.startDraft(5, 6);
      svc.updateDraftText('   ');
      await svc.saveDraft('t', 'p', null);
      expect(projects.addComment).not.toHaveBeenCalled();
      expect(svc.draft()).toBeNull();
    });

    it('is a no-op when no draft exists', async () => {
      await svc.saveDraft('t', 'p', null);
      expect(projects.addComment).not.toHaveBeenCalled();
    });

    it('persists trimmed text, writes activity, opens the new pin, clears the draft', async () => {
      svc.startDraft(10, 20);
      svc.updateDraftText('  hello world  ');
      await svc.saveDraft('t1', 'p1', 'pg1');
      expect(projects.addComment).toHaveBeenCalledWith('t1', 'p1', {
        text: 'hello world',
        x: 10,
        y: 20,
        pageId: 'pg1',
      });
      expect(projects.writeActivity).toHaveBeenCalledWith(
        't1',
        'p1',
        'comment-added',
        'commented: "hello world"',
      );
      expect(svc.openPinId()).toBe('new-cid');
      expect(svc.draft()).toBeNull();
    });

    it('forwards a null pageId as undefined', async () => {
      svc.startDraft(0, 0);
      svc.updateDraftText('hi');
      await svc.saveDraft('t', 'p', null);
      expect(projects.addComment).toHaveBeenCalledWith('t', 'p', {
        text: 'hi',
        x: 0,
        y: 0,
        pageId: undefined,
      });
    });
  });

  describe('resolveComment', () => {
    it('resolves the comment, writes activity, and closes any open pin', async () => {
      svc.openPin('c1');
      await svc.resolveComment('t', 'p', 'c1');
      expect(projects.resolveComment).toHaveBeenCalledWith('t', 'p', 'c1', true);
      expect(projects.writeActivity).toHaveBeenCalledWith(
        't',
        'p',
        'comment-resolved',
        'resolved a comment',
      );
      expect(svc.openPinId()).toBeNull();
    });
  });
});
