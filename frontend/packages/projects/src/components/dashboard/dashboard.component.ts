import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DialogService } from '@mocktail/cdk';
import { TenantService } from '@mocktail/tenant';
import {
  Check,
  Diamond,
  LUCIDE_ICONS,
  LucideAngularModule,
  LucideIconProvider,
  MessageCircle,
  Minus,
  Plus,
  Search,
  Sparkles,
  Users,
} from 'lucide-angular';
import { IActivity, IProject } from '../../interfaces/project.interface';
import { ProjectsRepository } from '../../repositories/projects.repository';
import { ProjectApiService } from '../../services/project-api/project-api.service';

@Component({
  selector: 'mk-dashboard',
  standalone: true,
  imports: [RouterLink, LucideAngularModule],
  providers: [
    {
      provide: LUCIDE_ICONS,
      multi: true,
      useValue: new LucideIconProvider({
        Search,
        Plus,
        Minus,
        Sparkles,
        MessageCircle,
        Check,
        Diamond,
        Users,
      }),
    },
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent implements OnDestroy {
  public readonly activity = signal<IActivity[]>([]);
  public readonly creating = signal(false);
  public readonly search = signal('');

  private readonly _tenants = inject(TenantService);
  private readonly _projects = inject(ProjectApiService);
  private readonly _projectsRepo = inject(ProjectsRepository);
  private readonly _router = inject(Router);
  private readonly _dialog = inject(DialogService);

  public readonly tenant = this._tenants.current;
  public readonly tid = computed(() => this._tenants.currentTenantId());
  public readonly items = this._projectsRepo.projectsSignal(this.tid);

  public readonly filtered = computed(() => {
    const q = this.search().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((p) => p.name.toLowerCase().includes(q));
  });

  private _unsubActivity: (() => void) | null = null;

  constructor() {
    effect(() => {
      const tid = this.tid();
      this._unsubActivity?.();
      this._unsubActivity = null;
      this.activity.set([]);
      if (tid) {
        this._unsubActivity = this._projects.subscribeTenantActivity(tid, 12, (rows) =>
          this.activity.set(rows),
        );
      }
    });
  }

  public ngOnDestroy(): void {
    this._unsubActivity?.();
  }

  public activityIcon(type: IActivity['type']): string {
    switch (type) {
      case 'element-added':
        return 'plus';
      case 'element-deleted':
        return 'minus';
      case 'ai-generated':
        return 'sparkles';
      case 'comment-added':
        return 'message-circle';
      case 'comment-resolved':
        return 'check';
      case 'project-created':
        return 'diamond';
      case 'project-renamed':
        return 'diamond';
      default:
        return 'diamond';
    }
  }

  public onSearchInput(value: string): void {
    this.search.set(value);
  }

  public async newProject(): Promise<void> {
    const tid = this.tid();
    if (!tid) return;
    this.creating.set(true);
    try {
      const pid = await this._projects.createProject(
        tid,
        `Untitled ${new Date().toLocaleDateString()}`,
      );
      this._router.navigate(['/t', tid, 'p', pid]);
    } finally {
      this.creating.set(false);
    }
  }

  public async rename(p: IProject): Promise<void> {
    const tid = this.tid();
    if (!tid) return;
    const name = await this._dialog.prompt({
      title: 'Rename project',
      inputLabel: 'Project name',
      inputValue: p.name,
      confirmLabel: 'Rename',
      validate: (v) => {
        const t = v.trim();
        if (t.length === 0) return 'Project name is required';
        if (t.length > 80) return 'Keep the name under 80 characters';
        return null;
      },
    });
    if (!name) return;
    const trimmed = name.trim();
    if (trimmed === p.name) return;
    await this._projects.renameProject(tid, p.id, trimmed);
  }

  public async softDelete(p: IProject): Promise<void> {
    const tid = this.tid();
    if (!tid) return;
    const ok = await this._dialog.confirm({
      title: `Delete “${p.name}”?`,
      message: 'This removes the project from your dashboard. You can restore it from Trash.',
      confirmLabel: 'Delete project',
      cancelLabel: 'Keep',
      destructive: true,
    });
    if (!ok) return;
    await this._projects.softDeleteProject(tid, p.id);
  }

  public openMembers(): void {
    const tid = this.tid();
    if (!tid) return;
    this._router.navigate(['/t', tid, 'settings', 'members']);
  }

  public relative(ts?: unknown): string {
    if (!ts) return '';
    const asDate = ts as { toDate?: () => Date };
    const d = asDate.toDate ? asDate.toDate() : new Date(ts as string | number);
    const diff = Date.now() - d.getTime();
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }
}
