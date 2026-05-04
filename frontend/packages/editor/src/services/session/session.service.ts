import { DestroyRef, Injectable, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { DialogService } from '@mocktail/cdk';
import { CollabService } from '@mocktail/collab';
import { IGridConfig, ProjectApiService } from '@mocktail/projects';
import { TenantService } from '@mocktail/tenant';
import { CommentsStore } from '../comments/comments.store';
import { CanvasGestureStore } from '../canvas-gesture/canvas-gesture.store';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorInlineEditService } from '../inline-edit/inline-edit.service';
import { WorkspaceStore } from '../workspace/workspace.store';

/**
 * Coordinates route → workspace/comments wiring. Owns the Firestore
 * subscriptions (pages, project doc, comments, per-page elements) and
 * pushes their data into {@link WorkspaceStore} and {@link CommentsStore}.
 *
 * Public read API stays signal-shaped (tid, pid, pages, comments, etc.)
 * so consumers don't need to know the internal split. New code should
 * still feel free to inject WorkspaceStore / CommentsStore directly.
 *
 * Component-scoped (provided by EditorComponent.providers) so injecting
 * ActivatedRoute returns the editor's leaf route — `:tid/:pid` are
 * visible without the consumer plumbing the route in by hand.
 */
@Injectable()
export class EditorSessionService {
  private readonly _projects = inject(ProjectApiService);
  private readonly _tenants = inject(TenantService);
  private readonly _collab = inject(CollabService);
  private readonly _dialog = inject(DialogService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _drr = inject(CanvasGestureStore);
  private readonly _inline = inject(EditorInlineEditService);
  private readonly _elsState = inject(EditorElementsStateService);
  private readonly _workspace = inject(WorkspaceStore);
  private readonly _comments = inject(CommentsStore);
  private readonly _route = inject(ActivatedRoute);

  // ── Public state read-through to the stores ─────────────────────────
  public readonly tid = this._workspace.tid;
  public readonly pid = this._workspace.pid;
  public readonly pages = this._workspace.pages;
  public readonly activePageId = this._workspace.activePageId;
  public readonly gridConfig = this._workspace.gridConfig;
  public readonly activePage = this._workspace.activePage;
  public readonly comments = this._comments.comments;
  public readonly openComments = this._comments.openComments;
  public readonly pageComments = this._comments.pageComments;

  constructor() {
    // Watch the route paramMap. Component-scoped injection means the leaf
    // route is visible — `:tid/:pid` arrive on the first emit, no manual
    // init() plumbing.
    this._route.paramMap.pipe(takeUntilDestroyed(this._destroyRef)).subscribe((pm) => {
      const tid = pm.get('tid') ?? '';
      const pid = pm.get('pid') ?? '';
      if (tid === this._workspace.tid() && pid === this._workspace.pid()) return;
      this._drr.cancel();
      this._inline.stop();
      this._elsState.reset();
      this._workspace.activePageId.set(null);
      this._workspace.tid.set(tid);
      this._workspace.pid.set(pid);
      if (!tid || !pid) return;
      this._tenants.setCurrent(tid);
      this._collab.connect(tid, pid);
    });

    // Per-(tid,pid) subscriptions: pages, project doc, comments. Re-runs
    // whenever the route ids change; effect cleanup tears down the
    // previous listeners — no manual _unsub* bookkeeping.
    effect((onCleanup) => {
      const tid = this._workspace.tid();
      const pid = this._workspace.pid();
      if (!tid || !pid) return;

      const unsubPages = this._projects.subscribePages(tid, pid, (pages) => {
        this._workspace.pages.set(pages);
        const current = this._workspace.activePageId();
        if (pages.length === 0) {
          this._workspace.activePageId.set(null);
          return;
        }
        if (!current || !pages.find((p) => p.id === current)) {
          this.setActivePage(pages[0].id);
        }
      });

      const unsubComments = this._projects.subscribeComments(tid, pid, (rows) => {
        this._comments.comments.set(rows);
      });

      const unsubProject = this._projects.subscribeProjectDoc(tid, pid, (proj) => {
        if (proj?.gridConfig) {
          this._workspace.gridConfig.set({ ...WorkspaceStore.DEFAULT_GRID, ...proj.gridConfig });
        }
      });

      onCleanup(() => {
        unsubPages();
        unsubComments();
        unsubProject();
      });
    });

    // Per-page elements subscription. Reactive on (tid, pid, activePageId).
    effect((onCleanup) => {
      const tid = this._workspace.tid();
      const pid = this._workspace.pid();
      const pageId = this._workspace.activePageId();
      if (!tid || !pid || !pageId) return;

      const unsub = this._projects.subscribeElements(tid, pid, pageId, (els, meta) => {
        const draggingId = this._drr.activeId();
        if (draggingId) {
          const local = this._elsState.list().find((e) => e.id === draggingId);
          const merged = local ? els.map((e) => (e.id === draggingId ? local : e)) : els;
          this._elsState.list.set(merged);
          return;
        }
        if (meta.hasPendingWrites) return;
        this._elsState.list.set(els);
      });

      onCleanup(() => unsub());
    });

    // Drop drag/inline state whenever the active page actually changes.
    // The cleanup callback fires before each subsequent effect run, which
    // is exactly the "page changed" boundary — no manual prev tracking.
    let firstActivePageRun = true;
    effect((onCleanup) => {
      this._workspace.activePageId();
      if (firstActivePageRun) {
        firstActivePageRun = false;
        return;
      }
      onCleanup(() => {
        this._drr.cancel();
        this._inline.stop();
      });
    });

    this._destroyRef.onDestroy(() => {
      this._collab.disconnect();
    });
  }

  public setActivePage(pageId: string): void {
    this._workspace.activePageId.set(pageId);
  }

  public async addPage(): Promise<void> {
    const name = `Page ${this._workspace.pages().length + 1}`;
    const order = this._workspace.pages().length;
    const id = await this._projects.addPage(
      this._workspace.tid(),
      this._workspace.pid(),
      name,
      order,
    );
    this.setActivePage(id);
  }

  public async setGridConfig(next: IGridConfig): Promise<void> {
    const prev = this._workspace.gridConfig();
    this._workspace.gridConfig.set(next);
    try {
      await this._projects.updateGridConfig(this._workspace.tid(), this._workspace.pid(), next);
    } catch (err) {
      this._workspace.gridConfig.set(prev);
      console.error('[session] updateGridConfig failed', err);
    }
  }

  public async requestDeletePage(pageId: string, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    const pages = this._workspace.pages();
    if (pages.length <= 1) {
      await this._dialog.alert({
        title: "Can't delete the last page",
        message: 'A project must have at least one page.',
      });
      return;
    }
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;
    const ok = await this._dialog.confirm({
      title: `Delete “${page.name}”?`,
      message: 'All elements on this page will be permanently removed.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      destructive: true,
    });
    if (!ok) return;
    const idx = pages.findIndex((p) => p.id === pageId);
    const next = pages[idx + 1] ?? pages[idx - 1];
    if (this._workspace.activePageId() === pageId && next) {
      this.setActivePage(next.id);
    }
    await this._projects.deletePage(this._workspace.tid(), this._workspace.pid(), pageId);
    this._collab.sendEdit(`page:${pageId}`, { deleted: true });
  }
}
