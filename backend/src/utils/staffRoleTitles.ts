export const defaultStaffRoleTitles = [
  'Base Leader', 'Assistant Base Leader', 'Instructor', 'Divemaster',
  'Underwater Photographer', 'Boat Crew', 'Receptionist',
];

export const normalizeRoleTitle = (name: string) => name.trim().replace(/\s+/g, ' ');

export function uniqueRoleTitles(names: string[]): string[] {
  const titles = new Map<string, string>();
  for (const name of names) {
    const title = normalizeRoleTitle(name);
    if (title && !titles.has(title.toLowerCase())) titles.set(title.toLowerCase(), title);
  }
  return [...titles.values()];
}
