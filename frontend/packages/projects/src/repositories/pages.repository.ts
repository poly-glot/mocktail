import { Injectable, inject } from '@angular/core';
import { FirebaseService } from '@mocktail/core';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { IPageDoc } from '../interfaces/project.interface';

@Injectable({ providedIn: 'root' })
export class PagesRepository {
  private readonly _firebase = inject(FirebaseService);

  public subscribePages(
    tid: string,
    pid: string,
    onChange: (pages: IPageDoc[]) => void,
  ): () => void {
    const q = query(
      collection(this._firebase.db, 'tenants', tid, 'projects', pid, 'pages'),
      orderBy('order', 'asc'),
    );
    return onSnapshot(
      q,
      (snap) => {
        const rows: IPageDoc[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: (data['name'] as string) ?? 'Page',
            order: (data['order'] as number) ?? 0,
            width: (data['width'] as number) ?? 1200,
            height: (data['height'] as number) ?? 800,
          };
        });
        onChange(rows);
      },
      (err) => console.error('[project] pages subscription error', err),
    );
  }

  public async addPage(tid: string, pid: string, name: string, order: number): Promise<string> {
    const ref = await addDoc(
      collection(this._firebase.db, 'tenants', tid, 'projects', pid, 'pages'),
      {
        name,
        order,
        width: 1200,
        height: 800,
        createdAt: serverTimestamp(),
      },
    );
    return ref.id;
  }

  public async deletePage(tid: string, pid: string, pageId: string): Promise<void> {
    const db = this._firebase.db;
    const elementsQ = query(
      collection(db, 'tenants', tid, 'projects', pid, 'elements'),
      where('pageId', '==', pageId),
    );
    const elsSnap = await getDocs(elementsQ);
    const batch = writeBatch(db);
    for (const elDoc of elsSnap.docs) {
      batch.delete(elDoc.ref);
    }
    batch.delete(doc(db, 'tenants', tid, 'projects', pid, 'pages', pageId));
    batch.set(
      doc(db, 'tenants', tid, 'projects', pid),
      { updatedAt: serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
  }
}
