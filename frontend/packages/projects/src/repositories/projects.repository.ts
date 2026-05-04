import { Injectable, Signal, inject } from '@angular/core';
import { AuthService } from '@mocktail/auth';
import { FirebaseService } from '@mocktail/core';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { IGridConfig, IProject } from '../interfaces/project.interface';
import { firestoreSignal } from './firestore-signal';

@Injectable({ providedIn: 'root' })
export class ProjectsRepository {
  private readonly _authService = inject(AuthService);
  private readonly _firebase = inject(FirebaseService);

  /**
   * Reactive variant of {@link subscribeProjects}: the supplied `tid` is read
   * inside the underlying effect so the listener re-subscribes whenever the
   * tenant id changes. Cleanup runs via DestroyRef.
   */
  public projectsSignal(tid: Signal<string | null>): Signal<IProject[]> {
    return firestoreSignal<IProject[]>([], (next) => {
      const id = tid();
      if (!id) return null;
      return this.subscribeProjects(id, next);
    });
  }

  public subscribeProjects(tid: string, onChange: (projects: IProject[]) => void): () => void {
    const q = query(
      collection(this._firebase.db, 'tenants', tid, 'projects'),
      where('deleted', '==', false),
      orderBy('updatedAt', 'desc'),
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows: IProject[] = [];
        for (const d of snap.docs) {
          const data = d.data() as Record<string, unknown>;
          rows.push({
            id: d.id,
            name: (data['name'] as string) ?? 'Untitled',
            createdAt: data['createdAt'],
            updatedAt: data['updatedAt'],
            createdBy: data['createdBy'] as string | undefined,
            deleted: !!data['deleted'],
          });
        }
        onChange(rows);
      },
      (err) => console.error('project subscription error', err),
    );
  }

  public subscribeProjectDoc(
    tid: string,
    pid: string,
    onChange: (proj: IProject | null) => void,
  ): () => void {
    return onSnapshot(doc(this._firebase.db, 'tenants', tid, 'projects', pid), (snap) => {
      if (!snap.exists()) {
        onChange(null);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      onChange({
        id: snap.id,
        name: (data['name'] as string) ?? 'Untitled',
        createdAt: data['createdAt'],
        updatedAt: data['updatedAt'],
        createdBy: data['createdBy'] as string | undefined,
        deleted: !!data['deleted'],
        gridConfig: (data['gridConfig'] as IGridConfig | undefined) ?? undefined,
      });
    });
  }

  public async createProject(tid: string, name: string): Promise<string> {
    const db = this._firebase.db;
    const user = this._authService.user();
    const ref = await addDoc(collection(db, 'tenants', tid, 'projects'), {
      name,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user?.uid ?? null,
      deleted: false,
    });
    await setDoc(doc(db, 'tenants', tid, 'projects', ref.id, 'pages', 'p1'), {
      name: 'Page 1',
      order: 0,
      width: 1200,
      height: 800,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  }

  public async renameProject(tid: string, pid: string, name: string): Promise<void> {
    await updateDoc(doc(this._firebase.db, 'tenants', tid, 'projects', pid), {
      name,
      updatedAt: serverTimestamp(),
    });
  }

  public async softDeleteProject(tid: string, pid: string): Promise<void> {
    await updateDoc(doc(this._firebase.db, 'tenants', tid, 'projects', pid), {
      deleted: true,
      updatedAt: serverTimestamp(),
    });
  }
}
