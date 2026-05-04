import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TenantService } from '@mocktail/tenant';
import { AuthService } from '../../services/auth/auth.service';

@Component({
  selector: 'mk-invite-accept',
  standalone: true,
  templateUrl: './invite-accept.component.html',
  styleUrl: './invite-accept.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InviteAcceptComponent {
  public readonly user;
  public readonly working = signal(false);
  public readonly error = signal<string | null>(null);

  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _authService = inject(AuthService);
  private readonly _tenants = inject(TenantService);

  constructor() {
    this.user = this._authService.user;
  }

  public signIn(): void {
    const t = this._token;
    sessionStorage.setItem('mocktail:pendingInvite', t);
    this._router.navigateByUrl('/login');
  }

  public async accept(): Promise<void> {
    this.working.set(true);
    this.error.set(null);
    try {
      const tid = await this._tenants.acceptInvite(this._token);
      sessionStorage.removeItem('mocktail:pendingInvite');
      this._router.navigate(['/t', tid]);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to accept invite');
    } finally {
      this.working.set(false);
    }
  }

  private get _token(): string {
    return this._route.snapshot.paramMap.get('token') ?? '';
  }
}
