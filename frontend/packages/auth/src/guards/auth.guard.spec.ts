import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { AuthService } from '../services/auth/auth.service';
import { authGuard } from './auth.guard';

describe('authGuard', () => {
  let isLoading: ReturnType<typeof signal<boolean>>;
  let user: ReturnType<typeof signal<unknown>>;
  let routerSpy: jasmine.SpyObj<Router>;

  beforeEach(() => {
    isLoading = signal(false);
    user = signal<unknown>({ uid: 'u1' });
    routerSpy = jasmine.createSpyObj('Router', ['createUrlTree']);
    routerSpy.createUrlTree.and.returnValue({} as ReturnType<Router['createUrlTree']>);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isLoading, user } },
        { provide: Router, useValue: routerSpy },
      ],
    });
  });

  it('returns true when user is signed in', async () => {
    const ret = await TestBed.runInInjectionContext(() => authGuard({} as never, {} as never));
    expect(ret).toBe(true);
  });

  it('redirects to /login when no user', async () => {
    user.set(null);
    await TestBed.runInInjectionContext(() => authGuard({} as never, {} as never));
    expect(routerSpy.createUrlTree).toHaveBeenCalledWith(['/login']);
  });
});
