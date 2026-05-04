import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '@mocktail/auth';
import { DialogService } from '@mocktail/cdk';
import { TenantService } from '@mocktail/tenant';
import { ShellComponent } from './shell.component';

describe('ShellComponent', () => {
  let router: Router;
  let dialog: jasmine.SpyObj<DialogService>;

  beforeEach(async () => {
    dialog = jasmine.createSpyObj('DialogService', ['alert', 'confirm', 'prompt']);
    dialog.confirm.and.resolveTo(true);
    dialog.alert.and.resolveTo();
    dialog.prompt.and.resolveTo(null);
    await TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            user: signal({ uid: 'u', displayName: 'Test User', email: 't@e.com' }),
            logout: () => Promise.resolve(),
          },
        },
        {
          provide: TenantService,
          useValue: {
            current: signal({ id: 't', name: 'My Team' }),
            memberships: signal([]),
            currentTenantId: signal(null),
            tenantsById: signal(new Map()),
            setCurrent: jasmine.createSpy('setCurrent'),
            createTenant: () => Promise.resolve('new-tid'),
            createInvite: () => Promise.resolve({ token: 'tok', url: '/invite/tok' }),
          },
        },
        { provide: DialogService, useValue: dialog },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });

  it('creates and computes initials', () => {
    const fix = TestBed.createComponent(ShellComponent);
    expect(fix.componentInstance.initials()).toBe('TU');
    expect(fix.componentInstance.tenantName()).toBe('My Team');
  });

  it('toggleSwitcher flips open state', () => {
    const fix = TestBed.createComponent(ShellComponent);
    fix.componentInstance.toggleSwitcher();
    expect(fix.componentInstance.switcherOpen()).toBe(true);
    fix.componentInstance.toggleSwitcher();
    expect(fix.componentInstance.switcherOpen()).toBe(false);
  });

  it('selectTenant navigates', () => {
    const fix = TestBed.createComponent(ShellComponent);
    fix.componentInstance.selectTenant('t9');
    expect(router.navigate).toHaveBeenCalledWith(['/t', 't9']);
  });

  it('logout routes to /login', async () => {
    const fix = TestBed.createComponent(ShellComponent);
    await fix.componentInstance.logout();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });
});
