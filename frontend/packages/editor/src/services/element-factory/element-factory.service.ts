import { Injectable, inject } from '@angular/core';
import { CollabService } from '@mocktail/collab';
import { ElementType, IWireElement, ActivityRepository, toWirePatch } from '@mocktail/projects';
import { IPaletteItem, PALETTE_ITEM_BY_TYPE } from '../../components/palette/palette.component';
import { EditorElementsStateService } from '../elements-state/elements-state.service';

const DEFAULT_TEXT: Partial<Record<ElementType, string>> = {
  heading: 'Heading',
  text: 'Lorem ipsum dolor sit amet.',
  link: 'Link text',
  button: 'Button',
  input: 'Placeholder',
  tag: 'Tag',
  card: 'Card',
};

const INITIAL_PROPS: Partial<Record<ElementType, Partial<IWireElement>>> = {
  heading: { level: 1 },
  divider: { variant: 'h' },
  button: { variant: 'primary' },
};

interface IPlacement {
  readonly type: ElementType;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

@Injectable({ providedIn: 'root' })
export class EditorElementFactoryService {
  private readonly _activity = inject(ActivityRepository);
  private readonly _collab = inject(CollabService);
  private readonly _state = inject(EditorElementsStateService);

  public genId(): string {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return 'el_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  public nextZIndex(elements: readonly IWireElement[]): number {
    return elements.reduce((max, e) => Math.max(max, e.zIndex), 0) + 1;
  }

  public defaultTextFor(type: ElementType): string | undefined {
    return DEFAULT_TEXT[type];
  }

  public initialProps(type: ElementType): Partial<IWireElement> {
    return INITIAL_PROPS[type] ?? {};
  }

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

  public createFromPalette(
    item: IPaletteItem,
    center: { x: number; y: number },
    pageId: string,
    tid: string,
    pid: string,
    elements: readonly IWireElement[],
  ): string {
    const placement = { type: item.type, x: center.x, y: center.y, w: item.w, h: item.h };
    return this._create(placement, pageId, tid, pid, elements);
  }

  public createFromDrop(args: {
    type: ElementType;
    point: { x: number; y: number };
    pageW: number;
    pageH: number;
    pageId: string;
    tid: string;
    pid: string;
    elements: readonly IWireElement[];
  }): string {
    const { type, point, pageW, pageH, pageId, tid, pid, elements } = args;
    const preset = PALETTE_ITEM_BY_TYPE.get(type);
    const w = preset?.w ?? 120;
    const h = preset?.h ?? 40;
    const x = Math.max(0, Math.min(pageW - w, Math.round(point.x - w / 2)));
    const y = Math.max(0, Math.min(pageH - h, Math.round(point.y - h / 2)));
    return this._create({ type, x, y, w, h }, pageId, tid, pid, elements);
  }

  private _create(
    placement: IPlacement,
    pageId: string,
    tid: string,
    pid: string,
    elements: readonly IWireElement[],
  ): string {
    const el: IWireElement = {
      id: this.genId(),
      pageId,
      ...placement,
      zIndex: this.nextZIndex(elements),
      text: this.defaultTextFor(placement.type),
      ...this.initialProps(placement.type),
    };

    this._state.list.update((els) => [...els, el]);
    this._collab.sendEdit(el.id, toWirePatch(el));
    this._collab.flushPendingEdits();
    this._activity.writeActivity(tid, pid, 'element-added', `added ${placement.type}`);
    return el.id;
  }
}
