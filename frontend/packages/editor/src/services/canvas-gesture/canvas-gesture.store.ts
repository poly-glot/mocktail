import { Injectable, inject, signal } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { IWireElement, dividerOrientation as dividerOrientationFn } from '@mocktail/projects';
import { computeColumnRegions } from '../../components/grid-overlay/grid-overlay.component';
import { EditorCommentsService } from '../comments/comments.service';
import { EditorElementsStateService } from '../elements-state/elements-state.service';
import { EditorInlineEditService } from '../inline-edit/inline-edit.service';
import { EditorSelectionService } from '../selection/selection.service';
import { EditorViewportService } from '../viewport/viewport.service';
import { WorkspaceStore } from '../workspace/workspace.store';
import { EditorZoomService } from '../zoom/zoom.service';
import {
  HandleDir,
  IGuideLine,
  IMoveResult,
  ISnapContext,
  snapResizeEdges,
  snapToGuides,
} from './snapping';

export type { HandleDir, IGuideLine, IMoveResult, ISnapContext } from './snapping';
export { GUIDE_THRESHOLD, snapResizeEdges, snapToGuides } from './snapping';

export interface IDragState {
  readonly id: string;
  readonly pageId: string;
  readonly tid: string;
  readonly pid: string;
  readonly startX: number;
  readonly startY: number;
  readonly origX: number;
  readonly origY: number;
}

export interface IResizeState {
  readonly id: string;
  readonly pageId: string;
  readonly tid: string;
  readonly pid: string;
  readonly dir: HandleDir;
  readonly startX: number;
  readonly startY: number;
  readonly orig: { x: number; y: number; w: number; h: number };
  readonly aspect: number;
}

export interface IRotateState {
  readonly id: string;
  readonly pageId: string;
  readonly tid: string;
  readonly pid: string;
  readonly cx: number;
  readonly cy: number;
  readonly startAngle: number;
  readonly origRotation: number;
}

function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

/**
 * Owns every pointer-driven canvas interaction:
 *
 *   • The drag / resize / rotate state machine (begin*, end*, handle*Move,
 *     cancel, isActive, activeId)
 *   • Direct pointer event entry points (onElementPointerDown,
 *     onHandlePointerDown, onRotateHandlePointerDown, onCanvasPointerDown,
 *     onCanvasPointerMove, onCanvasPointerUp, onCanvasPointerCancel)
 *   • Marquee selection state and finalization
 *   • Multi-element drag bookkeeping
 *
 * Replaces the former DragResizeRotateService + EditorPointerOrchestratorService
 * pair: state and the pointer routing that mutates it now live together so
 * element-state writes, selection changes, and collab broadcasts stay
 * co-located with the gestures that produce them. Pure snap math (snapToGuides,
 * snapResizeEdges, GUIDE_THRESHOLD) lives in ./snapping and is re-exported
 * here for backward compatibility.
 */
@Injectable()
export class CanvasGestureStore {
  private readonly _sel = inject(EditorSelectionService);
  private readonly _inline = inject(EditorInlineEditService);
  private readonly _cmts = inject(EditorCommentsService);
  private readonly _elsState = inject(EditorElementsStateService);
  private readonly _workspace = inject(WorkspaceStore);
  private readonly _viewport = inject(EditorViewportService);
  private readonly _zoomSvc = inject(EditorZoomService);
  private readonly _collab = inject(CollabService);

  private _drag: IDragState | null = null;
  private _resize: IResizeState | null = null;
  private _rotate: IRotateState | null = null;
  private _marqueeStart: { x: number; y: number; shift: boolean } | null = null;
  private _multiDragInitial: {
    primaryOrigX: number;
    primaryOrigY: number;
    others: readonly { id: string; origX: number; origY: number }[];
  } | null = null;

  public readonly guides = signal<IGuideLine[]>([]);

  public get drag(): IDragState | null {
    return this._drag;
  }
  public get resize(): IResizeState | null {
    return this._resize;
  }
  public get rotate(): IRotateState | null {
    return this._rotate;
  }

  public activeId(): string | null {
    return this._drag?.id ?? this._resize?.id ?? this._rotate?.id ?? null;
  }

