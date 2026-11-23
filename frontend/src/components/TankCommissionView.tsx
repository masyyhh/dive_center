import { TripResourcesSection } from './admin/TripResourcesSection';
import '../styles/trip-resources.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Anchor, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useProperty } from '../context/PropertyContext';
import { useNavigation } from '../context/NavigationContext';
import { apiFetch } from '../services/api';
import { businessToday, displayDate } from '../utils/dates';
import type { TankSession, TankSetup } from '../types/tank';
import { TableScroll } from './TableScroll';
import { SessionDialog } from './tank/SessionDialog';

export function TankCommissionView() {
  const { activeProperty } = useProperty();
  const { user } = useAuth();
  const { requestNavigation } = useNavigation();
  const [month, setMonth] = useState(businessToday().slice(0, 7));
  const [setup, setSetup] = useState<TankSetup | null>(null);
  const [sessions, setSessions] = useState<TankSession[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sessionEditor, setSessionEditor] = useState<{ session: TankSession | null } | null>(null);
  const requestNumber = useRef(0);
  const propertyId = activeProperty?.id;
  const canManage = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';

  const reload = useCallback(
    async (selectedMonth = month) => {
      if (!propertyId) return;
      const ticket = ++requestNumber.current;
      setLoading(true);
      setError('');
      setSessions([]);
      setNextCursor(null);
      setIsLocked(true);
      try {
        const [data, register] = await Promise.all([
          apiFetch<TankSetup>(`/tank-commission/setup?${new URLSearchParams({ propertyId })}`),
          apiFetch<{ sessions: TankSession[]; nextCursor: string | null; isLocked: boolean }>(
            `/tank-commission/sessions?${new URLSearchParams({ propertyId, yearMonth: selectedMonth })}`,
          ),
        ]);
        if (ticket !== requestNumber.current) return;
        setSetup(data);
        setSessions(register.sessions);
        setNextCursor(register.nextCursor);
        setIsLocked(register.isLocked);
      } catch (error) {
        if (ticket === requestNumber.current)
          setError(error instanceof Error ? error.message : 'Could not load the register.');
      } finally {
        if (ticket === requestNumber.current) setLoading(false);
      }
    },
    [propertyId, month],
  );
  useEffect(() => {
    void reload();
    const counter = requestNumber;
    return () => {
      counter.current++;
    };
  }, [reload]);
  if (!activeProperty)
    return (
      <div className="empty-state">
        <h1>Choose a property</h1>
        <p>Select a property to record trips and tank usage.</p>
      </div>
    );
  return (
    <div className="space-y-5">
      <div className="page-heading flex flex-wrap justify-between gap-3 items-center">
        <div>
          <span className="eyebrow flex items-center gap-2">
            <Anchor size={16} />
            OPERATIONS
          </span>
          <h1>Trips & Tanks</h1>
          <p className="text-sm text-slate-500">
            {activeProperty.name} · Log trips, tank usage and crew assignments.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={loading || busy}
          onClick={() => {
            void reload();
          }}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      {error && (
        <div role="alert" className="notice notice-error">
          {error}
          <button
            className="text-button"
            disabled={busy || loading}
            onClick={() => {
              void reload();
            }}
          >
            Try again
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="notice notice-success">
          {notice}
        </p>
      )}

            {canManage && <details className="surface p-5"><summary>Manage boats &amp; dive sites</summary>
        <TripResourcesSection propertyId={activeProperty.id} onChanged={() => void reload()} />
      </details>}
      {loading && <p role="status">Loading trips…</p>}
      {setup && (
        <div className="surface p-5 space-y-4">
          <div className="flex flex-wrap gap-3 justify-between items-end">
            <label>
              Month
              <input
                className="block"
                type="month"
                value={month}
                onChange={(e) => {
                  if (e.target.value)
                    requestNavigation(() => {
                      requestNumber.current++;
                      setBusy(false);
                      setMonth(e.target.value);
                    });
                }}
              />
            </label>
            <button
              className="primary-button"
              disabled={busy || loading || isLocked}
              onClick={() => setSessionEditor({ session: null })}
            >
              <Plus size={16} />
              Add New Trip
            </button>
          </div>
          {isLocked && (
            <p className="notice notice-info">
              This month is locked for payroll. Records and payments are read-only.
            </p>
          )}
          <p className="text-sm text-slate-500">
            Choose a month to review departures, dive sites, tank usage and assigned crew.
          </p>
          <TableScroll label="Trips & Tanks" className="trip-register-scroll">
            <table className="data-table trip-register-table">
              <thead>
                <tr>
                  <th>Date & departure</th>
                  <th>Dhoni</th>
                  <th>Dive sites</th>
                  <th className="trip-number">Tanks</th>
                  <th className="trip-number">Pax</th>
                  <th className="trip-number">Gear Wash</th>
                  <th className="trip-number">Crew</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Trip actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...sessions]
                  .sort(
                    (a, b) =>
                      b.businessDate.localeCompare(a.businessDate) ||
                      (b.departureTime ?? '').localeCompare(a.departureTime ?? ''),
                  )
                  .map((session) => (
                    <tr key={session.id}>
                      <td>
                        <strong>{displayDate(session.businessDate)}</strong>
                        <div className="trip-secondary">
                          {session.departureTime ?? 'Time not recorded'}
                        </div>
                      </td>
                      <td>
                        <strong>{session.boatName ?? 'House reef'}</strong>
                        <div className="trip-secondary">{session.activityType}</div>
                      </td>
                      <td>
                        <div className="trip-site-list">
                          {session.diveSites.length ? (
                            session.diveSites.map((site, index) => (
                              <span key={`${site.id}-${index}`}>
                                <span className="trip-secondary">{index + 1}.</span> {site.name}
                              </span>
                            ))
                          ) : (
                            <span className="trip-secondary">No sites recorded</span>
                          )}
                        </div>
                      </td>
                      <td className="trip-number">
                        <strong>{session.tanks}</strong>
                      </td>
                      <td className="trip-number">{session.passengers}</td>
                      <td className="trip-number">{session.gearWash}</td>
                      <td className="trip-number">{session.participants.length}</td>
                      <td>
                        <span className={`trip-status trip-status-${session.status.toLowerCase()}`}>
                          {{ APPROVED: 'Saved', DRAFT: 'Draft', VOID: 'Void' }[session.status]}
                        </span>
                      </td>
                      <td>
                        <button
                          className="secondary-button"
                          disabled={loading || busy}
                          onClick={() => setSessionEditor({ session })}
                        >
                          Open trip
                        </button>
                      </td>
                    </tr>
                  ))}
                {!sessions.length && !loading && (
                  <tr>
                    <td className="trip-register-empty" colSpan={9}>
                      No trips recorded for this month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
          {nextCursor && (
            <button
              className="secondary-button"
              disabled={busy || loading}
              onClick={async () => {
                const ticket = requestNumber.current;
                setBusy(true);
                setError('');
                try {
                  const page = await apiFetch<{
                    sessions: TankSession[];
                    nextCursor: string | null;
                    isLocked: boolean;
                  }>(
                    `/tank-commission/sessions?${new URLSearchParams({ propertyId: activeProperty.id, yearMonth: month, cursor: nextCursor })}`,
                  );
                  if (ticket !== requestNumber.current) return;
                  setSessions((previous) => [
                    ...previous,
                    ...page.sessions.filter((row) => !previous.some((old) => old.id === row.id)),
                  ]);
                  setNextCursor(page.nextCursor);
                  setIsLocked(page.isLocked);
                } catch (error) {
                  if (ticket === requestNumber.current)
                    setError(
                      error instanceof Error ? error.message : 'Could not load more sessions.',
                    );
                } finally {
                  if (ticket === requestNumber.current) setBusy(false);
                }
              }}
            >
              Load more sessions
            </button>
          )}
        </div>
      )}
      {sessionEditor && setup && user && (
        <SessionDialog
          key={
            sessionEditor.session
              ? `${sessionEditor.session.id}-${sessionEditor.session.version}`
              : 'new-session'
          }
          propertyId={activeProperty.id}
          session={sessionEditor.session}
          setup={setup}
          userId={user.id}
          canManage={canManage}
          isLocked={isLocked}
          currencySymbol={activeProperty.currencySymbol}
          onSaved={async (session) => {
            setMonth(session.businessDate.slice(0, 7));
            await reload(session.businessDate.slice(0, 7));
            setSessionEditor({ session });
            setNotice(
              session.status === 'APPROVED'
                ? 'Trip log saved. Commission calculated and included in payroll.'
                : 'Trip log saved as a draft.',
            );
          }}
          onClose={() => setSessionEditor(null)}
        />
      )}
    </div>
  );
}
