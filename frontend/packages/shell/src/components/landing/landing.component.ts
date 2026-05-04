import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '@mocktail/auth';
import { TenantService } from '@mocktail/tenant';

@Component({
  selector: 'mk-landing',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingComponent implements OnInit {
  private readonly _authService = inject(AuthService);
  private readonly _tenants = inject(TenantService);
  private readonly _router = inject(Router);

  public readonly isBootstrapping = computed(() => {
    if (this._authService.isLoading()) return true;
    return !!this._authService.user() && !this._tenants.currentTenantId();
  });

  private _lastNavigatedTid: string | null = null;

  constructor() {
    effect(() => {
      const u = this._authService.user();
      if (!u) return;
      const tid = this._tenants.currentTenantId();
      if (tid && tid !== this._lastNavigatedTid) {
        this._lastNavigatedTid = tid;
        this._router.navigate(['/t', tid]);
      }
    });
  }

  public ngOnInit(): void {
    const pending = sessionStorage.getItem('mocktail:pendingInvite');
    if (pending) {
      sessionStorage.removeItem('mocktail:pendingInvite');
      this._router.navigate(['/invite', pending]);
    }
  }
}
