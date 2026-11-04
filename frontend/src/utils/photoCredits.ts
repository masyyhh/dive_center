/** Explicit Photo selection takes precedence; legacy bills retain their single photographer. */
export const photoIds = (line: {
  photoStaffIds?: string[];
  photoCredits?: { staffId: string }[];
  photoStaffId?: string | null;
}): string[] => [...new Set(line.photoStaffIds ?? (line.photoCredits?.length
  ? line.photoCredits.map(credit => credit.staffId)
  : line.photoStaffId ? [line.photoStaffId] : []))];
