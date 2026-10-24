import { ChangeDetectionStrategy, Component, computed, input, signal, output } from '@angular/core';
import { ElementType, IWireElement } from '@mocktail/projects';
import {
  GripVertical,
  Lock,
  LUCIDE_ICONS,
  LucideAngularModule,
  LucideIconProvider,
  PanelLeftClose,
  Unlock,
} from 'lucide-angular';
import { PALETTE_ICONS, PALETTE_ITEM_BY_TYPE } from '../palette/palette.component';

export function iconForType(type: ElementType): string {
  return PALETTE_ITEM_BY_TYPE.get(type)?.icon ?? 'square';
}

export function labelForElement(el: IWireElement): string {
  const text = el.text?.trim();
  if (text) return text;
  return PALETTE_ITEM_BY_TYPE.get(el.type)?.label ?? el.type;
}

export function computeDropPosition(clientY: number, rect: DOMRect): 'above' | 'below' {
  return clientY - rect.top < rect.height / 2 ? 'above' : 'below';
}

export interface IReorderEvent {
  readonly fromId: string;
  readonly toId: string;
  readonly position: 'above' | 'below';
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-layers-panel',
  standalone: true,
  imports: [LucideAngularModule],
  providers: [
    {
      provide: LUCIDE_ICONS,
      multi: true,
      useValue: new LucideIconProvider({
        ...PALETTE_ICONS,
        GripVertical,
        Lock,
        PanelLeftClose,
        Unlock,
      }),
    },
  ],
  templateUrl: './layers-panel.component.html',
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LayersPanelComponent {
  public readonly layers = input.required<readonly IWireElement[]>();
  public readonly selectedId = input<string | null>(null);
  public readonly collapsed = input<boolean>(false);

  public readonly dragLayerId = signal<string | null>(null);
  public readonly dropTarget = signal<{ id: string; position: 'above' | 'below' } | null>(null);

  public readonly layerCount = computed(() => this.layers().length);

  public readonly collapseToggle = output<void>();
  public readonly layerSelect = output<string>();
  public readonly lockToggle = output<string>();
  public readonly reorder = output<IReorderEvent>();

  public readonly iconForType = iconForType;
  public readonly labelForElement = labelForElement;

  public isDropAbove(id: string): boolean {
    const t = this.dropTarget();
    return t?.id === id && t?.position === 'above';
  }

  public isDropBelow(id: string): boolean {
    const t = this.dropTarget();
    return t?.id === id && t?.position === 'below';
  }

  public onCollapse(): void {
    this.collapseToggle.emit();
  }

  public onSelect(id: string): void {
    this.layerSelect.emit(id);
  }

  public onLockClick(id: string, ev: Event): void {
    ev.stopPropagation();
    this.lockToggle.emit(id);
  }

  public onDragStart(ev: DragEvent, id: string): void {
    this.dragLayerId.set(id);
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', 'layer:' + id);
    }
  }

  public onDragOver(ev: DragEvent, targetId: string): void {
    const fromId = this.dragLayerId();
    if (!fromId) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    if (fromId === targetId) {
      this.dropTarget.set(null);
      return;
    }
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const position = computeDropPosition(ev.clientY, rect);
    const cur = this.dropTarget();
    if (!cur || cur.id !== targetId || cur.position !== position) {
      this.dropTarget.set({ id: targetId, position });
    }
  }

  public onDragEnd(): void {
    this.dragLayerId.set(null);
    this.dropTarget.set(null);
  }

  public onDragLeavePanel(ev: DragEvent): void {
    const related = ev.relatedTarget as Node | null;
    const panel = ev.currentTarget as HTMLElement;
    if (!related || !panel.contains(related)) {
      this.dropTarget.set(null);
    }
  }

  public onDrop(ev: DragEvent, targetId: string): void {
    ev.preventDefault();
    const fromId = this.dragLayerId();
    const drop = this.dropTarget();
    this.dragLayerId.set(null);
    this.dropTarget.set(null);
    if (!fromId || fromId === targetId) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const position =
      drop && drop.id === targetId ? drop.position : computeDropPosition(ev.clientY, rect);
    this.reorder.emit({ fromId, toId: targetId, position });
  }
}
