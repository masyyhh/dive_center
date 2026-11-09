/** Match the server's minimum meaningful ink requirement before enabling submission. */
export const signatureHasInk = (strokes: number[][][]) => {
  const points = strokes.flat();
  return points.length >= 2 && points.length <= 2000 && strokes.length <= 50 && points.some(point => Math.hypot(point[0] - points[0][0], point[1] - points[0][1]) >= 5);
};
export const remainingMinutes = (expiresAt: string | undefined, now: number) => {
  if (!expiresAt) return null;
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) ? Math.max(0, Math.ceil((expires - now) / 60000)) : null;
};

/** Preserve issued legacy links while new invitations use Dive Centre URLs. */
export const guestTokenFromHash = (hash: string) => hash.match(/^#(?:dive-centre|water-sports)-tablet\/([a-f0-9]{64})$/)?.[1];

/** Use the same readiness decision for the checklist and the preparation action. */
export const disclaimerReadiness = (overview: {
  testingGuests?: boolean;
  readiness: { pmsPropertyConfigured: boolean; documents: Record<string, number> };
} | null, formType: string) => {
  const guestLookupReady = !!(overview?.testingGuests || overview?.readiness.pmsPropertyConfigured);
  const documentReady = (overview?.readiness.documents[formType] ?? 0) > 0;
  return { guestLookupReady, documentReady, canPrepare: guestLookupReady && documentReady };
};
