import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap } from '@angular/router';
import { DialogService } from '@mocktail/cdk';
import { CollabService } from '@mocktail/collab';
import { IComment, IPageDoc, IProject, ProjectApiService } from '@mocktail/projects';
import { TenantService } from '@mocktail/tenant';
import { BehaviorSubject } from 'rxjs';
import { CanvasGestureStore } from '../canvas-gesture/canvas-gesture.store';
import { CommentsStore } from '../comments/comments.store';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorInlineEditService } from '../inline-edit/inline-edit.service';
import { EditorViewportService } from '../viewport/viewport.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { EditorSessionService } from './session.service';

type PagesCallback = (pages: IPageDoc[]) => void;
type CommentsCallback = (rows: IComment[]) => void;
type ProjectCallback = (proj: IProject | null) => void;

function makeComment(partial: Partial<IComment> & Pick<IComment, 'id'>): IComment {
  return {
    text: '',
    authorId: 'u1',
    authorName: 'User',
    resolved: false,
    ...partial,
  } as IComment;
}

function makeProject(partial: Partial<IProject>): IProject {
  return {
    id: 'p1',
    name: 'Project',
    deleted: false,
    ...partial,
  } as IProject;
}

describe('EditorSessionService', () => {
  let svc: EditorSessionService;
  let projects: jasmine.SpyObj<ProjectApiService>;
  let tenants: jasmine.SpyObj<TenantService>;
  let collab: jasmine.SpyObj<CollabService>;
  let dialog: jasmine.SpyObj<DialogService>;
  let drr: CanvasGestureStore;
  let inline: EditorInlineEditService;
  let elsState: EditorElementsStateService;
  let paramMap$: BehaviorSubject<ParamMap>;
  let pagesCb: PagesCallback | null;
  let commentsCb: CommentsCallback | null;
  let projectCb: ProjectCallback | null;
  let unsubPages: jasmine.Spy;
  let unsubComments: jasmine.Spy;
  let unsubProject: jasmine.Spy;

  beforeEach(() => {
    pagesCb = null;
    commentsCb = null;
    projectCb = null;
    unsubPages = jasmine.createSpy('unsubPages');
    unsubComments = jasmine.createSpy('unsubComments');
    unsubProject = jasmine.createSpy('unsubProject');
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({}));

    projects = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', [
      'subscribePages',
      'subscribeComments',
      'subscribeProjectDoc',
      'subscribeElements',
      'addPage',
      'deletePage',
    ]);
    projects.subscribePages.and.callFake((_t: string, _p: string, cb: PagesCallback) => {
      pagesCb = cb;
      return unsubPages as unknown as () => void;
    });
    projects.subscribeComments.and.callFake((_t: string, _p: string, cb: CommentsCallback) => {
      commentsCb = cb;
      return unsubComments as unknown as () => void;
    });
    projects.subscribeProjectDoc.and.callFake((_t: string, _p: string, cb: ProjectCallback) => {
      projectCb = cb;
      return unsubProject as unknown as () => void;
    });
    projects.subscribeElements.and.returnValue((() => undefined) as unknown as () => void);
    projects.addPage.and.returnValue(Promise.resolve('new-page-id'));
    projects.deletePage.and.returnValue(Promise.resolve());

    tenants = jasmine.createSpyObj<TenantService>('TenantService', ['setCurrent']);
    collab = jasmine.createSpyObj<CollabService>('CollabService', [
      'connect',
      'disconnect',
      'sendEdit',
      'flushPendingEdits',
    ]);
    dialog = jasmine.createSpyObj<DialogService>('DialogService', ['alert', 'confirm']);
    dialog.alert.and.returnValue(Promise.resolve());
    dialog.confirm.and.returnValue(Promise.resolve(true));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        { provide: ProjectApiService, useValue: projects },
        { provide: TenantService, useValue: tenants },
        { provide: CollabService, useValue: collab },
        { provide: DialogService, useValue: dialog },
        WorkspaceStore,
        CommentsStore,
        CanvasGestureStore,
        EditorViewportService,
        EditorSessionService,
      ],
    });
    svc = TestBed.inject(EditorSessionService);
    drr = TestBed.inject(CanvasGestureStore);
    inline = TestBed.inject(EditorInlineEditService);
    elsState = TestBed.inject(EditorElementsStateService);
  });

  function emitRoute(tid: string, pid: string): void {
    paramMap$.next(convertToParamMap({ tid, pid }));
    TestBed.flushEffects();
  }

  function flushPagesAndCheck(): void {
    TestBed.flushEffects();
  }

  function page(id: string, order: number, name = `Page ${order + 1}`): IPageDoc {
    return { id, name, order, width: 1200, height: 800 };
  }

  describe('init', () => {
    it('wires pages/comments/project subscriptions when tid+pid are present', () => {
      emitRoute('t1', 'p1');
      expect(projects.subscribePages).toHaveBeenCalledWith('t1', 'p1', jasmine.any(Function));
      expect(projects.subscribeComments).toHaveBeenCalledWith('t1', 'p1', jasmine.any(Function));
      expect(projects.subscribeProjectDoc).toHaveBeenCalledWith('t1', 'p1', jasmine.any(Function));
      expect(tenants.setCurrent).toHaveBeenCalledWith('t1');
      expect(collab.connect).toHaveBeenCalledWith('t1', 'p1');
      expect(svc.tid()).toBe('t1');
      expect(svc.pid()).toBe('p1');
    });

    it('no-ops when tid or pid is missing from the route', () => {
      emitRoute('', '');
      expect(projects.subscribePages).not.toHaveBeenCalled();
      expect(collab.connect).not.toHaveBeenCalled();
    });

    it('early-returns when the same tid+pid re-emits', () => {
      emitRoute('t1', 'p1');
      projects.subscribePages.calls.reset();
      tenants.setCurrent.calls.reset();
      collab.connect.calls.reset();
      emitRoute('t1', 'p1');
      expect(projects.subscribePages).not.toHaveBeenCalled();
      expect(tenants.setCurrent).not.toHaveBeenCalled();
      expect(collab.connect).not.toHaveBeenCalled();
    });

    it('tears down previous subscriptions when tid/pid changes', () => {
      emitRoute('t1', 'p1');
      emitRoute('t2', 'p2');
      expect(unsubPages).toHaveBeenCalled();
      expect(unsubComments).toHaveBeenCalled();
      expect(unsubProject).toHaveBeenCalled();
    });

    it('pages callback triggers setActivePage when current is unset/invalid', () => {
      emitRoute('t1', 'p1');
      expect(pagesCb).toBeTruthy();
      pagesCb!([page('pg-a', 0), page('pg-b', 1)]);
      flushPagesAndCheck();
      expect(svc.activePageId()).toBe('pg-a');
    });

    it('pages callback clears activePageId when the project has zero pages', () => {
      emitRoute('t1', 'p1');
      pagesCb!([page('pg-a', 0)]);
      flushPagesAndCheck();
      pagesCb!([]);
      flushPagesAndCheck();
      expect(svc.activePageId()).toBeNull();
    });

    it('comments callback updates the comments signal', () => {
      emitRoute('t1', 'p1');
      commentsCb!([makeComment({ id: 'c1', text: 'hi' })]);
      expect(svc.comments().length).toBe(1);
    });

    it('project doc callback merges gridConfig over defaults', () => {
      emitRoute('t1', 'p1');
      // Firestore may store partial configs; the service should widen them
      // against the defaults when rehydrating.
      const partial = { visible: true, columns: 8 } as unknown as IProject['gridConfig'];
      projectCb!(makeProject({ gridConfig: partial }));
      const cfg = svc.gridConfig();
      expect(cfg.visible).toBeTrue();
      expect(cfg.columns).toBe(8);
      expect(cfg.snap).toBeTrue();
      expect(cfg.gutter).toBe(16);
    });
  });

  describe('setActivePage', () => {
    it('updates the activePageId signal', () => {
      emitRoute('t1', 'p1');
      svc.setActivePage('pg-x');
      expect(svc.activePageId()).toBe('pg-x');
    });

    it('cancels drag and stops inline edit when the page actually changes', () => {
      emitRoute('t1', 'p1');
      svc.setActivePage('pg-a');
      TestBed.flushEffects();
      drr.beginDrag(
        { id: 'e1', pageId: 'pg-a', x: 0, y: 0, w: 10, h: 10, zIndex: 0, type: 'rect' } as never,
        { clientX: 0, clientY: 0 },
        't1',
        'p1',
      );
      inline.begin('e1');
      svc.setActivePage('pg-b');
      TestBed.flushEffects();
      expect(drr.drag).toBeNull();
      expect(inline.editingId()).toBeNull();
    });

    it('does not cancel drag when the target page matches the current one', () => {
      emitRoute('t1', 'p1');
      svc.setActivePage('pg-a');
      TestBed.flushEffects();
      drr.beginDrag(
        { id: 'e1', pageId: 'pg-a', x: 0, y: 0, w: 10, h: 10, zIndex: 0, type: 'rect' } as never,
        { clientX: 0, clientY: 0 },
        't1',
        'p1',
      );
      svc.setActivePage('pg-a');
      TestBed.flushEffects();
      expect(drr.drag).not.toBeNull();
    });
  });

  describe('addPage', () => {
    it('calls projectApi.addPage and activates the returned id', async () => {
      emitRoute('t1', 'p1');
      pagesCb!([page('pg-a', 0)]);
      TestBed.flushEffects();
      await svc.addPage();
      expect(projects.addPage).toHaveBeenCalledWith('t1', 'p1', 'Page 2', 1);
      expect(svc.activePageId()).toBe('new-page-id');
    });
  });

  describe('requestDeletePage', () => {
    it('alerts and bails when only one page exists', async () => {
      emitRoute('t1', 'p1');
      pagesCb!([page('only', 0)]);
      TestBed.flushEffects();
      await svc.requestDeletePage('only');
      expect(dialog.alert).toHaveBeenCalled();
      expect(projects.deletePage).not.toHaveBeenCalled();
    });

    it('deletes the page, reroutes to a neighbor, and emits a collab edit', async () => {
      emitRoute('t1', 'p1');
      pagesCb!([page('a', 0), page('b', 1), page('c', 2)]);
      TestBed.flushEffects();
      svc.setActivePage('b');
      await svc.requestDeletePage('b');
      expect(dialog.confirm).toHaveBeenCalled();
      expect(svc.activePageId()).toBe('c');
      expect(projects.deletePage).toHaveBeenCalledWith('t1', 'p1', 'b');
      expect(collab.sendEdit).toHaveBeenCalledWith('page:b', { deleted: true });
    });

    it('reroutes to the previous sibling when the deleted page is last', async () => {
      emitRoute('t1', 'p1');
      pagesCb!([page('a', 0), page('b', 1)]);
      TestBed.flushEffects();
      svc.setActivePage('b');
      await svc.requestDeletePage('b');
      expect(svc.activePageId()).toBe('a');
    });

    it('aborts quietly when the user cancels the confirm dialog', async () => {
      dialog.confirm.and.returnValue(Promise.resolve(false));
      emitRoute('t1', 'p1');
      pagesCb!([page('a', 0), page('b', 1)]);
      TestBed.flushEffects();
      await svc.requestDeletePage('b');
      expect(projects.deletePage).not.toHaveBeenCalled();
      expect(collab.sendEdit).not.toHaveBeenCalled();
    });

    it('stops the supplied event from propagating', async () => {
      emitRoute('t1', 'p1');
      pagesCb!([page('a', 0), page('b', 1)]);
      TestBed.flushEffects();
      const ev = new MouseEvent('click');
      spyOn(ev, 'stopPropagation');
      await svc.requestDeletePage('b', ev);
      expect(ev.stopPropagation).toHaveBeenCalled();
    });
  });

  describe('computed views', () => {
    it('openComments filters resolved comments out', () => {
      emitRoute('t1', 'p1');
      commentsCb!([makeComment({ id: 'c1' }), makeComment({ id: 'c2', resolved: true })]);
      TestBed.flushEffects();
      expect(svc.openComments().length).toBe(1);
    });

    it('pageComments filters by activePageId (comments without pageId are universal)', () => {
      emitRoute('t1', 'p1');
      commentsCb!([
        makeComment({ id: 'c1', pageId: 'pg-a' }),
        makeComment({ id: 'c2', pageId: 'pg-b' }),
        makeComment({ id: 'c3' }),
      ]);
      TestBed.flushEffects();
      svc.setActivePage('pg-a');
      TestBed.flushEffects();
      const visible = svc.pageComments().map((c) => c.id);
      expect(visible).toContain('c1');
      expect(visible).toContain('c3');
      expect(visible).not.toContain('c2');
    });
  });

  it('elements-state is reset on tid/pid change and avoids double resets on duplicates', () => {
    const resetSpy = spyOn(elsState, 'reset').and.callThrough();
    emitRoute('t1', 'p1');
    expect(resetSpy).toHaveBeenCalledTimes(1);
    emitRoute('t1', 'p1');
    expect(resetSpy).toHaveBeenCalledTimes(1);
    emitRoute('t2', 'p2');
    expect(resetSpy).toHaveBeenCalledTimes(2);
  });
});

