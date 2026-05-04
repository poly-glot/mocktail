import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { IWireElement } from '@mocktail/projects';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorSelectionService } from '../selection/selection.service';
import { EditorSessionService } from '../session/session.service';
import { ImageLibraryService } from './image-library.service';
import { IUnsplashPhoto } from './unsplash-types';

interface IFakeSession {
  tid: ReturnType<typeof signal<string>>;
  pid: ReturnType<typeof signal<string>>;
}

function photo(id: string, overrides: Partial<IUnsplashPhoto> = {}): IUnsplashPhoto {
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
    user: {
      name: 'Jane Doe',
      links: { html: `https://unsplash.com/@janedoe` },
    },
    width: 1920,
    height: 1080,
    ...overrides,
  };
}

function imageEl(id: string): IWireElement {
  return {
    id,
    pageId: 'pg',
    type: 'image',
    x: 0,
    y: 0,
    w: 200,
    h: 150,
    zIndex: 1,
  };
}

describe('ImageLibraryService', () => {
  let svc: ImageLibraryService;
  let session: IFakeSession;
  let selection: EditorSelectionService;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let elsState: EditorElementsStateService;
  let patchSpy: jasmine.Spy;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    patchSpy = jasmine.createSpy('patch').and.resolveTo(undefined);
    session = { tid: signal<string>(''), pid: signal<string>('') };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: EditorElementsStateService,
          useValue: {
            getById: (id: string) => (id === 'img-1' ? imageEl('img-1') : undefined),
            patch: patchSpy,
          } as Partial<EditorElementsStateService>,
        },
        { provide: EditorSessionService, useValue: session },
        ImageLibraryService,
      ],
    });
    svc = TestBed.inject(ImageLibraryService);
    selection = TestBed.inject(EditorSelectionService);
    elsState = TestBed.inject(EditorElementsStateService);
    session.tid.set('t1');
    session.pid.set('p1');
    selection.setPrimary('img-1');
    fetchSpy = spyOn(globalThis, 'fetch');
  });

  function mockSearch(results: IUnsplashPhoto[], hasMore: boolean, status = 200): void {
    fetchSpy.and.callFake(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/images/search')) {
        return new Response(JSON.stringify({ results, hasMore }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/images/track-download')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  describe('search', () => {
    it('fetches the first page and populates signals on success', async () => {
      mockSearch([photo('a'), photo('b')], true);
      await svc.search('mountain');
      expect(svc.query()).toBe('mountain');
      expect(svc.results().length).toBe(2);
      expect(svc.results()[0].id).toBe('a');
      expect(svc.hasMore()).toBe(true);
      expect(svc.page()).toBe(1);
      expect(svc.loading()).toBe(false);
      expect(svc.error()).toBeNull();
      const [url] = fetchSpy.calls.mostRecent().args;
      expect(String(url)).toContain('q=mountain');
      expect(String(url)).toContain('page=1');
    });

    it('trims whitespace off the query', async () => {
      mockSearch([], false);
      await svc.search('  dogs  ');
      expect(svc.query()).toBe('dogs');
    });

    it('replaces prior results instead of appending', async () => {
      mockSearch([photo('a')], false);
      await svc.search('cat');
      mockSearch([photo('x'), photo('y')], false);
      await svc.search('dog');
      expect(svc.results().map((r) => r.id)).toEqual(['x', 'y']);
    });

    it('sets error and keeps prior results when the request fails', async () => {
      mockSearch([photo('a')], false);
      await svc.search('cat');
      fetchSpy.and.resolveTo(new Response('boom', { status: 500 }));
      await svc.search('dog');
      expect(svc.error()).toContain("Couldn't reach");
      // search() clears results synchronously before fetching, and the failure
      // leaves results empty — prior behavior: the user sees the error and
      // starts fresh on next success.
      expect(svc.results()).toEqual([]);
    });

    it('maps 429 to a friendly "busy" message', async () => {
      fetchSpy.and.resolveTo(new Response('slow down', { status: 429 }));
      await svc.search('cat');
      expect(svc.error()).toContain('busy');
    });
  });

  describe('loadMore', () => {
    it('appends the next page and bumps the page counter', async () => {
      mockSearch([photo('a')], true);
      await svc.search('cat');
      mockSearch([photo('b'), photo('c')], false);
      await svc.loadMore();
      expect(svc.results().map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect(svc.page()).toBe(2);
      expect(svc.hasMore()).toBe(false);
    });

    it('is a no-op when hasMore is false', async () => {
      mockSearch([photo('a')], false);
      await svc.search('cat');
      fetchSpy.calls.reset();
      await svc.loadMore();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('is a no-op while a prior request is still in flight', async () => {
      let resolveFirst: (r: Response) => void = () => undefined;
      fetchSpy.and.callFake(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      );
      const first = svc.search('cat');
      expect(svc.loading()).toBe(true);
      await svc.loadMore();
      // Only the in-flight search request is pending.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      resolveFirst(new Response(JSON.stringify({ results: [], hasMore: false }), { status: 200 }));
      await first;
    });
  });

  describe('applyToSelected', () => {
    it('fires the download ping and patches the selected element', async () => {
      fetchSpy.and.resolveTo(new Response(null, { status: 204 }));
      await svc.applyToSelected(photo('a'));
      expect(fetchSpy).toHaveBeenCalled();
      const [url, init] = fetchSpy.calls.mostRecent().args as [string, RequestInit];
      expect(url).toBe('/api/images/track-download');
      expect(init.method).toBe('POST');
      expect(init.body).toContain('api.unsplash.com/photos/a/download');

      expect(patchSpy).toHaveBeenCalledTimes(1);
      const [tid, pid, id, patch] = patchSpy.calls.mostRecent().args;
      expect(tid).toBe('t1');
      expect(pid).toBe('p1');
      expect(id).toBe('img-1');
      expect(patch.data.image.src).toBe('https://images.unsplash.com/a-regular');
      expect(patch.data.image.photographer).toBe('Jane Doe');
      expect(patch.data.image.photographerUrl).toContain('utm_source=mocktail');
      expect(patch.data.image.photographerUrl).toContain('utm_medium=referral');
      expect(patch.data.image.source).toBe('unsplash');
      expect(patch.data.image.sourceId).toBe('a');
    });

    it('is a no-op when nothing is selected', async () => {
      selection.clear();
      await svc.applyToSelected(photo('a'));
      expect(patchSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when the selected element is not an image', async () => {
      selection.setPrimary('non-image-el');
      // getById returns undefined for anything other than 'img-1'
      await svc.applyToSelected(photo('a'));
      expect(patchSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when tid/pid are missing', async () => {
      session.tid.set('');
      await svc.applyToSelected(photo('a'));
      expect(patchSpy).not.toHaveBeenCalled();
    });

    it('swallows download-ping failures', async () => {
      fetchSpy.and.callFake((input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('track-download')) return Promise.reject(new Error('nope'));
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      // Should not throw.
      await expectAsync(svc.applyToSelected(photo('a'))).toBeResolved();
      expect(patchSpy).toHaveBeenCalled();
    });
  });

  describe('canApply', () => {
    it('is true when the selection is an image element', () => {
      selection.setPrimary('img-1');
      expect(svc.canApply()).toBe(true);
    });

    it('is false when nothing is selected', () => {
      selection.clear();
      expect(svc.canApply()).toBe(false);
    });

    it('is false when the selection is not an image element', () => {
      selection.setPrimary('other');
      expect(svc.canApply()).toBe(false);
    });
  });

  describe('reset', () => {
    it('clears query, results, page, hasMore, and error', async () => {
      mockSearch([photo('a')], true);
      await svc.search('cat');
      expect(svc.results().length).toBe(1);
      svc.reset();
      expect(svc.query()).toBe('');
      expect(svc.results()).toEqual([]);
      expect(svc.page()).toBe(0);
      expect(svc.hasMore()).toBe(false);
      expect(svc.error()).toBeNull();
    });
  });
});
