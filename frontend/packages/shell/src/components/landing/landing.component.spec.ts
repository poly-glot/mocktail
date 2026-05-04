import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '@mocktail/auth';
import { TenantService } from '@mocktail/tenant';
import { LandingComponent } from './landing.component';

describe('LandingComponent', () => {
  async function configure(
    overrides: {
      user?: ReturnType<typeof signal<unknown>>;
      tenantId?: ReturnType<typeof signal<string | null>>;
      isLoading?: ReturnType<typeof signal<boolean>>;
    } = {},
  ): Promise<void> {
    const user = overrides.user ?? signal(null);
    const tenantId = overrides.tenantId ?? signal(null);
    const isLoading = overrides.isLoading ?? signal(false);
    await TestBed.configureTestingModule({
      imports: [LandingComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user, isLoading } },
        { provide: TenantService, useValue: { currentTenantId: tenantId } },
      ],
    }).compileComponents();
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('creates', async () => {
    await configure();
    const fix = TestBed.createComponent(LandingComponent);
    expect(fix.componentInstance).toBeTruthy();
  });

  it('redirects to invite flow when pendingInvite is in sessionStorage', async () => {
    await configure();
    sessionStorage.setItem('mocktail:pendingInvite', 'tok');
    const fix = TestBed.createComponent(LandingComponent);
    fix.detectChanges();
    const router = TestBed.inject(Router) as unknown as { navigate: jasmine.Spy };
    expect(router.navigate).toHaveBeenCalledWith(['/invite', 'tok']);
    expect(sessionStorage.getItem('mocktail:pendingInvite')).toBeNull();
  });

  it('navigates to tenant dashboard when signed in with resolved tenant', async () => {
    const user = signal({ uid: 'u1' } as unknown);
    const tenantId = signal<string | null>('t1');
    await configure({ user, tenantId });
    const fix = TestBed.createComponent(LandingComponent);
    fix.detectChanges();
    const router = TestBed.inject(Router) as unknown as { navigate: jasmine.Spy };
    expect(router.navigate).toHaveBeenCalledWith(['/t', 't1']);
  });

  it('shows the marketing page when not authenticated', async () => {
    await configure();
    const fix = TestBed.createComponent(LandingComponent);
    fix.detectChanges();
    const root = fix.nativeElement as HTMLElement;
    expect(root.textContent).toContain('From a sentence to a wireframe');
    expect(root.textContent).toContain('FEATURES');
  });

  it('shows the bootstrap splash while a signed-in user is waiting for tenant resolution', async () => {
    const user = signal({ uid: 'u1' } as unknown);
    const tenantId = signal<string | null>(null);
    await configure({ user, tenantId });
    const fix = TestBed.createComponent(LandingComponent);
    fix.detectChanges();
    const root = fix.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Preparing your workspace');
  });
});
