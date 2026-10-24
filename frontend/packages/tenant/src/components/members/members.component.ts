import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { IMember } from '../../services/tenant/tenant.interface';
import { TenantService } from '../../services/tenant/tenant.service';

@Component({
  selector: 'mk-members',
  standalone: true,
  templateUrl: './members.component.html',
  styleUrl: './members.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MembersComponent implements OnInit {
  public readonly members = signal<IMember[]>([]);
  public readonly inviteUrl = signal<string | null>(null);

  private readonly _tenants = inject(TenantService);

  public async ngOnInit(): Promise<void> {
    const list = await this._tenants.listMembers();
    this.members.set(list);
  }

  public async generateInvite(): Promise<void> {
    const { url } = await this._tenants.createInvite('editor');
    this.inviteUrl.set(location.origin + url);
  }

  public async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
  }
}
