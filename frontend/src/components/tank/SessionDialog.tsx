import { useMonthLock } from '../../hooks/useMonthLock';
import { useState } from 'react';
import { Modal } from '../Modal';
import { useNavigation, useUnsavedChanges } from '../../context/NavigationContext';
import { apiFetch } from '../../services/api';
import { businessToday, isBusinessDate } from '../../utils/dates';
import { formatMoney } from '../../utils/format';
import type { TankPreview, TankSession, TankSetup } from '../../types/tank';

export function SessionDialog({
  propertyId,
  session,
  setup,
  canManage,
  userId,
  isLocked,
  currencySymbol,
  onSaved,
  onClose,
}: {
  propertyId: string;
  session: TankSession | null;
  setup: TankSetup;
  canManage: boolean;
  canChangeRules?: boolean;
  userId: string;
  isLocked: boolean;
  currencySymbol: string;
  onSaved: (session: TankSession) => Promise<void>;
  onClose: () => void;
}) {
  const defaultParticipants = ['Captain', 'Crew', 'Compressor Attendant'].map((role) => ({
    staffId: '',
    role,
  }));
  const [initial] = useState(() =>
    session
      ? {
          requestId: session.requestId,
          businessDate: session.businessDate,
          departureTime: session.departureTime,
          activityType: session.activityType,
          boatId: session.boatId,
          siteIds: session.diveSites.map((site) => site.id),
          tanks: session.tanks,
          passengers: session.passengers,
          dives: session.dives,
          gearWash: session.gearWash,
          isComplimentary: session.isComplimentary,
          isTraining: session.isTraining,
          manualTotalCents: session.manualTotalCents,
          participants: session.participants,
          ruleId: session.ruleId,
          override: session.override,
          overrideReason: session.overrideReason,
          notes: session.notes,
        }
      : {
          requestId: crypto.randomUUID(),
          businessDate: businessToday(),
          departureTime: null as string | null,
          activityType: 'Boat dive',
          boatId: null as string | null,
          siteIds: [] as string[],
          tanks: 0,
          passengers: 0,
          dives: 0,
          gearWash: 0,
          isComplimentary: false,
          isTraining: false,
          manualTotalCents: null as number | null,
          participants: defaultParticipants,
          ruleId: null as string | null,
          override: null as TankSession['override'],
          overrideReason: null as string | null,
          notes: null as string | null,
        },
  );
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = session?.snapshot ?? null;
  const [reason, setReason] = useState('');
  const { requestNavigation } = useNavigation();
  const formDirty = JSON.stringify(form) !== JSON.stringify(initial);
  const dirty = formDirty || reason.length > 0;
  const clearGuard = useUnsavedChanges(
    dirty,
    'You have an unsaved trip or house-reef session.',
    busy,
  );
  const close = () => requestNavigation(onClose);
  const targetMonth = useMonthLock(propertyId, form.businessDate.slice(0, 7));
  const tripLocked = (Boolean(session) && isLocked) || targetMonth.locked === true;
  const correcting = session?.status === 'APPROVED';
  const editable =
    (!session ||
      (session.status !== 'VOID' &&
        (canManage || (session.status === 'DRAFT' && session.createdById === userId)))) &&
    !(session && isLocked);
  const siteChoices = setup.resources.filter(
    (row) => row.kind === 'SITE' && (row.isActive || form.siteIds.includes(row.id)),
  );
  const crewRoles = ['Captain', 'Crew', 'Compressor Attendant'];
  const updateTripDetails = (changes: Partial<typeof form>) => setForm({ ...form, ...changes });
  const money = (cents: number) => formatMoney(cents / 100, currencySymbol);
  const eligibleStaff = setup.staff.filter(
    (staff) =>
      staff.hireDate <= form.businessDate &&
      (!staff.leavingDate || staff.leavingDate >= form.businessDate),
  );
  const action = async (name: 'void') => {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiFetch<{ session?: TankSession; preview?: TankPreview }>(
        `/tank-commission/sessions/${session.id}/${name}`,
        {
          method: 'POST',
          body: JSON.stringify({ propertyId, version: session.version, reason }),
        },
      );
      if (result.session) {
        clearGuard();
        await onSaved(result.session);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not complete the request.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal label="Trip log" onClose={close} busy={busy} error={error}>
      <div className="surface p-5 space-y-4">
        <div className="flex justify-between gap-3">
          <h2 className="text-xl font-bold">
            {session
              ? `${session.activityType} · ${session.status === 'APPROVED' ? 'saved' : session.status.toLowerCase()}`
              : 'Add New Trip'}
          </h2>
          <button className="secondary-button" onClick={close} disabled={busy}>
            Close
          </button>
        </div>
        {tripLocked && (
          <p role="status" className="notice notice-info">
            This payroll month is locked. Trip records and saved payments are read-only.
          </p>
        )}
        {targetMonth.locked === null && (
          <p role="status">Checking payroll status for the trip date…</p>
        )}
        {targetMonth.error && (
          <p role="alert">
            {targetMonth.error}{' '}
            <button type="button" onClick={targetMonth.retry}>
              Retry payroll check
            </button>
          </p>
        )}
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            if (targetMonth.locked !== false) {
              setError('Choose a trip date in an open payroll month.');
              return;
            }
            if (!editable) {
              setError('This trip is read-only.');
              return;
            }
            if (correcting && reason.trim().length < 3) {
              setError('Enter a correction reason to recalculate this trip.');
              return;
            }
            if (
              !isBusinessDate(form.businessDate) ||
              !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.departureTime ?? '')
            ) {
              setError('Confirm a valid date and departure time.');
              return;
            }
            if (
              [form.tanks, form.passengers, form.gearWash, form.dives].some(
                (value) => !Number.isInteger(value) || value < 0 || value > 100000,
              )
            ) {
              setError('Trip totals must be whole numbers between 0 and 100,000.');
              return;
            }
            if (
              !form.participants.length ||
              form.participants.some((person) => !person.staffId || !person.role)
            ) {
              setError('Select an employee and role for every crew row.');
              return;
            }
            if (
              new Set(form.participants.map((person) => person.staffId)).size !==
              form.participants.length
            ) {
              setError('Select each employee only once.');
              return;
            }
            setBusy(true);
            try {
              const result = await apiFetch<{ session: TankSession }>(
                `/tank-commission/sessions${session ? `/${session.id}` : ''}`,
                {
                  method: session ? 'PUT' : 'POST',
                  body: JSON.stringify({
                    propertyId,
                    ...form,
                    ruleId: null,
                    manualTotalCents: null,
                    override: null,
                    overrideReason: null,
                    siteIds: form.siteIds.filter(Boolean),
                    ...(session ? { version: session.version } : {}),
                    ...(correcting ? { correctionReason: reason.trim() } : {}),
                  }),
                },
              );
              clearGuard();
              await onSaved(result.session);
              onClose();
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not save session.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy || !editable} className="space-y-4">
            <h3 className="font-bold">1. Date & departure</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Date
                <input
                  className="w-full"
                  type="date"
                  required
                  value={form.businessDate}
                  onChange={(e) => updateTripDetails({ businessDate: e.target.value })}
                />
              </label>
              <label>
                Departure Time
                <input
                  className="w-full"
                  type="time"
                  required
                  value={form.departureTime ?? ''}
                  onChange={(e) => setForm({ ...form, departureTime: e.target.value || null })}
                />
              </label>
            </div>
            <h3 className="font-bold">2. Trip details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Dhoni Name
                <select
                  className="w-full"
                  value={form.boatId ?? ''}
                  onChange={(e) => updateTripDetails({ boatId: e.target.value || null })}
                >
                  <option value="">No dhoni / house reef</option>
                  {setup.resources
                    .filter(
                      (row) => row.kind === 'BOAT' && (row.isActive || row.id === form.boatId),
                    )
                    .map((boat) => (
                      <option value={boat.id} key={boat.id}>
                        {boat.name}
                        {!boat.isActive ? ' (inactive)' : ''}
                      </option>
                    ))}
                </select>
              </label>

              {[0, 1].map((index) => (
                <label key={index}>
                  Dive Site {index + 1}
                  <select
                    className="w-full"
                    value={form.siteIds[index] ?? ''}
                    onChange={(e) => {
                      const siteIds = [...form.siteIds];
                      siteIds[index] = e.target.value;
                      setForm({ ...form, siteIds });
                    }}
                  >
                    <option value="">Select dive site{index === 1 ? ' (optional)' : ''}</option>
                    {siteChoices.map((site) => (
                      <option
                        key={site.id}
                        value={site.id}
                        disabled={form.siteIds.some((id, i) => i !== index && id === site.id)}
                      >
                        {site.name}
                        {!site.isActive ? ' (inactive)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {form.siteIds.slice(2).map((siteId, index) => (
                <label key={index}>
                  Additional saved site {index + 3}
                  <select
                    className="w-full"
                    value={siteId}
                    onChange={(e) => {
                      const siteIds = [...form.siteIds];
                      siteIds[index + 2] = e.target.value;
                      setForm({ ...form, siteIds });
                    }}
                  >
                    <option value="">No site</option>
                    {siteChoices.map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!siteChoices.length && (
              <p className="text-sm text-slate-500">
                Add dive sites in Administration → Boats & sites to make them available here.
              </p>
            )}
            <h3 className="font-bold">3. Trip totals</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['passengers', 'tanks', 'gearWash'] as const).map((key) => (
                <label key={key}>
                  {{ tanks: 'Tanks', passengers: 'Pax', gearWash: 'Gear Wash' }[key]}
                  <input
                    className="w-full"
                    type="number"
                    min="0"
                    max="100000"
                    step="1"
                    required
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
            <p className="notice notice-info">
              Total commission equals Tanks and is shared equally among the assigned staff. Pax and
              Gear Wash are recorded for operations only.
            </p>
            <h3 className="font-bold">4. Assign crew</h3>
            {form.participants.map((person, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-2">
                <label>
                  Employee
                  <select
                    className="w-full"
                    required
                    value={person.staffId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        participants: form.participants.map((row, i) =>
                          i === index ? { ...row, staffId: e.target.value } : row,
                        ),
                      })
                    }
                  >
                    <option value="">Select employee</option>
                    {eligibleStaff.map((staff) => (
                      <option
                        value={staff.id}
                        key={staff.id}
                        disabled={form.participants.some(
                          (row, i) => i !== index && row.staffId === staff.id,
                        )}
                      >
                        {staff.name}
                        {staff.erNumber ? ` · ${staff.erNumber}` : ''}
                      </option>
                    ))}
                    {person.staffId &&
                      !eligibleStaff.some((staff) => staff.id === person.staffId) && (
                        <option value={person.staffId}>
                          Previously selected employee (review eligibility)
                        </option>
                      )}
                  </select>
                </label>
                <label>
                  Role
                  <select
                    className="w-full"
                    required
                    value={person.role}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        participants: form.participants.map((row, i) =>
                          i === index ? { ...row, role: e.target.value } : row,
                        ),
                      })
                    }
                  >
                    <option value="">Select role</option>
                    {[...new Set([...crewRoles, person.role].filter(Boolean))].map((role) => (
                      <option value={role} key={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="text-button justify-self-start"
                  onClick={() =>
                    setForm({
                      ...form,
                      participants: form.participants.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove crew member
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary-button"
              disabled={form.participants.length >= 50}
              onClick={() =>
                setForm({
                  ...form,
                  participants: [
                    ...form.participants,
                    {
                      staffId: '',
                      role: crewRoles.find((role) => /crew/i.test(role)) ?? crewRoles[0] ?? 'Crew',
                    },
                  ],
                })
              }
            >
              + Add Crew
            </button>
            <label className="block">
              Notes
              <textarea
                className="w-full"
                maxLength={2000}
                value={form.notes ?? ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value || null })}
              />
            </label>
            {correcting && editable && (
              <div className="space-y-2">
                <label className="block">
                  Correction reason
                  <input
                    className="w-full"
                    required
                    minLength={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <p className="field-help">
                  Saving recalculates the tank pool and shares it equally among the assigned staff.
                  Previous trip details and payments remain in correction history.
                </p>
              </div>
            )}
            {editable && (
              <button className="primary-button" disabled={busy || targetMonth.locked !== false}>
                {busy ? 'Saving…' : correcting ? 'Save changes & recalculate' : 'Save Trip'}
              </button>
            )}
          </fieldset>
        </form>

        {preview && !formDirty && (
          <div className="space-y-3 border-t pt-4">
            <h3 className="font-bold">
              {preview.ruleName} · Total trip pool {money(preview.totalCents)}
            </h3>
            <p>
              {preview.calculationMode === 'TANK_EQUAL'
                ? `${session?.tanks ?? 0} tanks · ${preview.allocations.length} staff · equal shares`
                : 'Previously recorded calculation. Editing this trip applies the tank pool shared equally among assigned staff.'}
            </p>
            <ul className="space-y-2">
              {preview.allocations.map((row) => (
                <li className="flex justify-between gap-3" key={row.staffId}>
                  <span>
                    {row.staffName} · {row.role}
                  </span>
                  <strong>Com/per: {money(row.amountCents)}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}

        {canManage &&
          session &&
          session.status !== 'VOID' &&
          !tripLocked &&
          targetMonth.locked === false && (
            <div className="space-y-3 border-t pt-4">
              {!correcting && (
                <label className="block">
                  Correction reason
                  <input
                    className="w-full"
                    minLength={3}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              <p className="text-sm text-slate-500">
                Voiding a trip removes its payments from unlocked payroll. Previous trip details and
                payments remain in audit history.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="secondary-button"
                  disabled={busy || formDirty || reason.trim().length < 3}
                  onClick={() => {
                    void action('void');
                  }}
                >
                  Void session
                </button>
              </div>
            </div>
          )}
      </div>
    </Modal>
  );
}
