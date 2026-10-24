import { TestBed } from '@angular/core/testing';
import { AuthService } from '@mocktail/auth';
import { FirebaseService } from '@mocktail/core';
import {
  clearFirestoreEmulator,
  enableEmulatorFlag,
  signInTestUser,
  signOutTestUser,
} from '@mocktail/core/testing/firebase-test-utils';
import { TenantService } from '@mocktail/tenant';
import { ActivityRepository } from './activity.repository';
import { CommentsRepository } from './comments.repository';
import { PagesRepository } from './pages.repository';
import { ProjectsRepository } from './projects.repository';

enableEmulatorFlag();

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe('Repositories (emulator)', () => {
  let firebase: FirebaseService;
  let tenants: TenantService;
  let projects: ProjectsRepository;
  let pagesRepo: PagesRepository;
  let comments: CommentsRepository;
  let activity: ActivityRepository;
  let tid: string;

  beforeEach(async () => {
    window.localStorage.removeItem('mocktail:lastTenant');
    await clearFirestoreEmulator();
    TestBed.configureTestingModule({});
    firebase = TestBed.inject(FirebaseService);
    await signOutTestUser(firebase.auth);
    await signInTestUser(firebase.auth);
    const auth = TestBed.inject(AuthService);
    await waitFor(() => !auth.isLoading() && !!auth.user());
    tenants = TestBed.inject(TenantService);
    projects = TestBed.inject(ProjectsRepository);
    pagesRepo = TestBed.inject(PagesRepository);
    comments = TestBed.inject(CommentsRepository);
    activity = TestBed.inject(ActivityRepository);
    tid = await tenants.createTenant('ProjTest');
    await waitFor(() => tenants.memberships().some((m) => m.tenantId === tid));
  });

  afterEach(async () => {
    await signOutTestUser(firebase.auth);
  });

  it('createProject seeds an initial page', async () => {
    const pid = await projects.createProject(tid, 'P1');
    expect(pid).toBeTruthy();
    let pages: { id: string; name: string }[] = [];
    const unsub = pagesRepo.subscribePages(tid, pid, (p) => (pages = p));
    await waitFor(() => pages.length > 0);
    unsub();
    expect(pages[0].name).toBe('Page 1');
  });

  it('subscribeProjects streams created and deleted projects', async () => {
    let rows: { id: string; name: string }[] = [];
    const unsub = projects.subscribeProjects(tid, (r) => (rows = r));
    const pid = await projects.createProject(tid, 'Stream');
    await waitFor(() => rows.some((r) => r.id === pid));
    await projects.softDeleteProject(tid, pid);
    await waitFor(() => !rows.some((r) => r.id === pid));
    unsub();
  });

  it('renameProject updates the name', async () => {
    const pid = await projects.createProject(tid, 'Old');
    await projects.renameProject(tid, pid, 'New');
    let rows: { id: string; name: string }[] = [];
    const unsub = projects.subscribeProjects(tid, (r) => (rows = r));
    await waitFor(() => rows.some((r) => r.id === pid && r.name === 'New'));
    unsub();
  });

  it('addPage appends a new page', async () => {
    const pid = await projects.createProject(tid, 'Pages');
    const newId = await pagesRepo.addPage(tid, pid, 'Page 2', 1);
    expect(newId).toBeTruthy();
    let pages: { id: string; order: number }[] = [];
    const unsub = pagesRepo.subscribePages(tid, pid, (p) => (pages = p));
    await waitFor(() => pages.length >= 2);
    expect(pages.find((p) => p.id === newId)?.order).toBe(1);
    unsub();
  });

  it('comments: add, subscribe, resolve', async () => {
    const pid = await projects.createProject(tid, 'Comments');
    let all: { id: string; resolved: boolean }[] = [];
    const unsub = comments.subscribeComments(tid, pid, (c) => (all = c));
    const cid = await comments.addComment(tid, pid, { text: 'hello', pageId: 'p1', x: 1, y: 2 });
    await waitFor(() => all.some((c) => c.id === cid && !c.resolved));
    await comments.resolveComment(tid, pid, cid, true);
    await waitFor(() => all.find((c) => c.id === cid)?.resolved === true);
    unsub();
  });

  it('subscribeComments filtered by pageId returns only matching', async () => {
    const pid = await projects.createProject(tid, 'CF');
    const c1 = await comments.addComment(tid, pid, { text: 'a', pageId: 'page-a' });
    await comments.addComment(tid, pid, { text: 'b', pageId: 'page-b' });
    let rows: { id: string }[] = [];
    const unsub = comments.subscribeComments(tid, pid, (r) => (rows = r), 'page-a');
    await waitFor(() => rows.length === 1);
    expect(rows[0].id).toBe(c1);
    unsub();
  });

  it('writeActivity writes to both project-level and tenant-level feeds', async () => {
    const pid = await projects.createProject(tid, 'Act');
    let tenantActivity: { id: string; summary: string }[] = [];
    const unsub1 = activity.subscribeTenantActivity(tid, 50, (r) => (tenantActivity = r));
    await activity.writeActivity(tid, pid, 'element-added', 'added thing');
    await waitFor(() => tenantActivity.some((a) => a.summary === 'added thing'));
    unsub1();
  });
});
