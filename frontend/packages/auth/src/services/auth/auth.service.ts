import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FirebaseService } from '@mocktail/core';
import {
  GoogleAuthProvider,
  isSignInWithEmailLink,
  onAuthStateChanged,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';

const EMAIL_LINK_KEY = 'mocktail:emailForSignIn';

interface SendLinkError extends Error {
  retryAfter?: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  public readonly user = signal<User | null>(null);
  public readonly isLoading = signal(true);
  public readonly pendingEmailConfirmation = signal(false);
  public readonly emailLinkError = signal<string | null>(null);

  // Observable view created eagerly so guards/services can consume it after
  // awaits (toObservable itself requires an injection context).
  public readonly isLoading$ = toObservable(this.isLoading);

  private readonly _firebase = inject(FirebaseService);

  constructor() {
    const auth = this._firebase.auth;
    const hasEmailLink = isSignInWithEmailLink(auth, window.location.href);

    const subscribe = () => {
      onAuthStateChanged(auth, (u) => {
        this.user.set(u);
        this.isLoading.set(false);
      });
    };

    if (hasEmailLink) {
      const email = window.localStorage.getItem(EMAIL_LINK_KEY);
      if (email) {
        this._completeEmailLink(email)

          .catch((err) => {
            console.error('Email link sign-in failed', err);
            this.emailLinkError.set('Sign-in link expired or invalid. Please request a new one.');
          })
          .finally(subscribe);
      } else {
        // Opened in a different browser — ask user to confirm their email.
        this.pendingEmailConfirmation.set(true);
        subscribe();
      }
    } else {
      subscribe();
    }
  }

  public async loginWithGoogle(): Promise<void> {
    await signInWithPopup(this._firebase.auth, new GoogleAuthProvider());
  }

  public async sendEmailLink(email: string): Promise<void> {
    const res = await fetch('/api/email-auth/send-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: SendLinkError = new Error(data.error ?? 'Failed to send sign-in link');
      err.retryAfter = data.retryAfter;
      throw err;
    }
    window.localStorage.setItem(EMAIL_LINK_KEY, email);
    this.emailLinkError.set(null);
  }

  public async confirmEmailLink(email: string): Promise<void> {
    await this._completeEmailLink(email);
  }

  public async logout(): Promise<void> {
    await signOut(this._firebase.auth);
  }

  private async _completeEmailLink(email: string): Promise<void> {
    await signInWithEmailLink(this._firebase.auth, email, window.location.href);
    window.localStorage.removeItem(EMAIL_LINK_KEY);
    window.history.replaceState({}, '', '/login');
    this.pendingEmailConfirmation.set(false);
  }
}
