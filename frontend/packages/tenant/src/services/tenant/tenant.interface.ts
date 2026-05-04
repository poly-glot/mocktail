export interface ITenant {
  id: string;
  name: string;
  ownerId: string;
  createdAt?: unknown;
}

export type TenantRole = 'owner' | 'editor' | 'viewer';

export interface IMembership {
  tenantId: string;
  role: TenantRole;
  displayName?: string;
  email?: string;
  tenantName?: string;
}
