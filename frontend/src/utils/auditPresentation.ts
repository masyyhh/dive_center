const areas: Record<string, string> = {
  items: 'catalogue', bills: 'bills', staff: 'staff records', properties: 'properties',
  users: 'user accounts', reports: 'reports', attendance: 'attendance', presence: 'attendance',
  audit: 'activity history', auth: 'account access', 'dive-centre': 'disclaimer forms',
  'water-sports': 'disclaimer forms',
};

export function auditDetailsSummary(raw: string | null | undefined): string {
  if (!raw) return 'No additional details.';
  let details: unknown;
  try { details = JSON.parse(raw); } catch { return raw; }
  if (!details || typeof details !== 'object' || Array.isArray(details)) return raw;
  const data = details as Record<string, unknown>;
  if (typeof data.method !== 'string' || typeof data.path !== 'string' || typeof data.status !== 'number') {
    return Object.entries(data).map(([key, value]) => {
      const label = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, char => char.toUpperCase());
      const text = value === null ? 'None' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `${label}: ${text}`;
    }).join(' · ') || 'No additional details.';
  }
  const area = areas[data.path.split('/')[2]] || 'website data';
  const verb = ({ GET: 'Viewed', POST: 'Submitted a request for', PUT: 'Submitted an update to', PATCH: 'Submitted an update to', DELETE: 'Requested removal from' } as Record<string, string>)[data.method] || 'Requested';
  const outcome = data.status >= 200 && data.status < 300 ? 'Completed successfully'
    : data.status >= 300 && data.status < 400 ? 'Redirected'
    : data.status === 401 ? 'Sign-in required'
    : data.status === 403 ? 'Access denied'
    : data.status === 404 ? 'Not found'
    : data.status >= 500 ? 'Could not complete because of a server problem'
    : 'Request was not completed';
  const elapsed = typeof data.durationMs === 'number' && data.durationMs >= 0
    ? ` · Response time: ${data.durationMs < 1000 ? `${data.durationMs} milliseconds` : `${(data.durationMs / 1000).toFixed(2)} seconds`}` : '';
  return `${verb} ${area}. ${outcome}${elapsed}.`;
}
