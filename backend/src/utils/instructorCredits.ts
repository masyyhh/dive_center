/** Explicit multi-selection takes precedence; legacy bills retain their single instructor. */
export const instructorIds = (line: {
  instructorStaffIds?: string[];
  instructorCredits?: { staffId: string }[];
  instructorStaffId?: string | null;
}): string[] => [...new Set(line.instructorStaffIds ?? (line.instructorCredits?.length
  ? line.instructorCredits.map(credit => credit.staffId)
  : line.instructorStaffId ? [line.instructorStaffId] : []))];