  public isActive(): boolean {
    return this._drag !== null || this._resize !== null || this._rotate !== null;
  }

  // ── Gesture state machine ──────────────────────────────────────────

  public beginDrag(
    el: IWireElement,
    ev: { clientX: number; clientY: number },
    tid: string,
    pid: string,
  ): void {
    this._drag = {
      id: el.id,
      pageId: el.pageId,
      tid,
      pid,
      startX: ev.clientX,
      startY: ev.clientY,
      origX: el.x,
      origY: el.y,
    };
  }

  public beginResize(
    el: IWireElement,
    dir: HandleDir,
    ev: { clientX: number; clientY: number },
    tid: string,
    pid: string,
  ): void {
    this._resize = {
      id: el.id,
      pageId: el.pageId,
      tid,
      pid,
      dir,
      startX: ev.clientX,
      startY: ev.clientY,
      orig: { x: el.x, y: el.y, w: el.w, h: el.h },
      aspect: el.w / Math.max(1, el.h),
    };
  }

  public beginRotate(
    el: IWireElement,
    ev: { clientX: number; clientY: number },
    cx: number,
    cy: number,
    tid: string,
    pid: string,
  ): void {
    const startAngle = Math.atan2(ev.clientY - cy, ev.clientX - cx);
    this._rotate = {
      id: el.id,
      pageId: el.pageId,
      tid,
      pid,
      cx,
      cy,
      startAngle,
      origRotation: el.rotation ?? 0,
    };
  }

  public cancel(): void {
    this._drag = null;
    this._resize = null;
    this._rotate = null;
    this._multiDragInitial = null;
    this._marqueeStart = null;
    this._sel.setMarquee(null);
    this.guides.set([]);
  }

  public endDrag(): IDragState | null {
    const d = this._drag;
    this._drag = null;
    this.guides.set([]);
    return d;
  }

  public endResize(): IResizeState | null {
    const r = this._resize;
    this._resize = null;
    return r;
  }

  public endRotate(): IRotateState | null {
    const r = this._rotate;
    this._rotate = null;
    return r;
  }

  public handleDragMove(
    ev: { clientX: number; clientY: number },
    zoom: number,
    snapCtx: ISnapContext,
  ): IMoveResult | null {
    if (!this._drag) return null;
    const d = this._drag;
    const dx = (ev.clientX - d.startX) / zoom;
    const dy = (ev.clientY - d.startY) / zoom;
    const rawX = Math.round(d.origX + dx);
    const rawY = Math.round(d.origY + dy);
    const moving = snapCtx.elements.find((e) => e.id === d.id);
    if (!moving) return null;
    const { x, y, guides } = snapToGuides(rawX, rawY, moving.w, moving.h, d.id, snapCtx);
    this.guides.set(guides);
    return { id: d.id, patch: { x, y }, guides };
  }

  public handleResizeMove(
    ev: { clientX: number; clientY: number; shiftKey: boolean },
    zoom: number,
    elements: readonly IWireElement[],
    isDividerHorizontal: (el: IWireElement) => boolean,
    snapCtx?: ISnapContext,
  ): IMoveResult | null {
    if (!this._resize) return null;
    const r = this._resize;
    const dx = (ev.clientX - r.startX) / zoom;
    const dy = (ev.clientY - r.startY) / zoom;
    let { x, y, w, h } = r.orig;
    const dir = r.dir;
    if (dir.includes('e')) w = r.orig.w + dx;
    if (dir.includes('w')) {
      w = r.orig.w - dx;
      x = r.orig.x + dx;
    }
    if (dir.includes('s')) h = r.orig.h + dy;
    if (dir.includes('n')) {
      h = r.orig.h - dy;
      y = r.orig.y + dy;
    }
    if (ev.shiftKey && dir.length === 2) {
      const targetAspect = r.aspect;
      if (Math.abs(w) / Math.max(1, Math.abs(h)) > targetAspect) {
        h = Math.sign(h || 1) * (Math.abs(w) / targetAspect);
        if (dir.includes('n')) y = r.orig.y + (r.orig.h - h);
      } else {
        w = Math.sign(w || 1) * (Math.abs(h) * targetAspect);
        if (dir.includes('w')) x = r.orig.x + (r.orig.w - w);
      }
    }
    const orig = elements.find((e) => e.id === r.id);
    const isDivider = orig?.type === 'divider';
    let guides: IGuideLine[] = [];
    if (snapCtx && !(ev.shiftKey && dir.length === 2)) {
      const snapped = snapResizeEdges({ x, y, w, h }, dir, r.id, snapCtx);
      x = snapped.x;
      y = snapped.y;
      w = snapped.w;
      h = snapped.h;
      guides = snapped.guides;
    }
    if (isDivider && orig) {
      const horizontal = isDividerHorizontal(orig);
      if (horizontal) {
        h = 1;
        y = r.orig.y;
        guides = guides.filter((g) => g.orientation === 'v');
      } else {
        w = 1;
        x = r.orig.x;
        guides = guides.filter((g) => g.orientation === 'h');
      }
    }
    const minSize = isDivider ? 1 : 8;
    if (w < minSize) {
      if (dir.includes('w')) x = r.orig.x + (r.orig.w - minSize);
      w = minSize;
    }
    if (h < minSize) {
      if (dir.includes('n')) y = r.orig.y + (r.orig.h - minSize);
      h = minSize;
    }
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
    this.guides.set(guides);
    return { id: r.id, patch: { x, y, w, h }, guides };
  }

