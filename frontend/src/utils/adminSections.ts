export type AdminSection = 'properties' | 'users' | 'staff' | 'items' | 'commissions' | 'audit';
export function resolveAdminSection(section: string | undefined, role: string | undefined): AdminSection {
  const admin = role === 'GLOBAL_ADMIN';
  const manager = admin || role === 'PROPERTY_MANAGER';
  if (manager && ['users', 'staff', 'items', 'commissions', 'audit'].includes(section || '')) return section as AdminSection;
  if (admin && section === 'properties') return 'properties';
  return admin ? 'properties' : 'staff';
}
