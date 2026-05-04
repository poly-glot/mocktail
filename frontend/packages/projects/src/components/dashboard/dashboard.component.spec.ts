import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { TenantService } from '@mocktail/tenant';
import { IProject } from '../../interfaces/project.interface';
import { ProjectsRepository } from '../../repositories/projects.repository';
import { ProjectApiService } from '../../services/project-api/project-api.service';
import { DashboardComponent } from './dashboard.component';

describe('DashboardComponent', () => {
  let itemsStub: ReturnType<typeof signal<IProject[]>>;

  beforeEach(async () => {
    itemsStub = signal<IProject[]>([]);
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        {
          provide: TenantService,
          useValue: {
            current: signal({ id: 't', name: 'T' }),
            currentTenantId: signal('t'),
          },
        },
        {
          provide: ProjectsRepository,
          useValue: { projectsSignal: () => itemsStub },
        },
        {
          provide: ProjectApiService,
          useValue: {
            subscribeTenantActivity: () => () => {},
            createProject: () => Promise.resolve('pid'),
            renameProject: () => Promise.resolve(),
            softDeleteProject: () => Promise.resolve(),
          },
        },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    }).compileComponents();
  });

  it('creates', () => {
    const fix = TestBed.createComponent(DashboardComponent);
    expect(fix.componentInstance).toBeTruthy();
  });

  it('filters items by search term', () => {
    itemsStub.set([
      { id: '1', name: 'Apple' },
      { id: '2', name: 'Banana' },
    ]);
    const fix = TestBed.createComponent(DashboardComponent);
    const c = fix.componentInstance;
    c.onSearchInput('app');
    expect(c.filtered().length).toBe(1);
  });

  it('activityIcon returns a lucide icon name per type', () => {
    const fix = TestBed.createComponent(DashboardComponent);
    expect(fix.componentInstance.activityIcon('element-added')).toBe('plus');
    expect(fix.componentInstance.activityIcon('ai-generated')).toBe('sparkles');
    expect(fix.componentInstance.activityIcon('project-renamed')).toBe('diamond');
  });

  it('relative formats recent timestamps', () => {
    const fix = TestBed.createComponent(DashboardComponent);
    expect(fix.componentInstance.relative()).toBe('');
    const now = Date.now();
    expect(fix.componentInstance.relative(now)).toBe('just now');
    expect(fix.componentInstance.relative(now - 120_000)).toBe('2m ago');
  });
});