  public handleRotateMove(ev: {
    clientX: number;
    clientY: number;
    shiftKey: boolean;
  }): IMoveResult | null {
    if (!this._rotate) return null;
    const r = this._rotate;
    const cur = Math.atan2(ev.clientY - r.cy, ev.clientX - r.cx);
    const delta = ((cur - r.startAngle) * 180) / Math.PI;
    let rot = r.origRotation + delta;
    rot = ((rot % 360) + 360) % 360;
    if (ev.shiftKey) rot = Math.round(rot / 15) * 15;
    return { id: r.id, patch: { rotation: rot }, guides: [] };
  }

  // ── Pointer event entry points ─────────────────────────────────────

  public onElementPointerDown(ev: PointerEvent, el: IWireElement): void {
    if (this._inline.editingId() === el.id) return;
    ev.stopPropagation();

    if (ev.shiftKey) {
      if (el.locked) return;
      this._sel.toggleInSelection(el.id, (p) => this._collab.sendSelection(p));
      return;
    }

    const alreadyInGroup = this._sel.isSelected(el.id) && this._sel.selectionCount() > 1;
    if (!alreadyInGroup) {
      this._sel.setPrimary(el.id);
      this._sel.setExtras(new Set());
    }
    this._collab.sendSelection(el.id);

    if (el.locked) return;
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    this._prepareMultiDrag(el);
    this.beginDrag(el, ev, this._workspace.tid(), this._workspace.pid());
  }

  public onHandlePointerDown(ev: PointerEvent, dir: HandleDir, el: IWireElement): void {
    if (el.locked) return;
    ev.stopPropagation();
    ev.preventDefault();
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    this.beginResize(el, dir, ev, this._workspace.tid(), this._workspace.pid());
  }

  public onRotateHandlePointerDown(ev: PointerEvent, el: IWireElement): void {
    if (el.locked) return;
    ev.stopPropagation();
    ev.preventDefault();
    (ev.target as HTMLElement).setPointerCapture?.(ev.pointerId);
    const boardRect = this._viewport.getBoardRect();
    if (!boardRect) return;
    const z = this._zoomSvc.zoom();
    const cx = boardRect.left + (el.x + el.w / 2) * z;
    const cy = boardRect.top + (el.y + el.h / 2) * z;
    this.beginRotate(el, ev, cx, cy, this._workspace.tid(), this._workspace.pid());
  }

