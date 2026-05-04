import { ChangeDetectionStrategy, Component, computed, input, signal, output } from '@angular/core';
import { ElementType } from '@mocktail/projects';
import {
  BarChart3,
  CheckSquare,
  Circle as CircleIcon,
  Component as ComponentIcon,
  Heading1,
  Image,
  Layers,
  LayoutTemplate,
  Link as LinkIcon,
  List as ListIcon,
  LUCIDE_ICONS,
  LucideAngularModule,
  LucideIconProvider,
  Menu,
  Minus,
  MousePointer2,
  PanelLeftClose,
  PieChart,
  Search,
  Smartphone,
  Smile as SmileIcon,
  Square,
  Table,
  Tag,
  TextCursorInput,
  ToggleRight,
  Type,
} from 'lucide-angular';

export interface IPaletteItem {
  readonly type: ElementType;
  readonly label: string;
  readonly w: number;
  readonly h: number;
  readonly icon: string;
}

export interface IPalette {
  readonly label: string;
  readonly items: readonly IPaletteItem[];
}

export const PALETTES: readonly IPalette[] = [
  {
    label: 'Layout',
    items: [
      { type: 'rect', label: 'Rect', w: 200, h: 120, icon: 'square' },
      { type: 'circle', label: 'Circle', w: 120, h: 120, icon: 'circle' },
      { type: 'card', label: 'Card', w: 240, h: 140, icon: 'layout-template' },
      { type: 'icon', label: 'Icon', w: 48, h: 48, icon: 'smile' },
      { type: 'divider', label: 'Divider', w: 200, h: 1, icon: 'minus' },
      { type: 'phone-frame', label: 'Phone', w: 320, h: 600, icon: 'smartphone' },
    ],
  },
  {
    label: 'Text',
    items: [
      { type: 'heading', label: 'Heading', w: 240, h: 32, icon: 'heading-1' },
      { type: 'text', label: 'Text', w: 200, h: 20, icon: 'type' },
      { type: 'list', label: 'List', w: 220, h: 80, icon: 'list' },
      { type: 'link', label: 'Link', w: 120, h: 20, icon: 'link' },
      { type: 'tag', label: 'Tag', w: 60, h: 22, icon: 'tag' },
    ],
  },
  {
    label: 'Inputs',
    items: [
      { type: 'button', label: 'Button', w: 120, h: 36, icon: 'mouse-pointer-2' },
      { type: 'input', label: 'Input', w: 220, h: 36, icon: 'text-cursor-input' },
      { type: 'checkbox', label: 'Checkbox', w: 20, h: 20, icon: 'check-square' },
      { type: 'toggle', label: 'Toggle', w: 40, h: 22, icon: 'toggle-right' },
    ],
  },
  {
    label: 'Data',
    items: [
      { type: 'bar-chart', label: 'Bar chart', w: 320, h: 180, icon: 'bar-chart-3' },
      { type: 'donut', label: 'Donut', w: 180, h: 180, icon: 'pie-chart' },
      { type: 'table', label: 'Table', w: 400, h: 200, icon: 'table' },
    ],
  },
  {
    label: 'Navigation',
    items: [
      { type: 'nav', label: 'Nav bar', w: 800, h: 48, icon: 'menu' },
      { type: 'image', label: 'Image', w: 220, h: 140, icon: 'image' },
    ],
  },
];

export function filterPalettes(palettes: readonly IPalette[], query: string): IPalette[] {
  const q = query.trim().toLowerCase();
  if (!q) return palettes.map((c) => ({ ...c, items: [...c.items] }));
  return palettes
    .map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (it) => it.label.toLowerCase().includes(q) || it.type.toLowerCase().includes(q),
      ),
    }))
    .filter((cat) => cat.items.length > 0);
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-palette',
  standalone: true,
  imports: [LucideAngularModule],
  providers: [
    {
      provide: LUCIDE_ICONS,
      multi: true,
      useValue: new LucideIconProvider({
        BarChart3,
        CheckSquare,
        Circle: CircleIcon,
        Component: ComponentIcon,
        Heading1,
        Image,
        Layers,
        LayoutTemplate,
        Link: LinkIcon,
        List: ListIcon,
        Menu,
        Minus,
        MousePointer2,
        PanelLeftClose,
        PieChart,
        Search,
        Smartphone,
        Smile: SmileIcon,
        Square,
        Table,
        Tag,
        TextCursorInput,
        ToggleRight,
        Type,
      }),
    },
  ],
  templateUrl: './palette.component.html',
  styles: [':host { display: contents; }'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaletteComponent {
  public readonly categories = input<readonly IPalette[]>(PALETTES);
  public readonly collapsed = input<boolean>(false);

  public readonly searchValue = signal('');

  public readonly totalCount = computed(() =>
    this.categories().reduce((sum, p) => sum + p.items.length, 0),
  );

  public readonly filteredCategories = computed<IPalette[]>(() =>
    filterPalettes(this.categories(), this.searchValue()),
  );

  public readonly collapseToggle = output<void>();
  public readonly itemClick = output<IPaletteItem>();
  public readonly itemDragStart = output<{
    item: IPaletteItem;
    ev: DragEvent;
  }>();
  public readonly itemDragEnd = output<void>();

  public onSearchInput(value: string): void {
    this.searchValue.set(value);
  }

  public onDragStart(ev: DragEvent, item: IPaletteItem): void {
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('text/mocktail-element', item.type);
    }
    this.itemDragStart.emit({ item, ev });
  }

  public onDragEnd(): void {
    this.itemDragEnd.emit();
  }

  public onItemClick(item: IPaletteItem): void {
    this.itemClick.emit(item);
  }

  public onCollapse(): void {
    this.collapseToggle.emit();
  }
}
