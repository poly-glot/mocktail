import { Injectable, inject } from '@angular/core';
import { AuthService } from '@mocktail/auth';
import { FirebaseService } from '@mocktail/core';
import {
  addDoc,
  collection,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import { ActivityType, IActivity } from '../interfaces/project.interface';

@Injectable({ providedIn: 'root' })
export class ActivityRepository {
  private readonly _authService = inject(AuthService);
  private readonly _firebase = inject(FirebaseService);

  public async writeActivity(
    tid: string,
    pid: string,
    type: ActivityType,
    summary: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    const user = this._authService.user();
    if (!user) return;
    const db = this._firebase.db;
    const payload: Record<string, unknown> = {
      type,
      actorId: user.uid,
      actorName: user.displayName ?? user.email?.split('@')[0] ?? 'Member',
      projectId: pid,
      summary,
      createdAt: serverTimestamp(),
    };
    if (extra) payload['data'] = extra;
    try {
      await Promise.all([
        addDoc(collection(db, 'tenants', tid, 'projects', pid, 'activity'), payload),
        addDoc(collection(db, 'tenants', tid, 'activity'), payload),
      ]);
    } catch {
      // best-effort
    }
  }

  public subscribeTenantActivity(
    tid: string,
    max: number,
    onChange: (rows: IActivity[]) => void,
  ): () => void {
    const q = query(
      collection(this._firebase.db, 'tenants', tid, 'activity'),
      orderBy('createdAt', 'desc'),
      fsLimit(max),
    );
    return onSnapshot(q, (snap) => {
      const rows: IActivity[] = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          type: data['type'] as ActivityType,
          actorId: (data['actorId'] as string) ?? '',
          actorName: (data['actorName'] as string) ?? 'Someone',
          projectId: (data['projectId'] as string) ?? '',
          summary: (data['summary'] as string) ?? '',
          createdAt: data['createdAt'],
        };
      });
      onChange(rows);
    });
  }

  public subscribeActivity(
    tid: string,
    pid: string,
    max: number,
    onChange: (rows: IActivity[]) => void,
  ): () => void {
    const q = query(
      collection(this._firebase.db, 'tenants', tid, 'projects', pid, 'activity'),
      orderBy('createdAt', 'desc'),
      fsLimit(max),
    );
    return onSnapshot(q, (snap) => {
      const rows: IActivity[] = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          type: data['type'] as ActivityType,
          actorId: (data['actorId'] as string) ?? '',
          actorName: (data['actorName'] as string) ?? 'Someone',
          projectId: (data['projectId'] as string) ?? pid,
          summary: (data['summary'] as string) ?? '',
          createdAt: data['createdAt'],
        };
      });
      onChange(rows);
    });
  }
}
