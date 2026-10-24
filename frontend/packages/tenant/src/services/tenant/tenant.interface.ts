export interface ITenant {
  id: string;
  name: string;
  ownerId: string;
  createdAt?: unknown;
}

export type TenantRole = 'owner' | 'editor' | 'viewer';

export interface IMember {
  id: string;
  role: TenantRole;
  displayName?: string;
  email?: string;
}

export interface IMembership {
  tenantId: string;
  role: TenantRole;
  displayName?: string;
  email?: string;
  tenantName?: string;
}