  public onCanvasPointerDown(ev?: PointerEvent): void {
    if (this._cmts.commentMode() && ev) {
      const board = this._viewport.getBoardRect();
      if (board) {
        const z = this._zoomSvc.zoom();
        const x = Math.round((ev.clientX - board.left) / z);
        const y = Math.round((ev.clientY - board.top) / z);
        this._cmts.startDraft(x, y);
        return;
      }
    }
    this._cmts.closePin();

    const shift = !!ev?.shiftKey;
    if (!shift) {
      this._sel.clear();
      this._collab.sendSelection(null);
    }

    if (!ev) return;
    const target = ev.target as HTMLElement | null;
    const inBoardArea = !!target?.closest('.board-scroll');
    if (!inBoardArea) return;
    const board = this._viewport.getBoardRect();
    if (!board) return;
    const z = this._zoomSvc.zoom();
    const bx = (ev.clientX - board.left) / z;
    const by = (ev.clientY - board.top) / z;
    this._marqueeStart = { x: bx, y: by, shift };
    this._sel.setMarquee({ x: bx, y: by, w: 0, h: 0 });
  }

  public onCanvasPointerMove(ev: PointerEvent): void {
    this._broadcastCursor(ev);
    if (this._rotate) {
      this._dispatchRotateMove(ev);
      return;
    }
    if (this._resize) {
      this._dispatchResizeMove(ev);
      return;
    }
    if (this._drag) {
      this._dispatchDragMove(ev);
      return;
    }
    if (this._marqueeStart) {
      this._updateMarquee(ev);
    }
  }

  public onCanvasPointerCancel(): void {
    this._drag = null;
    this._resize = null;
    this._rotate = null;
    this.guides.set([]);
    this._multiDragInitial = null;
    this._marqueeStart = null;
    this._sel.setMarquee(null);
  }

  public onCanvasPointerUp(): void {
    if (this._rotate) {
      const r = this.endRotate();
      if (r && this._sameContext(r.tid, r.pid, r.pageId)) this._collab.flushPendingEdits();
      return;
    }
    if (this._resize) {
      const r = this.endResize();
      if (r && this._sameContext(r.tid, r.pid, r.pageId)) this._collab.flushPendingEdits();
      return;
    }
    if (this._drag) {
      const d = this.endDrag();
      if (d && this._sameContext(d.tid, d.pid, d.pageId)) {
        this._multiDragInitial = null;
        this._collab.flushPendingEdits();
      }
      return;
    }
    if (this._marqueeStart) {
      this._finishMarquee();
    }
  }

  // ── Internals ──────────────────────────────────────────────────────

  private _sameContext(tid: string, pid: string, pageId: string): boolean {
    return (
      this._workspace.tid() === tid &&
      this._workspace.pid() === pid &&
      this._workspace.activePageId() === pageId
    );
  }

  private _broadcastCursor(ev: PointerEvent): void {
    const boardRect = this._viewport.getBoardRect();
    if (!boardRect) return;
    const z = this._zoomSvc.zoom();
    const x = (ev.clientX - boardRect.left) / z;
    const y = (ev.clientY - boardRect.top) / z;
    this._collab.sendCursor(x, y, this._sel.selectedId() ?? undefined);
  }

  private _snapContextForPage(): ISnapContext {
    const page = this._workspace.activePage();
    const gridConfig = this._workspace.gridConfig();
    const elements = this._elsState.list();
    const pageW = page?.width ?? 1200;
    const pageH = page?.height ?? 800;
    return {
      elements,
      pageW,
      pageH,
      gridColumns: computeColumnRegions(gridConfig, pageW),
      snapEnabled: !!(gridConfig.visible && gridConfig.snap),
    };
  }

  private _dispatchRotateMove(ev: PointerEvent): void {
    const res = this.handleRotateMove(ev);
    if (res) this._applyMove(res.id, res.patch);
  }

  private _dispatchResizeMove(ev: PointerEvent): void {
    const ctx = this._snapContextForPage();
    const res = this.handleResizeMove(
      ev,
      this._zoomSvc.zoom(),
      ctx.elements,
      (el) => dividerOrientationFn(el) === 'h',
      ctx,
    );
    if (res) this._applyMove(res.id, res.patch);
  }

  private _dispatchDragMove(ev: PointerEvent): void {
    const ctx = this._snapContextForPage();
    const res = this.handleDragMove(ev, this._zoomSvc.zoom(), ctx);
    if (res) {
      this._applyMove(res.id, res.patch);
      this._applyMultiDragDelta(res.patch);
    }
  }

