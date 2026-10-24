import { Injectable, inject } from '@angular/core';
import { FirebaseService } from '@mocktail/core';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { IWireElement } from '../interfaces/project.interface';
import { decodeElement } from './element-codec';

@Injectable({ providedIn: 'root' })
export class ElementsRepository {
  private readonly _firebase = inject(FirebaseService);

  public subscribeElements(
    tid: string,
    pid: string,
    pageId: string,
    onChange: (els: IWireElement[], meta: { hasPendingWrites: boolean }) => void,
  ): () => void {
    const q = query(
      collection(this._firebase.db, 'tenants', tid, 'projects', pid, 'elements'),
      where('pageId', '==', pageId),
      orderBy('zIndex', 'asc'),
    );
    return onSnapshot(q, (snap) => {
      const rows: IWireElement[] = snap.docs.map((d) =>
        decodeElement(d.id, d.data() as Record<string, unknown>),
      );
      onChange(rows, { hasPendingWrites: snap.metadata.hasPendingWrites });
    });
  }
}
