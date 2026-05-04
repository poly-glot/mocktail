import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ImageLibraryService } from '../../services/image-library/image-library.service';
import { IUnsplashPhoto } from '../../services/image-library/unsplash-types';
import { ImageLibraryPanelComponent } from './image-library-panel.component';

function photo(id: string, user = 'Jane Doe'): IUnsplashPhoto {
  return {
    id,
    urls: {
      regular: `https://images.unsplash.com/${id}-regular`,
      small: `https://images.unsplash.com/${id}-small`,
      thumb: `https://images.unsplash.com/${id}-thumb`,
    },
    links: {
      download_location: `https://api.unsplash.com/photos/${id}/download`,
      html: `https://unsplash.com/photos/${id}`,
    },
    user: { name: user, links: { html: 'https://unsplash.com/@x' } },
    width: 1920,
    height: 1080,
  };
}

interface IFakeSvc {
  query: ReturnType<typeof signal<string>>;
  results: ReturnType<typeof signal<IUnsplashPhoto[]>>;
  page: ReturnType<typeof signal<number>>;
  hasMore: ReturnType<typeof signal<boolean>>;
  loading: ReturnType<typeof signal<boolean>>;
  error: ReturnType<typeof signal<string | null>>;
  canApply: ReturnType<typeof signal<boolean>>;
  search: jasmine.Spy;
  loadMore: jasmine.Spy;
  applyToSelected: jasmine.Spy;
  reset: jasmine.Spy;
}

function makeFakeSvc(): IFakeSvc {
  return {
    query: signal<string>(''),
    results: signal<IUnsplashPhoto[]>([]),
    page: signal<number>(0),
    hasMore: signal<boolean>(false),
    loading: signal<boolean>(false),
    error: signal<string | null>(null),
    canApply: signal<boolean>(true),
    search: jasmine.createSpy('search').and.resolveTo(undefined),
    loadMore: jasmine.createSpy('loadMore').and.resolveTo(undefined),
    applyToSelected: jasmine.createSpy('applyToSelected').and.resolveTo(undefined),
    reset: jasmine.createSpy('reset'),
  };
}

describe('ImageLibraryPanelComponent', () => {
  let fixture: ComponentFixture<ImageLibraryPanelComponent>;
  let cmp: ImageLibraryPanelComponent;
  let svc: IFakeSvc;

  beforeEach(async () => {
    svc = makeFakeSvc();
    await TestBed.configureTestingModule({
      imports: [ImageLibraryPanelComponent],
      providers: [{ provide: ImageLibraryService, useValue: svc }],
    }).compileComponents();
    fixture = TestBed.createComponent(ImageLibraryPanelComponent);
    cmp = fixture.componentInstance;
    fixture.detectChanges();
  });

  function qs<T extends HTMLElement>(selector: string): T | null {
    return fixture.nativeElement.querySelector(selector) as T | null;
  }

  it('debounces search input and calls svc.search with the latest value', async () => {
    // Migrated from fakeAsync()/tick() — the zoneless build drops zone-testing.js
    // so this drives the rxjs `debounceTime` via real timers, awaiting a real
    // setTimeout. fakeAsync() is unavailable without zone.js/testing.
    cmp.onSearchInput('c');
    cmp.onSearchInput('ca');
    cmp.onSearchInput('cat');
    expect(svc.search).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 350));
    expect(svc.search).toHaveBeenCalledTimes(1);
    expect(svc.search).toHaveBeenCalledWith('cat');
  });

  it('renders tiles for results and applies on click', () => {
    svc.results.set([photo('a'), photo('b')]);
    fixture.detectChanges();
    const tiles = fixture.nativeElement.querySelectorAll('[data-testid^="images-tile-"]');
    expect(tiles.length).toBe(2);
    (tiles[0] as HTMLButtonElement).click();
    expect(svc.applyToSelected).toHaveBeenCalledTimes(1);
    expect(svc.applyToSelected.calls.mostRecent().args[0].id).toBe('a');
  });

  it('does not apply when canApply is false', () => {
    svc.canApply.set(false);
    svc.results.set([photo('a')]);
    fixture.detectChanges();
    const tile = qs<HTMLButtonElement>('[data-testid="images-tile-a"]');
    tile!.click();
    expect(svc.applyToSelected).not.toHaveBeenCalled();
  });

  it('shows the "select an image" hint when canApply is false', () => {
    svc.canApply.set(false);
    fixture.detectChanges();
    expect(qs('[data-testid="images-no-selection"]')).not.toBeNull();
  });

  it('shows empty-query hint initially', () => {
    expect(qs('[data-testid="images-hint"]')).not.toBeNull();
  });

  it('shows "no results" when query is set but results are empty', () => {
    svc.query.set('mountain');
    fixture.detectChanges();
    const empty = qs('[data-testid="images-empty"]');
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain('mountain');
  });

  it('shows error block with retry that re-runs search', () => {
    svc.query.set('cat');
    svc.error.set('Image library is busy — try again in a moment.');
    fixture.detectChanges();
    cmp.searchValue.set('cat');
    const retry = qs<HTMLButtonElement>('[data-testid="images-retry"]');
    expect(retry).not.toBeNull();
    retry!.click();
    expect(svc.search).toHaveBeenCalledWith('cat');
  });

  it('emits collapseToggle when the collapse button is clicked', () => {
    const spy = jasmine.createSpy('collapseToggle');
    cmp.collapseToggle.subscribe(spy);
    qs<HTMLButtonElement>('[data-testid="collapse-left"]')!.click();
    expect(spy).toHaveBeenCalled();
  });

  it('reflects collapsed input on the aside', () => {
    fixture.componentRef.setInput('collapsed', true);
    fixture.detectChanges();
    const aside = qs<HTMLElement>('[data-testid="images-panel"]');
    expect(aside!.classList.contains('collapsed')).toBe(true);
    expect(aside!.getAttribute('aria-hidden')).toBe('true');
  });

  it('triggers loadMore when the sentinel intersects', () => {
    let intersectionCallback: IntersectionObserverCallback | null = null;
    const observe = jasmine.createSpy('observe');
    const disconnect = jasmine.createSpy('disconnect');

    (globalThis as any).IntersectionObserver = function (
      cb: IntersectionObserverCallback,
    ): IntersectionObserver {
      intersectionCallback = cb;
      return {
        observe,
        disconnect,
        unobserve: () => undefined,
        takeRecords: () => [],
        root: null,
        rootMargin: '',
        thresholds: [],
      } as unknown as IntersectionObserver;
    };

    svc.results.set([photo('a')]);
    svc.hasMore.set(true);
    fixture.detectChanges();
    // AfterViewInit rewires with the new observer constructor.
    cmp.ngAfterViewInit();
    expect(observe).toHaveBeenCalled();

    intersectionCallback!(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(svc.loadMore).toHaveBeenCalled();
  });
});
