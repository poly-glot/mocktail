import { Injectable, computed, inject, signal } from '@angular/core';
import { IComment } from '@mocktail/projects';
import { WorkspaceStore } from '../workspace/workspace.store';

/**
 * State container for comments scoped to the current project. Pure state —
 * subscriptions live in EditorSessionService and write here.
 *
 * Note: this is distinct from the existing EditorCommentsService (per-pin
 * comment-mode interactions / draft management). This store mirrors the
 * server snapshot.
 */
@Injectable()
export class CommentsStore {
  private readonly _workspace = inject(WorkspaceStore);

  public readonly comments = signal<IComment[]>([]);
  public readonly openComments = computed(() => this.comments().filter((c) => !c.resolved));
  public readonly pageComments = computed(() => {
    const pageId = this._workspace.activePageId();
    return this.openComments().filter((c) => !c.pageId || c.pageId === pageId);
  });
}
