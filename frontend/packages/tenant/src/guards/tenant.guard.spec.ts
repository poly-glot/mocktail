import { TestBed } from '@angular/core/testing';
import { Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from '@mocktail/auth';
import { TenantService } from '../services/tenant/tenant.service';
import { tenantGuard } from './tenant.guard';

describe('tenantGuard', () => {
  let router: jasmine.SpyObj<Router>;

  beforeEach(() => {
    router = jasmine.createSpyObj('Router', ['createUrlTree']);
    router.createUrlTree.and.returnValue({} as ReturnType<Router['createUrlTree']>);
  });

  function setup(
    tid: string | null,
    user: unknown,
    memberships: { tenantId: string }[],
    isAuthLoading = false,
    isTenantLoading = false,
  ) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        {
          provide: AuthService,
          useValue: { isLoading: signal(isAuthLoading), user: signal(user) },
        },
        {
          provide: TenantService,
          useValue: {
            memberships: signal(memberships),
            loading: signal(isTenantLoading),
          },
        },
      ],
    });
    const route = { paramMap: convertToParamMap(tid ? { tid } : {}) };
    return TestBed.runInInjectionContext(() => tenantGuard(route as never, {} as never));
  }

  it('redirects to / when no tid param', async () => {
    await setup(null, { uid: 'u' }, []);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/']);
  });

  it('redirects to /login when no user', async () => {
    await setup('t1', null, []);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login']);
  });

  it('returns true when user has membership for tid', async () => {
    const ret = await setup('t1', { uid: 'u' }, [{ tenantId: 't1' }]);
    expect(ret).toBe(true);
  });

  it('redirects to / when no membership after load', async () => {
    await setup('t1', { uid: 'u' }, [{ tenantId: 't2' }]);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/']);
  });
});
