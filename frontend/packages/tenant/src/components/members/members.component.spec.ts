import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TenantService } from '../../services/tenant/tenant.service';
import { MembersComponent } from './members.component';

describe('MembersComponent', () => {
  let fixture: ComponentFixture<MembersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MembersComponent],
      providers: [
        {
          provide: TenantService,
          useValue: {
            currentTenantId: signal('t1'),
            listMembers: () => Promise.resolve([{ id: 'm1', role: 'owner', email: 'a@b.com' }]),
            createInvite: () => Promise.resolve({ token: 'tok', url: '/invite/tok' }),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MembersComponent);
  });

  it('creates', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('loads members on init', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.members().length).toBe(1);
  });

  it('generates invite url', async () => {
    await fixture.componentInstance.generateInvite();
    expect(fixture.componentInstance.inviteUrl()).toContain('/invite/tok');
  });

  it('copy swallows clipboard rejection', async () => {
    await expectAsync(fixture.componentInstance.copy('x')).toBeResolved();
  });
});
