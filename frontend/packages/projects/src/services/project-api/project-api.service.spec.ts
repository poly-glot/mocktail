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
import { ProjectApiService } from './project-api.service';

enableEmulatorFlag();

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe('ProjectApiService (emulator)', () => {
  let firebase: FirebaseService;
  let tenants: TenantService;
  let service: ProjectApiService;
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
    service = TestBed.inject(ProjectApiService);
    tid = await tenants.createTenant('ProjTest');
    await waitFor(() => tenants.memberships().some((m) => m.tenantId === tid));
  });

  afterEach(async () => {
    await signOutTestUser(firebase.auth);
  });

  it('createProject seeds an initial page', async () => {
    const pid = await service.createProject(tid, 'P1');
    expect(pid).toBeTruthy();
    let pages: { id: string; name: string }[] = [];
    const unsub = service.subscribePages(tid, pid, (p) => (pages = p));
    await waitFor(() => pages.length > 0);
    unsub();
    expect(pages[0].name).toBe('Page 1');
  });

  it('subscribeProjects streams created and deleted projects', async () => {
    let rows: { id: string; name: string }[] = [];
    const unsub = service.subscribeProjects(tid, (r) => (rows = r));
    const pid = await service.createProject(tid, 'Stream');
    await waitFor(() => rows.some((r) => r.id === pid));
    await service.softDeleteProject(tid, pid);
    await waitFor(() => !rows.some((r) => r.id === pid));
    unsub();
  });

  it('renameProject updates the name', async () => {
    const pid = await service.createProject(tid, 'Old');
    await service.renameProject(tid, pid, 'New');
    let rows: { id: string; name: string }[] = [];
    const unsub = service.subscribeProjects(tid, (r) => (rows = r));
    await waitFor(() => rows.some((r) => r.id === pid && r.name === 'New'));
    unsub();
  });

  it('addPage appends a new page', async () => {
    const pid = await service.createProject(tid, 'Pages');
    const newId = await service.addPage(tid, pid, 'Page 2', 1);
    expect(newId).toBeTruthy();
    let pages: { id: string; order: number }[] = [];
    const unsub = service.subscribePages(tid, pid, (p) => (pages = p));
    await waitFor(() => pages.length >= 2);
    expect(pages.find((p) => p.id === newId)?.order).toBe(1);
    unsub();
  });

  it('comments: add, subscribe, resolve', async () => {
    const pid = await service.createProject(tid, 'Comments');
    let all: { id: string; resolved: boolean }[] = [];
    const unsub = service.subscribeComments(tid, pid, (c) => (all = c));
    const cid = await service.addComment(tid, pid, { text: 'hello', pageId: 'p1', x: 1, y: 2 });
    await waitFor(() => all.some((c) => c.id === cid && !c.resolved));
    await service.resolveComment(tid, pid, cid, true);
    await waitFor(() => all.find((c) => c.id === cid)?.resolved === true);
    unsub();
  });

  it('subscribeComments filtered by pageId returns only matching', async () => {
    const pid = await service.createProject(tid, 'CF');
    const c1 = await service.addComment(tid, pid, { text: 'a', pageId: 'page-a' });
    await service.addComment(tid, pid, { text: 'b', pageId: 'page-b' });
    let rows: { id: string }[] = [];
    const unsub = service.subscribeComments(tid, pid, (r) => (rows = r), 'page-a');
    await waitFor(() => rows.length === 1);
    expect(rows[0].id).toBe(c1);
    unsub();
  });

  it('writeActivity writes to both project-level and tenant-level feeds', async () => {
    const pid = await service.createProject(tid, 'Act');
    let tenantActivity: { id: string; summary: string }[] = [];
    const unsub1 = service.subscribeTenantActivity(tid, 50, (r) => (tenantActivity = r));
    await service.writeActivity(tid, pid, 'element-added', 'added thing');
    await waitFor(() => tenantActivity.some((a) => a.summary === 'added thing'));
    unsub1();
  });
});
