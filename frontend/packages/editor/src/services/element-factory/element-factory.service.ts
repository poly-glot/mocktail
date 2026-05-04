import { Injectable, inject } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { ElementType, IWireElement, ProjectApiService } from '@mocktail/projects';
import { IPaletteItem, PALETTES } from '../../components/palette/palette.component';
import { EditorElementsStateService } from '../elements-state/elements-state.service';

/**
 * Creates IWireElement instances — both pure builders and orchestrated flows
 * that route writes through the Zig collab proxy. Pulled out of EditorComponent
 * so the component can focus on view wiring and so creation flows can be unit
 * tested without Angular's DOM/router plumbing.
 *
 * Pure helpers (genId, cloneWithOffset, defaultTextFor) remain stateless;
 * createFromPalette / createFromDrop optimistically append to the local
 * elements signal so the new shape paints immediately, then forward the full
 * element through CollabService.sendEdit for the proxy to commit.
 */
@Injectable({ providedIn: 'root' })
export class EditorElementFactoryService {
  private readonly _projects = inject(ProjectApiService);
  private readonly _collab = inject(CollabService);
  private readonly _state = inject(EditorElementsStateService);

  public genId(): string {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return 'el_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  public nextZIndex(elements: readonly IWireElement[]): number {
    const max = elements.reduce((m, e) => (e.zIndex > m ? e.zIndex : m), 0);
    return max + 1;
  }

  public defaultTextFor(type: ElementType): string | undefined {
    switch (type) {
      case 'heading':
        return 'Heading';
      case 'text':
        return 'Lorem ipsum dolor sit amet.';
      case 'link':
        return 'Link text';
      case 'button':
        return 'Button';
      case 'input':
        return 'Placeholder';
      case 'tag':
        return 'Tag';
      case 'card':
        return 'Card';
      default:
        return undefined;
    }
  }

  public initialProps(type: ElementType): Partial<IWireElement> {
    if (type === 'heading') return { level: 1 };
    if (type === 'divider') return { variant: 'h' };
    if (type === 'button') return { variant: 'primary' };
    return {};
  }

  /**
   * Returns a fresh copy of `src` offset by (offset, offset) with a new id and
   * a zIndex bumped past everything currently on the board. Does not persist —
   * the caller decides how/when to write and to set selection.
   */
  public cloneWithOffset(
    src: IWireElement,
    offset: number,
    elements: readonly IWireElement[],
  ): IWireElement {
    return {
      ...src,
      id: this.genId(),
      x: src.x + offset,
      y: src.y + offset,
      zIndex: this.nextZIndex(elements),
    };
  }

  /**
   * Builds a new element from a palette item at the viewport-centered `center`
   * coordinate, appends it to local state, and forwards a full-element write
   * through the Zig proxy. Returns the new id so the caller can update
   * selection.
   */
  public async createFromPalette(
    item: IPaletteItem,
    center: { x: number; y: number },
    pageId: string,
    tid: string,
    pid: string,
    elements: readonly IWireElement[],
  ): Promise<string> {
    const id = this.genId();
    const el: IWireElement = {
      id,
      pageId,
      type: item.type,
      x: center.x,
      y: center.y,
      w: item.w,
      h: item.h,
      zIndex: this.nextZIndex(elements),
      text: this.defaultTextFor(item.type),
      ...this.initialProps(item.type),
    };
    this._appendAndSend(el);
    this._projects.writeActivity(tid, pid, 'element-added', `added ${item.type}`);
    return id;
  }

  /**
   * Builds a new element for a canvas drop at a pre-translated board point.
   * The caller handles DOM rect / zoom math because it needs the live boardEl
   * reference; this service applies the element-size offset, clamps to the
   * page bounds, and persists.
   *
   * `point` is the drop location in board coordinates (post-zoom, relative to
   * the board origin) — i.e. `(clientX - boardRect.left) / zoom`.
   */
  public async createFromDrop(args: {
    type: ElementType;
    point: { x: number; y: number };
    pageW: number;
    pageH: number;
    pageId: string;
    tid: string;
    pid: string;
    elements: readonly IWireElement[];
  }): Promise<string> {
    const { type, point, pageW, pageH, pageId, tid, pid, elements } = args;
    const preset = PALETTES.flatMap((p) => p.items).find((i) => i.type === type);
    const w = preset?.w ?? 120;
    const h = preset?.h ?? 40;
    const rawX = point.x - w / 2;
    const rawY = point.y - h / 2;
    const x = Math.max(0, Math.min(pageW - w, Math.round(rawX)));
    const y = Math.max(0, Math.min(pageH - h, Math.round(rawY)));
    const id = this.genId();
    const el: IWireElement = {
      id,
      pageId,
      type,
      x,
      y,
      w,
      h,
      zIndex: this.nextZIndex(elements),
      text: this.defaultTextFor(type),
      ...this.initialProps(type),
    };
    this._appendAndSend(el);
    this._projects.writeActivity(tid, pid, 'element-added', `added ${type}`);
    return id;
  }

  // Optimistic add + forward-to-proxy. Undefined-field stripping mirrors the
  // element-editor paste/duplicate path so both create flows put the same
  // shape on the wire.
  private _appendAndSend(el: IWireElement): void {
    this._state.list.update((els) => [...els, el]);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(el)) {
      if (v !== undefined) patch[k] = v;
    }
    this._collab.sendEdit(el.id, patch);
    this._collab.flushPendingEdits();
  }
}