  private _prepareMultiDrag(primary: IWireElement): void {
    const ids = this._sel.allSelectedIdSet();
    if (ids.size <= 1) {
      this._multiDragInitial = null;
      return;
    }
    const byId = new Map(this._elsState.list().map((e) => [e.id, e]));
    const others: { id: string; origX: number; origY: number }[] = [];
    for (const id of ids) {
      if (id === primary.id) continue;
      const el = byId.get(id);
      if (!el || el.locked) continue;
      others.push({ id: el.id, origX: el.x, origY: el.y });
    }
    this._multiDragInitial = others.length
      ? { primaryOrigX: primary.x, primaryOrigY: primary.y, others }
      : null;
  }

  private _updateMarquee(ev: PointerEvent): void {
    if (!this._marqueeStart) return;
    const board = this._viewport.getBoardRect();
    if (!board) return;
    const z = this._zoomSvc.zoom();
    const bx = (ev.clientX - board.left) / z;
    const by = (ev.clientY - board.top) / z;
    const x = Math.min(this._marqueeStart.x, bx);
    const y = Math.min(this._marqueeStart.y, by);
    const w = Math.abs(bx - this._marqueeStart.x);
    const h = Math.abs(by - this._marqueeStart.y);
    this._sel.setMarquee({ x, y, w, h });
  }

  private _finishMarquee(): void {
    const start = this._marqueeStart;
    const rect = this._sel.marqueeRect();
    this._marqueeStart = null;
    this._sel.setMarquee(null);
    if (!start || !rect) return;
    if (rect.w < 2 && rect.h < 2) return;

    const picked: string[] = [];
    for (const e of this._elsState.list()) {
      if (e.locked) continue;
      if (rectsIntersect(rect, { x: e.x, y: e.y, w: e.w, h: e.h })) {
        picked.push(e.id);
      }
    }

    if (!start.shift) {
      this._applyExclusiveMarqueePick(picked);
      return;
    }
    this._applyShiftMarqueePick(picked);
  }

  private _applyExclusiveMarqueePick(picked: readonly string[]): void {
    if (picked.length === 0) {
      this._sel.clear();
      this._collab.sendSelection(null);
      return;
    }
    const [first, ...rest] = picked;
    this._sel.setPrimary(first);
    this._sel.setExtras(new Set(rest));
    this._collab.sendSelection(first);
  }

  private _applyShiftMarqueePick(picked: readonly string[]): void {
    if (picked.length === 0) return;
    const merged = new Set<string>(this._sel.allSelectedIdSet());
    for (const id of picked) merged.add(id);
    const existingPrimary = this._sel.selectedId();
    if (existingPrimary && merged.has(existingPrimary)) {
      merged.delete(existingPrimary);
      this._sel.setExtras(merged);
      return;
    }
    const iter = merged.values();
    const first = iter.next();
    if (first.done) {
      this._sel.clear();
      this._collab.sendSelection(null);
      return;
    }
    merged.delete(first.value as string);
    this._sel.setPrimary(first.value as string);
    this._sel.setExtras(merged);
    this._collab.sendSelection(first.value as string);
  }

  private _applyMultiDragDelta(primaryPatch: Partial<IWireElement>): void {
    const state = this._multiDragInitial;
    if (!state) return;
    const dx = (primaryPatch.x ?? state.primaryOrigX) - state.primaryOrigX;
    const dy = (primaryPatch.y ?? state.primaryOrigY) - state.primaryOrigY;
    if (dx === 0 && dy === 0) return;
    const byId = new Map<string, { x: number; y: number }>();
    for (const o of state.others) {
      byId.set(o.id, { x: o.origX + dx, y: o.origY + dy });
    }
    this._elsState.list.update((els) =>
      els.map((e) => {
        const p = byId.get(e.id);
        return p ? ({ ...e, x: p.x, y: p.y } as IWireElement) : e;
      }),
    );
    for (const [id, patch] of byId) {
      this._collab.sendEdit(id, patch as Record<string, unknown>);
    }
  }

  private _applyMove(id: string, patch: Partial<IWireElement>): void {
    this._elsState.list.update((els) => {
      const idx = els.findIndex((e) => e.id === id);
      if (idx < 0) return els;
      const next = [...els];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    this._collab.sendEdit(id, patch as Record<string, unknown>);
  }
}