describe('EditorSessionService teardown', () => {
  it('disconnects collab and unsubscribes on destroy', () => {
    const unsubPages = jasmine.createSpy('unsubPages');
    const unsubComments = jasmine.createSpy('unsubComments');
    const unsubProject = jasmine.createSpy('unsubProject');
    const paramMap$ = new BehaviorSubject(convertToParamMap({ tid: 't1', pid: 'p1' }));

    const projects = jasmine.createSpyObj<ProjectApiService>('ProjectApiService', [
      'subscribePages',
      'subscribeComments',
      'subscribeProjectDoc',
      'subscribeElements',
      'addPage',
      'deletePage',
    ]);
    projects.subscribePages.and.returnValue(unsubPages as unknown as () => void);
    projects.subscribeComments.and.returnValue(unsubComments as unknown as () => void);
    projects.subscribeProjectDoc.and.returnValue(unsubProject as unknown as () => void);
    projects.subscribeElements.and.returnValue((() => undefined) as unknown as () => void);
    const tenants = jasmine.createSpyObj<TenantService>('TenantService', ['setCurrent']);
    const collab = jasmine.createSpyObj<CollabService>('CollabService', [
      'connect',
      'disconnect',
      'sendEdit',
      'flushPendingEdits',
    ]);
    const dialog = jasmine.createSpyObj<DialogService>('DialogService', ['alert', 'confirm']);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
        { provide: ProjectApiService, useValue: projects },
        { provide: TenantService, useValue: tenants },
        { provide: CollabService, useValue: collab },
        { provide: DialogService, useValue: dialog },
        WorkspaceStore,
        CommentsStore,
        CanvasGestureStore,
        EditorViewportService,
        EditorSessionService,
      ],
    });
    const svc = TestBed.inject(EditorSessionService);
    // BehaviorSubject already emitted on subscribe, so subscriptions wired.
    TestBed.flushEffects();
    // Silence unused-signal warning
    expect(svc.tid()).toBe('t1');
    TestBed.resetTestingModule();
    expect(unsubPages).toHaveBeenCalled();
    expect(unsubComments).toHaveBeenCalled();
    expect(unsubProject).toHaveBeenCalled();
    expect(collab.disconnect).toHaveBeenCalled();
  });
});
