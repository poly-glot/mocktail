import { TestBed } from '@angular/core/testing';
import { IPageDoc } from '@mocktail/projects';
import { IWorkspaceFixture, WorkspaceStore } from './workspace.store';

describe('WorkspaceStore.loadFixture', () => {
  let store: WorkspaceStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WorkspaceStore],
    });
    store = TestBed.inject(WorkspaceStore);
  });

  function page(id: string, order = 0): IPageDoc {
    return { id, name: id, order, width: 1200, height: 800 };
  }

  it('populates project state without touching Firestore', () => {
    const fixture: IWorkspaceFixture = {
      tid: 't-fix',
      pid: 'fix-1',
      pages: [page('p1'), page('p2', 1)],
    };

    store.loadFixture(fixture);

    expect(store.tid()).toBe('t-fix');
    expect(store.pid()).toBe('fix-1');
    expect(store.pages()).toEqual(fixture.pages as IPageDoc[]);
    expect(store.activePageId()).toBe('p1');
    expect(store.activePage()?.id).toBe('p1');
  });

  it('defaults tid to "" when omitted', () => {
    store.loadFixture({ pid: 'fix', pages: [page('p1')] });
    expect(store.tid()).toBe('');
  });

  it('honors an explicit activePageId override', () => {
    store.loadFixture({
      pid: 'fix',
      pages: [page('p1'), page('p2', 1)],
      activePageId: 'p2',
    });
    expect(store.activePageId()).toBe('p2');
  });

  it('honors an explicit null activePageId (no auto-select)', () => {
    store.loadFixture({
      pid: 'fix',
      pages: [page('p1')],
      activePageId: null,
    });
    expect(store.activePageId()).toBeNull();
  });

  it('merges fixture gridConfig over defaults', () => {
    store.loadFixture({
      pid: 'fix',
      pages: [page('p1')],
      gridConfig: { visible: true, columns: 8, gutter: 24, margin: 32 },
    });
    const grid = store.gridConfig();
    expect(grid.visible).toBeTrue();
    expect(grid.columns).toBe(8);
    expect(grid.gutter).toBe(24);
    expect(grid.margin).toBe(32);
    // snap falls back to the default (true) since fixture omitted it.
    expect(grid.snap).toBeTrue();
  });

  it('falls back to default gridConfig when fixture omits it', () => {
    store.loadFixture({ pid: 'fix', pages: [page('p1')] });
    expect(store.gridConfig()).toEqual(WorkspaceStore.DEFAULT_GRID);
  });
});
