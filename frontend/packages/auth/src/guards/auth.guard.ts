import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // If still loading, allow through — the component can show a spinner.
  // Once loaded, redirect unauthenticated users to /login.
  if (auth.isLoading()) return true;
  if (auth.user()) return true;
  return router.createUrlTree(['/login']);
};
