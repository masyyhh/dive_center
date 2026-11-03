export type AdminSection = 'properties' | 'users' | 'staff' | 'items' | 'commissions' | 'packages' | 'audit';
export const canUsePackageBuilder = (environment?: string) => environment !== 'testing';
export function resolveAdminSection(section: string | undefined, role: string | undefined, packagesEnabled: boolean): AdminSection {
  const admin = role === 'GLOBAL_ADMIN';
  const manager = admin || role === 'PROPERTY_MANAGER';
  if (manager && ['users', 'staff', 'items', 'commissions', 'audit'].includes(section || '')) return section as AdminSection;
  if (admin && section === 'properties') return 'properties';
  if (manager && packagesEnabled && section === 'packages') return 'packages';
  return admin ? 'properties' : 'staff';
}
