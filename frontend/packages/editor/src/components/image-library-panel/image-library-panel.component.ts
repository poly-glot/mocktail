import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  effect,
  inject,
  input,
  signal,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertCircle,
  Image as ImageIcon,
  LUCIDE_ICONS,
  LucideAngularModule,
  LucideIconProvider,
  PanelLeftClose,
  Search,
} from 'lucide-angular';
import { Subject, debounceTime } from 'rxjs';
import { ImageLibraryService } from '../../services/image-library/image-library.service';
import { IUnsplashPhoto } from '../../services/image-library/unsplash-types';

const DEBOUNCE_MS = 300;

/**
 * Left-panel UI for the Unsplash image library. Owns only view state
 * (the search input's local string + its debounce). All network and
 * selection/apply logic lives in `ImageLibraryService`.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-image-library-panel',
  standalone: true,
  imports: [LucideAngularModule],
  providers: [
    {
      provide: LUCIDE_ICONS,
      multi: true,
      useValue: new LucideIconProvider({
        AlertCircle,
        Image: ImageIcon,
        PanelLeftClose,
        Search,
      }),
    },
  ],
  templateUrl: './image-library-panel.component.html',
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageLibraryPanelComponent implements AfterViewInit {
  public readonly svc = inject(ImageLibraryService);
  private readonly _destroyRef = inject(DestroyRef);

  public readonly collapsed = input<boolean>(false);

  public readonly searchValue = signal<string>('');

  private readonly _searchChange$ = new Subject<string>();

  @ViewChild('sentinel', { static: false })
  public sentinel?: ElementRef<HTMLElement>;

  public readonly collapseToggle = output<void>();

  private _io?: IntersectionObserver;

  constructor() {
    this._searchChange$
      .pipe(debounceTime(DEBOUNCE_MS), takeUntilDestroyed(this._destroyRef))
      .subscribe((q) => {
        void this.svc.search(q);
      });

    effect(() => {
      // Re-observe the sentinel when hasMore flips back to true after a
      // new search — the same node is re-rendered and may not fire the
      // observer otherwise.
      this.svc.hasMore();
      queueMicrotask(() => this._rewireObserver());
    });

    this._destroyRef.onDestroy(() => {
      this._io?.disconnect();
    });
  }

  public ngAfterViewInit(): void {
    this._rewireObserver();
  }

  public onSearchInput(value: string): void {
    this.searchValue.set(value);
    this._searchChange$.next(value);
  }

  public onTileClick(photo: IUnsplashPhoto): void {
    if (!this.svc.canApply()) return;
    void this.svc.applyToSelected(photo);
  }

  public onRetry(): void {
    void this.svc.search(this.searchValue());
  }

  public onCollapse(): void {
    this.collapseToggle.emit();
  }

  public trackPhoto(_i: number, p: IUnsplashPhoto): string {
    return p.id;
  }

  private _rewireObserver(): void {
    this._io?.disconnect();
    const el = this.sentinel?.nativeElement;
    if (!el) return;
    this._io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            void this.svc.loadMore();
          }
        }
      },
      { rootMargin: '200px' },
    );
    this._io.observe(el);
  }
}
