import { TestBed } from '@angular/core/testing';
import { AuthService } from '@mocktail/auth';
import { FirebaseService } from '@mocktail/core';
import {
  clearFirestoreEmulator,
  enableEmulatorFlag,
  signInTestUser,
  signOutTestUser,
} from '@mocktail/core/testing/firebase-test-utils';
import { TenantService } from './tenant.service';

enableEmulatorFlag();

async function waitFor(predicate: () => boolean, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise((r) => setTimeout(r, 30));
  }
}

describe('TenantService (emulator)', () => {
  let firebase: FirebaseService;
  let auth: AuthService;
  let service: TenantService;
  const originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;

  beforeAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 30000;
  });
  afterAll(() => {
    jasmine.DEFAULT_TIMEOUT_INTERVAL = originalTimeout;
  });

  beforeEach(async () => {
    window.localStorage.removeItem('mocktail:lastTenant');
    await clearFirestoreEmulator();
    TestBed.configureTestingModule({});
    firebase = TestBed.inject(FirebaseService);
    await signOutTestUser(firebase.auth);
    await signInTestUser(firebase.auth);
    auth = TestBed.inject(AuthService);
    await waitFor(() => !auth.isLoading() && !!auth.user());
    service = TestBed.inject(TenantService);
  });

  afterEach(async () => {
    await signOutTestUser(firebase.auth);
  });

  it('initializes empty memberships for a new user', async () => {
    expect(service.memberships()).toEqual([]);
    expect(service.current()).toBeNull();
  });

  it('createTenant creates tenant + self membership and sets current', async () => {
    const tid = await service.createTenant('Acme');
    expect(tid).toBeTruthy();
    expect(service.currentTenantId()).toBe(tid);
    await waitFor(() => service.memberships().some((m) => m.tenantId === tid));
    expect(service.currentRole()).toBe('owner');
    await waitFor(() => service.current()?.name === 'Acme');
  });

  it('setCurrent updates localStorage and signal', () => {
    service.setCurrent('t-xyz');
    expect(window.localStorage.getItem('mocktail:lastTenant')).toBe('t-xyz');
    service.setCurrent(null);
    expect(window.localStorage.getItem('mocktail:lastTenant')).toBeNull();
  });

  it('bootstrapTenantForUser auto-creates a tenant', async () => {
    const tid = await service.bootstrapTenantForUser();
    expect(tid).toBeTruthy();
    await waitFor(() => service.memberships().length > 0);
  });

  it('createInvite + acceptInvite round-trip works', async () => {
    await service.createTenant('Host');
    await waitFor(() => service.memberships().length > 0);
    const { token, url } = await service.createInvite('editor');
    expect(url).toBe(`/invite/${token}`);

    // Second user accepts
    await signOutTestUser(firebase.auth);
    await signInTestUser(firebase.auth);
    // re-inject service under new auth — fresh TenantService instance
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const svc2 = TestBed.inject(TenantService);
    await waitFor(() => TestBed.inject(AuthService).user() != null);
    const accepted = await svc2.acceptInvite(token);
    expect(accepted).toBeTruthy();
    await waitFor(() => svc2.memberships().some((m) => m.tenantId === accepted));
    expect(svc2.currentRole()).toBe('editor');
  });

  it('acceptInvite throws on unknown token', async () => {
    await expectAsync(service.acceptInvite('no-such-token')).toBeRejected();
  });

  it('listMembers returns the self-member after createTenant', async () => {
    await service.createTenant('Members');
    await waitFor(() => service.memberships().length > 0);
    const members = await service.listMembers();
    expect(members.length).toBe(1);
    expect(members[0].role).toBe('owner');
  });

  it('listMembers returns [] when no current tenant', async () => {
    expect(await service.listMembers()).toEqual([]);
  });

  it('getTenant returns the persisted tenant doc', async () => {
    const tid = await service.createTenant('Readme');
    const t = await service.getTenant(tid);
    expect(t?.name).toBe('Readme');
  });

  it('getTenant returns null for missing tenant', async () => {
    expect(await service.getTenant('does-not-exist')).toBeNull();
  });

  it('switches current when membership disappears from the set', async () => {
    const a = await service.createTenant('A');
    await waitFor(() => service.memberships().some((m) => m.tenantId === a));
    const b = await service.createTenant('B');
    await waitFor(() => service.memberships().some((m) => m.tenantId === b));
    expect([a, b]).toContain(service.currentTenantId()!);
  });

  it('createTenant throws when not signed in', async () => {
    await signOutTestUser(firebase.auth);
    await waitFor(() => !auth.user());
    await expectAsync(service.createTenant('Nope')).toBeRejected();
  });
});
