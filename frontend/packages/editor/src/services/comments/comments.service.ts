import { Injectable, inject, signal } from '@angular/core';
import { ProjectApiService } from '@mocktail/projects';

export interface ICommentDraft {
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

@Injectable({ providedIn: 'root' })
export class EditorCommentsService {
  private readonly _projects = inject(ProjectApiService);

  public readonly commentMode = signal(false);
  public readonly draft = signal<ICommentDraft | null>(null);
  public readonly openPinId = signal<string | null>(null);

  public toggleMode(): void {
    this.commentMode.update((v) => !v);
    this.draft.set(null);
  }

  public startDraft(x: number, y: number): void {
    this.draft.set({ x, y, text: '' });
    this.commentMode.set(false);
  }

  public updateDraftText(text: string): void {
    const d = this.draft();
    if (!d) return;
    this.draft.set({ ...d, text });
  }

  public cancelDraft(): void {
    this.draft.set(null);
  }

  public togglePin(cid: string): void {
    this.openPinId.update((id) => (id === cid ? null : cid));
  }

  public openPin(cid: string): void {
    this.openPinId.set(cid);
  }

  public closePin(): void {
    this.openPinId.set(null);
  }

  public async saveDraft(tid: string, pid: string, pageId: string | null): Promise<void> {
    const d = this.draft();
    if (!d || !d.text.trim()) {
      this.cancelDraft();
      return;
    }
    const text = d.text.trim();
    const id = await this._projects.addComment(tid, pid, {
      text,
      x: d.x,
      y: d.y,
      pageId: pageId ?? undefined,
    });
    await this._projects.writeActivity(
      tid,
      pid,
      'comment-added',
      `commented: "${text.slice(0, 60)}"`,
    );
    this.openPin(id);
    this.cancelDraft();
  }

  public async resolveComment(tid: string, pid: string, cid: string): Promise<void> {
    await this._projects.resolveComment(tid, pid, cid, true);
    await this._projects.writeActivity(tid, pid, 'comment-resolved', 'resolved a comment');
    this.closePin();
  }
}
