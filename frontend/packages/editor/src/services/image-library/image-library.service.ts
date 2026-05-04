import { Injectable, computed, inject, signal } from '@angular/core';
import { IImageRef } from '@mocktail/projects';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorSelectionService } from '../selection/selection.service';
import { EditorSessionService } from '../session/session.service';
import { withUtm } from './unsplash-constants';
import { IUnsplashPhoto, IUnsplashSearchResponse } from './unsplash-types';

const PER_PAGE = 24;

/**
 * Drives the image-library left panel. Owns search/pagination state as
 * signals and the one-shot `applyToSelected` that writes the picked photo
 * onto the currently-selected image element. Talks to the Deno
 * `/api/images/*` proxy so the Unsplash access key never reaches the
 * browser.
 */
@Injectable()
export class ImageLibraryService {
  private readonly _elsState = inject(EditorElementsStateService);
  private readonly _selection = inject(EditorSelectionService);
  private readonly _session = inject(EditorSessionService);

  public readonly query = signal<string>('');
  public readonly results = signal<IUnsplashPhoto[]>([]);
  public readonly page = signal<number>(0);
  public readonly hasMore = signal<boolean>(false);
  public readonly loading = signal<boolean>(false);
  public readonly error = signal<string | null>(null);

  public readonly canApply = computed(() => {
    const id = this._selection.selectedId();
    if (!id) return false;
    const el = this._elsState.getById(id);
    return el?.type === 'image';
  });

  private _requestId = 0;

  public async search(q: string): Promise<void> {
    const normalized = q.trim();
    this.query.set(normalized);
    this.page.set(0);
    this.results.set([]);
    this.hasMore.set(false);
    await this._fetchPage(1, 'replace');
  }

  public async loadMore(): Promise<void> {
    if (this.loading() || !this.hasMore()) return;
    await this._fetchPage(this.page() + 1, 'append');
  }

  public reset(): void {
    this._requestId++;
    this.query.set('');
    this.results.set([]);
    this.page.set(0);
    this.hasMore.set(false);
    this.error.set(null);
    this.loading.set(false);
  }

  public async applyToSelected(photo: IUnsplashPhoto): Promise<void> {
    const id = this._selection.selectedId();
    if (!id) return;
    const el = this._elsState.getById(id);
    if (!el || el.type !== 'image') return;
    const tid = this._session.tid();
    const pid = this._session.pid();
    if (!tid || !pid) return;

    const image: IImageRef = {
      src: photo.urls.regular,
      thumb: photo.urls.small,
      source: 'unsplash',
      sourceId: photo.id,
      downloadLocation: photo.links.download_location,
      photographer: photo.user.name,
      photographerUrl: withUtm(photo.user.links.html),
      width: photo.width || undefined,
      height: photo.height || undefined,
    };

    this._pingDownload(photo.links.download_location);
    await this._elsState.patch(tid, pid, id, { data: { image } });
  }

  private _pingDownload(downloadLocation: string): void {
    fetch('/api/images/track-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ downloadLocation }),
    }).catch(() => {
      // Fire-and-forget per Unsplash guidelines; upstream failure is silent.
    });
  }

  private async _fetchPage(page: number, mode: 'replace' | 'append'): Promise<void> {
    const rid = ++this._requestId;
    this.loading.set(true);
    this.error.set(null);
    const params = new URLSearchParams({
      q: this.query(),
      page: String(page),
      perPage: String(PER_PAGE),
    });
    try {
      const res = await fetch(`/api/images/search?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 429) {
          throw new Error('Image library is busy — try again in a moment.');
        }
        throw new Error(`Couldn't reach image library (${res.status}).`);
      }
      const data = (await res.json()) as IUnsplashSearchResponse;
      if (rid !== this._requestId) return;
      const next = Array.isArray(data.results) ? data.results : [];
      this.results.update((prev) => (mode === 'append' ? [...prev, ...next] : next));
      this.hasMore.set(Boolean(data.hasMore));
      this.page.set(page);
    } catch (err) {
      if (rid !== this._requestId) return;
      const message = err instanceof Error ? err.message : 'Image library error.';
      this.error.set(message);
    } finally {
      if (rid === this._requestId) this.loading.set(false);
    }
  }
}
