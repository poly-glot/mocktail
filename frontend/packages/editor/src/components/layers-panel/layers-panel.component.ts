import { ChangeDetectionStrategy, Component, computed, input, signal, output } from '@angular/core';
import { ElementType, IWireElement } from '@mocktail/projects';
import {
  BarChart3,
  CheckSquare,
  GripVertical,
  Heading1,
  Image,
  LayoutTemplate,
  Link as LinkIcon,
  Lock,
  LUCIDE_ICONS,
  LucideAngularModule,
  LucideIconProvider,
  Menu,
  Minus,
  MousePointer2,
  PanelLeftClose,
  PieChart,
  Smartphone,
  Square,
  Table,
  Tag,
  TextCursorInput,
  ToggleRight,
  Type,
  Unlock,
} from 'lucide-angular';
import { PALETTES } from '../palette/palette.component';

export function iconForType(type: ElementType): string {
  const preset = PALETTES.flatMap((p) => p.items).find((i) => i.type === type);
  return preset?.icon ?? 'square';
}

export function labelForElement(el: IWireElement): string {
  if (el.text && el.text.trim()) return el.text.trim();
  const preset = PALETTES.flatMap((p) => p.items).find((i) => i.type === el.type);
  return preset?.label ?? el.type;
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
        BarChart3,
        CheckSquare,
        GripVertical,
        Heading1,
        Image,
        LayoutTemplate,
        Link: LinkIcon,
        Lock,
        Menu,
        Minus,
        MousePointer2,
        PanelLeftClose,
        PieChart,
        Smartphone,
        Square,
        Table,
        Tag,
        TextCursorInput,
        ToggleRight,
        Type,
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

  public iconFor(type: ElementType): string {
    return iconForType(type);
  }

  public labelFor(el: IWireElement): string {
    return labelForElement(el);
  }

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
