import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { EditorZoomService } from '../zoom/zoom.service';

/**
 * Owns the editor viewport concerns that used to live on EditorComponent:
 *   1. Tracks the canvas element's live size via ResizeObserver.
 *   2. Drives auto-fit zoom whenever the canvas resizes or the active page changes.
 *   3. Computes viewport-centered spawn coordinates for new elements.
 *
 * The component keeps its `viewChild` refs and forwards their native elements
 * into this service via `setCanvasEl`/`setBoardEl`. That keeps the injection
 * context where it belongs (the component) and leaves this service as plain
 * signal-driven state with its own self-contained effects.
 */
@Injectable()
export class EditorViewportService {
  private readonly _canvasEl = signal<HTMLDivElement | null>(null);
  private readonly _boardEl = signal<HTMLDivElement | null>(null);
  private readonly _canvasSize = signal<{ w: number; h: number } | null>(null);

  private readonly _zoom = inject(EditorZoomService);
  private readonly _workspace = inject(WorkspaceStore);
  private readonly _elsState = inject(EditorElementsStateService);

  public readonly canvasSize = this._canvasSize.asReadonly();

  constructor() {
    effect((onCleanup) => {
      const el = this._canvasEl();
      if (!el) {
        this._canvasSize.set(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      this._canvasSize.set({ w: rect.width, h: rect.height });
      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r) this._canvasSize.set({ w: r.width, h: r.height });
      });
      ro.observe(el);
      onCleanup(() => ro.disconnect());
    });

    effect(() => {
      if (!this._zoom.autoFitZoom()) return;
      const size = this._canvasSize();
      if (!size || size.w < 80 || size.h < 80) return;
      const page = this._workspace.activePage();
      const pageW = page?.width ?? 1200;
      const pageH = page?.height ?? 800;
      const availW = Math.max(200, size.w - 96);
      const availH = Math.max(200, size.h - 160);
      const fit = Math.min(availW / pageW, availH / pageH, 1);
      untracked(() => this._zoom.setFromAutoFit(fit));
    });
  }

  public setCanvasEl(el: HTMLDivElement | null): void {
    this._canvasEl.set(el);
  }

  public setBoardEl(el: HTMLDivElement | null): void {
    this._boardEl.set(el);
  }

  /**
   * Returns the live bounding rect of the board element, or null when the
   * board isn't registered yet. Used by pointer orchestration code that
   * needs to convert between viewport-space and board-space coordinates.
   */
  public getBoardRect(): DOMRect | null {
    return this._boardEl()?.getBoundingClientRect() ?? null;
  }

  /**
   * Returns the live bounding rect of the outer canvas (scroll container).
   * Kept for symmetry with `getBoardRect()` and for future orchestrators
   * that may need to work relative to the canvas viewport.
   */
  public getCanvasRect(): DOMRect | null {
    return this._canvasEl()?.getBoundingClientRect() ?? null;
  }

  /**
   * Returns the top-left (x, y) at which an element of size (w, h) should be
   * placed so it lands in the middle of the visible viewport. Falls back to a
   * staircase grid when either rect is unavailable, e.g. during hydration.
   */
  public viewportCenterOnBoard(w: number, h: number): { x: number; y: number } {
    const canvasEl = this._canvasEl();
    const boardEl = this._boardEl();
    const canvas = canvasEl?.getBoundingClientRect();
    const board = boardEl?.getBoundingClientRect();
    const page = this._workspace.activePage();
    const pageW = page?.width ?? 1200;
    const pageH = page?.height ?? 800;
    if (!canvas || !board) {
      const existing = this._elsState.list().length;
      return { x: (existing % 6) * 8 + 40, y: Math.floor(existing / 6) * 8 + 40 };
    }
    const z = this._zoom.zoom();
    const cx = canvas.left + canvas.width / 2;
    const cy = canvas.top + canvas.height / 2;
    const rawX = (cx - board.left) / z - w / 2;
    const rawY = (cy - board.top) / z - h / 2;
    const x = Math.max(0, Math.min(pageW - w, Math.round(rawX)));
    const y = Math.max(0, Math.min(pageH - h, Math.round(rawY)));
    return { x, y };
  }
}
