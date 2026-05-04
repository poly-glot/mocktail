import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from '@mocktail/auth';
import { FirebaseService } from '@mocktail/core';
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { distinctUntilChanged } from 'rxjs';
import { IMembership, ITenant, TenantRole } from './tenant.interface';

const LAST_TENANT_KEY = 'mocktail:lastTenant';

function slugFromEmail(email: string | null): string {
  if (!email) return 'team';
  const local = email.split('@')[0] ?? 'team';
  return local.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'team';
}

function slugifyName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’‘`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return cleaned || 'team';
}

function randomSuffix(len = 4): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const palette = ['#0a0a0a', '#1f2937', '#b45309', '#065f46', '#1e3a8a', '#7c3aed'];
  return palette[Math.abs(h) % palette.length];
}

@Injectable({ providedIn: 'root' })
export class TenantService {
  public readonly memberships = signal<IMembership[]>([]);
  public readonly currentTenantId = signal<string | null>(null);
  public readonly loading = signal(true);
  public readonly bootstrapping = signal(false);
  public readonly tenantsById = signal<Map<string, ITenant>>(new Map());

  // Observable views created eagerly so guards can consume them after awaits
  // (toObservable itself requires an injection context).
  public readonly memberships$ = toObservable(this.memberships);
  public readonly loading$ = toObservable(this.loading);

  public readonly current = computed<ITenant | null>(() => {
    const tid = this.currentTenantId();
    if (!tid) return null;
    return this.tenantsById().get(tid) ?? null;
  });

  private readonly _authService = inject(AuthService);
  private readonly _firebase = inject(FirebaseService);
  private _membershipUnsub: (() => void) | null = null;
  private _tenantUnsubs = new Map<string, () => void>();

  constructor() {
    const saved = window.localStorage.getItem(LAST_TENANT_KEY);
    if (saved) this.currentTenantId.set(saved);

    const destroyRef = inject(DestroyRef);
    toObservable(this._authService.user)
      .pipe(
        distinctUntilChanged((a, b) => (a?.uid ?? null) === (b?.uid ?? null)),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((u) => this._onUserChange(u?.uid ?? null));

    destroyRef.onDestroy(() => {
      this._membershipUnsub?.();
      this._membershipUnsub = null;
      this._tenantUnsubs.forEach((u) => u());
      this._tenantUnsubs.clear();
    });
  }

  public setCurrent(tid: string | null): void {
    this.currentTenantId.set(tid);
    if (tid) window.localStorage.setItem(LAST_TENANT_KEY, tid);
    else window.localStorage.removeItem(LAST_TENANT_KEY);
  }

  public currentRole(): TenantRole | null {
    const tid = this.currentTenantId();
    if (!tid) return null;
    return this.memberships().find((m) => m.tenantId === tid)?.role ?? null;
  }

  public async createTenant(name: string): Promise<string> {
    return this._createTenantImpl(name, true);
  }

  public async bootstrapTenantForUser(): Promise<string> {
    const user = this._authService.user();
    if (!user) throw new Error('not signed in');
    this.bootstrapping.set(true);
    try {
      const name = `${slugFromEmail(user.email)}'s team`;
      return await this._createTenantImpl(name, false);
    } finally {
      this.bootstrapping.set(false);
    }
  }

  private async _createTenantImpl(name: string, forceSetCurrent: boolean): Promise<string> {
    const db = this._firebase.db;
    const user = this._authService.user();
    if (!user) throw new Error('not signed in');

    const base = slugifyName(name);
    const candidates = [
      base,
      `${base}-2`,
      `${base}-3`,
      `${base}-4`,
      `${base}-5`,
      `${base}-${randomSuffix()}`,
    ];

    let lastError: unknown = null;
    for (const slug of candidates) {
      // Self-owned collision: if our own member doc already exists, we'd
      // overwrite our own tenant (rules allow update-by-owner). Skip to the
      // next candidate so renames/duplicates produce a new tenant.
      try {
        const ownMember = await getDoc(doc(db, 'tenants', slug, 'members', user.uid));
        if (ownMember.exists()) continue;
      } catch {
        // If we can't read our own member doc, fall through and attempt write.
      }

      try {
        const tenantRef = doc(db, 'tenants', slug);
        const memberRef = doc(db, 'tenants', slug, 'members', user.uid);
        const batch = writeBatch(db);
        batch.set(tenantRef, {
          name,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });
        batch.set(memberRef, {
          userId: user.uid,
          role: 'owner',
          displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Owner',
          email: user.email ?? '',
          color: pickColor(user.uid),
          createdAt: serverTimestamp(),
        });
        await batch.commit();
        // Seed memberships + tenants optimistically. The membership onSnapshot
        // intentionally skips `hasPendingWrites` updates, so the server-confirmed
        // row arrives asynchronously. If we don't seed, the guard racing our
        // setCurrent() navigation sees an empty membership list and redirects.
        this.memberships.update((rows) => {
          if (rows.some((r) => r.tenantId === slug)) return rows;
          return [
            ...rows,
            {
              tenantId: slug,
              role: 'owner',
              displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Owner',
              email: user.email ?? '',
            },
          ];
        });
        this.tenantsById.update((m) => {
          if (m.has(slug)) return m;
          const next = new Map(m);
          next.set(slug, { id: slug, name, ownerId: user.uid });
          return next;
        });
        // Explicit createTenant always becomes current. Auto-bootstrap only
        // claims current when nothing else already has — so a concurrent
        // explicit call (e.g. user creating a named tenant while bootstrap
        // races in the background) keeps its chosen current.
        if (forceSetCurrent || !this.currentTenantId()) {
          this.setCurrent(slug);
        }
        return slug;
      } catch (err) {
        // A permission-denied on the tenant write means another user owns
        // this slug (rules allow create only when the doc doesn't exist, and
        // update only for existing owners). Any other error is also retryable
        // against the next candidate — if all fail we rethrow below.
        lastError = err;
        continue;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('failed to create tenant after all candidates');
  }

  public async createInvite(
    role: 'editor' | 'viewer' = 'editor',
  ): Promise<{ token: string; url: string }> {
    const tid = this.currentTenantId();
    const user = this._authService.user();
    if (!tid || !user) throw new Error('no tenant');
    const token = this._randomToken();
    const ref = doc(this._firebase.db, 'tenants', tid, 'invites', token);
    await setDoc(ref, {
      tenantId: tid,
      token,
      role,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      accepted: false,
    });
    return { token, url: `/invite/${token}` };
  }

  public async acceptInvite(token: string): Promise<string> {
    const db = this._firebase.db;
    const user = this._authService.user();
    if (!user) throw new Error('not signed in');
    const q = query(collectionGroup(db, 'invites'), where('token', '==', token));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error('Invite not found or already used');
    const inviteDoc = snap.docs[0];
    const tenantId = inviteDoc.ref.parent.parent?.id;
    if (!tenantId) throw new Error('Invite malformed');
    const data = inviteDoc.data() as Record<string, unknown>;
    const role = (data['role'] ?? 'editor') as TenantRole;
    const memberRef = doc(db, 'tenants', tenantId, 'members', user.uid);
    await setDoc(memberRef, {
      userId: user.uid,
      role,
      displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Member',
      email: user.email ?? '',
      color: pickColor(user.uid),
      createdAt: serverTimestamp(),
    });
    try {
      await setDoc(
        inviteDoc.ref,
        { ...data, accepted: true, acceptedBy: user.uid },
        { merge: true },
      );
    } catch {
      // ignore
    }
    this.setCurrent(tenantId);
    return tenantId;
  }

  public async listMembers(): Promise<
    { id: string; role: string; displayName?: string; email?: string; color?: string }[]
  > {
    const tid = this.currentTenantId();
    if (!tid) return [];
    const snap = await getDocs(collection(this._firebase.db, 'tenants', tid, 'members'));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as {
      id: string;
      role: string;
      displayName?: string;
      email?: string;
      color?: string;
    }[];
  }

  public async getTenant(tid: string): Promise<ITenant | null> {
    // Rules gate tenant reads on membership, so a non-member sees
    // `permission-denied` rather than "not found". Treat both as null —
    // a tenant the caller can't see is, to them, indistinguishable from
    // a tenant that doesn't exist.
    let snap;
    try {
      snap = await getDoc(doc(this._firebase.db, 'tenants', tid));
    } catch (err) {
      if ((err as { code?: string }).code === 'permission-denied') return null;
      throw err;
    }
    if (!snap.exists()) return null;
    const data = snap.data() as Record<string, unknown>;
    return {
      id: tid,
      name: (data['name'] as string) ?? 'Tenant',
      ownerId: (data['ownerId'] as string) ?? '',
    };
  }

  private async _onUserChange(uid: string | null): Promise<void> {
    const db = this._firebase.db;
    this.currentTenantId.set(null);
    window.localStorage.removeItem(LAST_TENANT_KEY);
    this._membershipUnsub?.();
    this._membershipUnsub = null;
    this._tenantUnsubs.forEach((unsub) => unsub());
    this._tenantUnsubs.clear();
    this.memberships.set([]);
    this.tenantsById.set(new Map());

    if (!uid) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);

    try {
      const memQ = query(collectionGroup(db, 'members'), where('userId', '==', uid));
      this._membershipUnsub = onSnapshot(
        memQ,
        async (snap) => {
          // Skip optimistic snapshots: the Firestore SDK fires onSnapshot
          // from locally-applied batch writes before the server has durably
          // committed the member doc. Subscribing to tenant/project docs at
          // that moment races with rule evaluation → permission-denied.
          if (snap.metadata.hasPendingWrites) return;
          const rows: IMembership[] = [];
          for (const d of snap.docs) {
            const data = d.data() as Record<string, unknown>;
            const tenantId = d.ref.parent.parent?.id;
            if (!tenantId) continue;
            rows.push({
              tenantId,
              role: (data['role'] as TenantRole) ?? 'viewer',
              displayName: data['displayName'] as string | undefined,
              email: data['email'] as string | undefined,
            });
          }
          this.memberships.set(rows);

          await this._syncTenantSubscriptions(rows.map((m) => m.tenantId));

          if (rows.length === 0 && !this.bootstrapping()) {
            const user = this._authService.user();
            if (user) {
              try {
                await this.bootstrapTenantForUser();
              } catch (err) {
                console.error('[tenant] bootstrap failed', err);
              }
            }
          } else if (!this.currentTenantId() && rows.length > 0) {
            this.setCurrent(rows[0].tenantId);
          } else if (
            this.currentTenantId() &&
            !rows.some((r) => r.tenantId === this.currentTenantId())
          ) {
            this.setCurrent(rows[0]?.tenantId ?? null);
          }
          this.loading.set(false);
        },
        (err) => {
          console.error('membership subscription error', err);
          this.loading.set(false);
        },
      );
    } catch (err) {
      console.error('memberships load failed', err);
      this.loading.set(false);
    }
  }

  private async _syncTenantSubscriptions(tenantIds: string[]): Promise<void> {
    const db = this._firebase.db;
    const desired = new Set(tenantIds);
    for (const [tid, unsub] of this._tenantUnsubs) {
      if (!desired.has(tid)) {
        unsub();
        this._tenantUnsubs.delete(tid);
      }
    }
    for (const tid of tenantIds) {
      if (this._tenantUnsubs.has(tid)) continue;
      const ref = doc(db, 'tenants', tid);
      const unsub = onSnapshot(ref, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        this.tenantsById.update((m) => {
          const next = new Map(m);
          next.set(tid, {
            id: tid,
            name: (data['name'] as string) ?? 'Tenant',
            ownerId: (data['ownerId'] as string) ?? '',
          });
          return next;
        });
      });
      this._tenantUnsubs.set(tid, unsub);
    }
  }

  private _randomToken(): string {
    const arr = new Uint8Array(18);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 24);
  }
}
