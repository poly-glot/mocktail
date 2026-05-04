import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  input,
  signal,
  output,
} from '@angular/core';
import { LUCIDE_ICONS, LucideAngularModule, LucideIconProvider, Search, X } from 'lucide-angular';
import { ICON_NAMES, ICON_PROVIDER_MAP } from './icon-registry';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'mt-icon-picker',
  standalone: true,
  imports: [LucideAngularModule],
  providers: [
    {
      provide: LUCIDE_ICONS,
      multi: true,
      useValue: new LucideIconProvider({
        Search,
        X,
        ...ICON_PROVIDER_MAP,
      }),
    },
  ],
  templateUrl: './icon-picker.component.html',
  styleUrl: './icon-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconPickerComponent {
  public readonly value = input<string | null>(null);

  public readonly query = signal<string>('');
  public readonly open = signal<boolean>(false);

  @ViewChild('searchInput') private readonly _searchInput?: ElementRef<HTMLInputElement>;

  public readonly filteredNames = computed<readonly string[]>(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return ICON_NAMES;
    return ICON_NAMES.filter((n) => n.includes(q));
  });

  public readonly totalCount = ICON_NAMES.length;

  public readonly iconSelect = output<string>();

  public onQueryInput(value: string): void {
    this.query.set(value);
  }

  public onOpen(): void {
    this.open.set(true);
    this.query.set('');
    setTimeout(() => this._searchInput?.nativeElement.focus(), 0);
  }

  public onPick(name: string): void {
    this.iconSelect.emit(name);
    this.onClose();
  }

  public onClose(): void {
    this.open.set(false);
    this.query.set('');
  }

  public onBackdropClick(ev: MouseEvent): void {
    if (ev.target === ev.currentTarget) this.onClose();
  }

  @HostListener('document:keydown.escape')
  public onEscape(): void {
    if (this.open()) this.onClose();
  }

  public formatLabel(name: string): string {
    return name.replace(/-/g, ' ');
  }
}
