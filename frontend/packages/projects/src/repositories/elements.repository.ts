import { Injectable, inject } from '@angular/core';
import { FirebaseService } from '@mocktail/core';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { IWireElement } from '../interfaces/project.interface';
import { decodeElement, stripUndefined } from './element-codec';

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

  public async patchElements(
    tid: string,
    pid: string,
    patches: readonly { id: string; patch: Partial<IWireElement> }[],
  ): Promise<void> {
    if (patches.length === 0) return;
    const db = this._firebase.db;
    const CHUNK = 499;
    let committedChunks = 0;
    for (let i = 0; i < patches.length; i += CHUNK) {
      const slice = patches.slice(i, i + CHUNK);
      const batch = writeBatch(db);
      for (const { id, patch } of slice) {
        const ref = doc(db, 'tenants', tid, 'projects', pid, 'elements', id);
        const clean = { ...stripUndefined(patch), updatedAt: serverTimestamp() };
        batch.set(ref, clean, { merge: true });
      }
      const isLast = i + CHUNK >= patches.length;
      if (isLast) {
        batch.set(
          doc(db, 'tenants', tid, 'projects', pid),
          { updatedAt: serverTimestamp() },
          { merge: true },
        );
      }
      try {
        await batch.commit();
        committedChunks += 1;
      } catch (err) {
        const partial = committedChunks > 0;
        const wrapped = new Error(
          partial
            ? `patchElements partial failure after ${committedChunks} of ${Math.ceil(patches.length / CHUNK)} chunk(s): ${err instanceof Error ? err.message : String(err)}`
            : `patchElements failed: ${err instanceof Error ? err.message : String(err)}`,
        ) as Error & { partial?: boolean; committedChunks?: number };
        wrapped.partial = partial;
        wrapped.committedChunks = committedChunks;
        throw wrapped;
      }
    }
  }

  public async upsertElement(
    tid: string,
    pid: string,
    el: IWireElement,
    opts?: { deleteFields?: readonly (keyof IWireElement)[] },
  ): Promise<void> {
    const db = this._firebase.db;
    const ref = doc(db, 'tenants', tid, 'projects', pid, 'elements', el.id);
    const { id: _id, ...rest } = el;
    const clean: Record<string, unknown> = {
      ...stripUndefined(rest),
      updatedAt: serverTimestamp(),
    };
    if (opts?.deleteFields) {
      for (const f of opts.deleteFields) clean[f as string] = deleteField();
    }
    await setDoc(ref, clean, { merge: true });
    updateDoc(doc(db, 'tenants', tid, 'projects', pid), { updatedAt: serverTimestamp() }).catch(
      () => {
        // ignore
      },
    );
  }

  public async deleteElement(tid: string, pid: string, elId: string): Promise<void> {
    await deleteDoc(doc(this._firebase.db, 'tenants', tid, 'projects', pid, 'elements', elId));
  }

  public async replaceElements(
    tid: string,
    pid: string,
    toDelete: string[],
    toWrite: IWireElement[],
  ): Promise<void> {
    const db = this._firebase.db;
    const batch = writeBatch(db);
    for (const elId of toDelete) {
      batch.delete(doc(db, 'tenants', tid, 'projects', pid, 'elements', elId));
    }
    for (const el of toWrite) {
      const { id: _id, ...rest } = el;
      const clean = { ...stripUndefined(rest), updatedAt: serverTimestamp() };
      batch.set(doc(db, 'tenants', tid, 'projects', pid, 'elements', el.id), clean, {
        merge: true,
      });
    }
    batch.set(
      doc(db, 'tenants', tid, 'projects', pid),
      { updatedAt: serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
  }

  public async addElements(tid: string, pid: string, toWrite: IWireElement[]): Promise<void> {
    if (toWrite.length === 0) return;
    const db = this._firebase.db;
    const batch = writeBatch(db);
    for (const el of toWrite) {
      const { id: _id, ...rest } = el;
      const clean = { ...stripUndefined(rest), updatedAt: serverTimestamp() };
      batch.set(doc(db, 'tenants', tid, 'projects', pid, 'elements', el.id), clean, {
        merge: true,
      });
    }
    batch.set(
      doc(db, 'tenants', tid, 'projects', pid),
      { updatedAt: serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
  }
}
