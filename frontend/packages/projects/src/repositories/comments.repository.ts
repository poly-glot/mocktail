import { Injectable, inject } from '@angular/core';
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
  updateDoc,
  where,
} from 'firebase/firestore';
import { IComment } from '../interfaces/project.interface';

@Injectable({ providedIn: 'root' })
export class CommentsRepository {
  private readonly _authService = inject(AuthService);
  private readonly _firebase = inject(FirebaseService);

  public subscribeComments(
    tid: string,
    pid: string,
    onChange: (comments: IComment[]) => void,
    pageId?: string,
  ): () => void {
    const base = collection(this._firebase.db, 'tenants', tid, 'projects', pid, 'comments');
    const q = pageId
      ? query(base, where('pageId', '==', pageId), orderBy('createdAt', 'desc'))
      : query(base, orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snap) => {
        const rows: IComment[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            text: (data['text'] as string) ?? '',
            authorId: (data['authorId'] as string) ?? '',
            authorName: (data['authorName'] as string) ?? 'Someone',
            pageId: data['pageId'] as string | undefined,
            elementId: data['elementId'] as string | undefined,
            x: data['x'] as number | undefined,
            y: data['y'] as number | undefined,
            resolved: !!data['resolved'],
            createdAt: data['createdAt'],
          };
        });
        onChange(rows);
      },
      (err) => console.error('[project] comments subscription error', err),
    );
  }

  public async addComment(
    tid: string,
    pid: string,
    comment: Omit<IComment, 'id' | 'createdAt' | 'resolved' | 'authorId' | 'authorName'>,
  ): Promise<string> {
    const user = this._authService.user();
    if (!user) throw new Error('not signed in');
    const clean: Record<string, unknown> = {
      text: comment.text,
      authorId: user.uid,
      authorName: user.displayName ?? user.email?.split('@')[0] ?? 'Member',
      resolved: false,
      createdAt: serverTimestamp(),
    };
    if (comment.pageId !== undefined) clean['pageId'] = comment.pageId;
    if (comment.elementId !== undefined) clean['elementId'] = comment.elementId;
    if (comment.x !== undefined) clean['x'] = comment.x;
    if (comment.y !== undefined) clean['y'] = comment.y;
    const ref = await addDoc(
      collection(this._firebase.db, 'tenants', tid, 'projects', pid, 'comments'),
      clean,
    );
    return ref.id;
  }

  public async resolveComment(
    tid: string,
    pid: string,
    cid: string,
    resolved = true,
  ): Promise<void> {
    await updateDoc(doc(this._firebase.db, 'tenants', tid, 'projects', pid, 'comments', cid), {
      resolved,
      resolvedAt: resolved ? serverTimestamp() : null,
    });
  }
}
