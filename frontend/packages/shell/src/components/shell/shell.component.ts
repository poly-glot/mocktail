import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { AuthService } from '@mocktail/auth';
import { DialogHostComponent, DialogService } from '@mocktail/cdk';
import { TenantService } from '@mocktail/tenant';
import {
  ChevronDown,
  LUCIDE_ICONS,
  LogOut,
  LucideAngularModule,
  LucideIconProvider,
  Plus,
} from 'lucide-angular';

@Component({
  selector: 'mk-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, LucideAngularModule, DialogHostComponent],
  providers: [
    {
      provide: LUCIDE_ICONS,
      multi: true,
      useValue: new LucideIconProvider({ ChevronDown, Plus, LogOut }),
    },
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  @ViewChild('switcherBtn') public switcherBtnRef?: ElementRef<HTMLButtonElement>;

  public readonly switcherOpen = signal(false);

  private readonly _authService = inject(AuthService);
  public readonly tenants = inject(TenantService);
  private readonly _router = inject(Router);
  private readonly _dialog = inject(DialogService);
  private readonly _host = inject(ElementRef<HTMLElement>);

  public readonly user = this._authService.user;
  public readonly current = this.tenants.current;
  public readonly memberships = this.tenants.memberships;

  public readonly initials = computed(() => {
    const u = this.user();
    if (!u) return '?';
    const src = u.displayName ?? u.email ?? '?';
    const parts = src.split(/[\s@.]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
  });

  public readonly tenantName = computed(() => this.current()?.name ?? 'Choose tenant');

  public toggleSwitcher(): void {
    this.switcherOpen.update((v) => !v);
  }

  public closeSwitcher(returnFocus = false): void {
    if (!this.switcherOpen()) return;
    this.switcherOpen.set(false);
    if (returnFocus) this.switcherBtnRef?.nativeElement.focus();
  }

  public selectTenant(tid: string): void {
    this.tenants.setCurrent(tid);
    this.closeSwitcher(true);
    this._router.navigate(['/t', tid]);
  }

  public async createNewTenant(): Promise<void> {
    this.closeSwitcher(true);
    const name = await this._dialog.prompt({
      title: 'Create new team',
      message: 'Pick a name for your team. You can change it later.',
      inputLabel: 'Team name',
      inputPlaceholder: 'e.g. Acme Labs',
      confirmLabel: 'Create',
      validate: (v) => (v.trim().length === 0 ? 'Team name is required' : null),
    });
    if (!name) return;
    const tid = await this.tenants.createTenant(name.trim());
    this._router.navigate(['/t', tid]);
  }

  public async copyInvite(): Promise<void> {
    try {
      const { url } = await this.tenants.createInvite('editor');
      const full = location.origin + url;
      await navigator.clipboard.writeText(full);
      await this._dialog.alert({
        title: 'Invite link copied',
        message: `${full}\n\nShare this link with your teammate. It will add them as an editor.`,
      });
    } catch (e) {
      await this._dialog.alert({
        title: 'Failed to create invite',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  public async logout(): Promise<void> {
    const ok = await this._dialog.confirm({
      title: 'Log out?',
      message: 'You will need to sign in again to return to this workspace.',
      confirmLabel: 'Log out',
      cancelLabel: 'Stay signed in',
    });
    if (!ok) return;
    await this._authService.logout();
    this._router.navigateByUrl('/login');
  }

  @HostListener('document:click', ['$event'])
  public onDocumentClick(event: MouseEvent): void {
    if (!this.switcherOpen()) return;
    const target = event.target as Node | null;
    const breadcrumb = this._host.nativeElement.querySelector('.breadcrumb');
    if (target && breadcrumb && !breadcrumb.contains(target)) {
      this.closeSwitcher(false);
    }
  }

  // Angular 21 template type-checker narrows $event for keydown.<key> bindings
  // to Event, not KeyboardEvent — runtime is still a KeyboardEvent.
  @HostListener('document:keydown.escape', ['$event'])
  public onEscape(event: Event): void {
    if (!this.switcherOpen()) return;
    event.stopPropagation();
    this.closeSwitcher(true);
  }
}
