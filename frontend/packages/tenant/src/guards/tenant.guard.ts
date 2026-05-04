import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '@mocktail/auth';
import { filter, firstValueFrom, map, race } from 'rxjs';
import { TenantService } from '../services/tenant/tenant.service';

export const tenantGuard: CanActivateFn = async (route) => {
  const tenants = inject(TenantService);
  const auth = inject(AuthService);
  const router = inject(Router);

  // Capture observables while still in injection context so we can await them
  // later without tripping NG0203.
  const authLoading$ = auth.isLoading$;
  const memberships$ = tenants.memberships$;
  const tenantsLoading$ = tenants.loading$;

  const tid = route.paramMap.get('tid');
  if (!tid) return router.createUrlTree(['/']);

  if (auth.isLoading()) {
    await firstValueFrom(authLoading$.pipe(filter((v) => !v)));
  }
  if (!auth.user()) return router.createUrlTree(['/login']);

  const hasMembership = (): boolean => tenants.memberships().some((m) => m.tenantId === tid);
  if (!hasMembership() && tenants.loading()) {
    await firstValueFrom(
      race(
        memberships$.pipe(
          filter((ms) => ms.some((m) => m.tenantId === tid)),
          map(() => true),
        ),
        tenantsLoading$.pipe(
          filter((l) => !l),
          map(() => true),
        ),
      ),
    );
  }
  if (!hasMembership()) return router.createUrlTree(['/']);
  return true;
};
