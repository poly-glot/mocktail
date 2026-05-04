import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth/auth.service';

@Component({
  selector: 'mk-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  public readonly user;
  public readonly isLoading;
  public readonly pendingEmailConfirmation;
  public readonly emailLinkError;

  public readonly showEmailInput = signal(false);
  public readonly email = signal('');
  public readonly sending = signal(false);
  public readonly linkSent = signal(false);
  public readonly error = signal<string | null>(null);

  public readonly submitLabel = computed(() => {
    if (this.sending()) return 'Sending…';
    if (this.pendingEmailConfirmation()) return 'Confirm';
    return 'Send link';
  });

  private readonly _authService = inject(AuthService);
  private readonly _router = inject(Router);

  constructor() {
    this.user = this._authService.user;
    this.isLoading = this._authService.isLoading;
    this.pendingEmailConfirmation = this._authService.pendingEmailConfirmation;
    this.emailLinkError = this._authService.emailLinkError;

    effect(() => {
      if (!this.isLoading() && this.user()) {
        this._router.navigateByUrl('/');
      }
    });
  }

  public async onGoogle(): Promise<void> {
    this.error.set(null);
    try {
      await this._authService.loginWithGoogle();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Google login failed');
    }
  }

  public revealEmail(): void {
    this.showEmailInput.set(true);
  }

  public onEmailInput(value: string): void {
    this.email.set(value);
  }

  public async onEmailSubmit(ev: Event): Promise<void> {
    ev.preventDefault();
    const email = this.email().trim();
    if (!email || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      if (this.pendingEmailConfirmation()) {
        await this._authService.confirmEmailLink(email);
      } else {
        await this._authService.sendEmailLink(email);
        this.linkSent.set(true);
      }
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to send sign-in link');
    } finally {
      this.sending.set(false);
    }
  }
}
