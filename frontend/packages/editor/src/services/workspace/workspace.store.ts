import { Injectable, computed, signal } from '@angular/core';
import { IGridConfig, IPageDoc } from '@mocktail/projects';

const DEFAULT_GRID: IGridConfig = {
  visible: false,
  columns: 12,
  gutter: 16,
  margin: 40,
  snap: true,
};

/**
 * Shape consumed by {@link WorkspaceStore.loadFixture}. Lets the perf-trace
 * harness (and tests) hydrate the workspace without standing up Firestore.
 */
export interface IWorkspaceFixture {
  readonly tid?: string;
  readonly pid: string;
  readonly pages: readonly IPageDoc[];
  readonly activePageId?: string | null;
  readonly gridConfig?: IGridConfig;
}

/**
 * State container for the editor's workspace: route ids, the page list,
 * the active page, and the grid config. Pure state — subscriptions and
 * route wiring live in EditorSessionService, which writes here.
 */
/**
 * Component-scoped — provided by EditorComponent.providers so it shares the
 * editor's lifetime and can inject the leaf ActivatedRoute alongside it.
 */
@Injectable()
export class WorkspaceStore {
  public readonly tid = signal<string>('');
  public readonly pid = signal<string>('');
  public readonly pages = signal<IPageDoc[]>([]);
  public readonly activePageId = signal<string | null>(null);
  public readonly gridConfig = signal<IGridConfig>({ ...DEFAULT_GRID });

  public readonly activePage = computed(
    () => this.pages().find((p) => p.id === this.activePageId()) ?? null,
  );

  public static readonly DEFAULT_GRID = DEFAULT_GRID;

  /**
   * Test/perf-fixture-only entry point; bypasses Firestore. Hydrates the
   * workspace state directly from a fixture so the editor renders without
   * any network round-trip. Production code paths must continue to flow
   * through {@link EditorSessionService} and the Firestore subscriptions.
   */
  public loadFixture(fixture: IWorkspaceFixture): void {
    this.tid.set(fixture.tid ?? '');
    this.pid.set(fixture.pid);
    this.pages.set([...fixture.pages]);
    const fallbackPageId = fixture.pages[0]?.id ?? null;
    this.activePageId.set(
      fixture.activePageId === undefined ? fallbackPageId : fixture.activePageId,
    );
    this.gridConfig.set({ ...DEFAULT_GRID, ...(fixture.gridConfig ?? {}) });
  }
}
