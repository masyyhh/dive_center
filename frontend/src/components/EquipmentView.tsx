import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useProperty } from '../context/PropertyContext';
import { useNavigation, useUnsavedChanges } from '../context/NavigationContext';
import { apiFetch } from '../services/api';
import { businessToday } from '../utils/dates';
import { TableScroll } from './TableScroll';
import { AssignmentForm } from './equipment/AssignmentForm';
import { EquipmentInventory } from './equipment/EquipmentInventory';
import { RentalDetail } from './equipment/RentalDetail';
import { EquipmentStock, Rental, money, statusText } from './equipment/types';
export function EquipmentView() {
  const { activeProperty } = useProperty(), { user } = useAuth(), { requestNavigation } = useNavigation();
  const [tab, setTab] = useState<'rentals' | 'inventory'>('rentals'), [assigning, setAssigning] = useState(false);
  const [editingDraft, setEditingDraft] = useState<Rental | null>(null);
  const [stocks, setStocks] = useState<EquipmentStock[]>([]), [staff, setStaff] = useState<{ id: string; name: string }[]>([]), [rentals, setRentals] = useState<Rental[]>([]);
  const [selected, setSelected] = useState<Rental | null>(null), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [search, setSearch] = useState(''), [status, setStatus] = useState('');
  const requestVersion = useRef(0), mounted = useRef(true);
  useUnsavedChanges(false, 'An equipment update is being saved.', busy);
  const propertyId = activeProperty?.id || '', manager = user?.role === 'GLOBAL_ADMIN' || user?.role === 'PROPERTY_MANAGER';
  const load = useCallback(async () => {
    if (!propertyId) return; const version = ++requestVersion.current; setLoading(true); setError('');
    try { const q = `propertyId=${encodeURIComponent(propertyId)}`; const [inventory, people, records] = await Promise.all([apiFetch<EquipmentStock[]>(`/equipment/inventory?${q}`), apiFetch<{ staff: { id: string; name: string }[] }>(`/staff?${q}&activeOnDate=${businessToday()}`), apiFetch<{ rentals: Rental[]; nextCursor: string | null }>(`/equipment/rentals?${q}`)]);
      if (!mounted.current || version !== requestVersion.current) return;
      if (!Array.isArray(people.staff)) throw new Error('Unable to read the staff list. Refresh and try again.');
      setStocks(inventory); setStaff(people.staff); setRentals(records.rentals); setCursor(records.nextCursor);
    } catch (err) { if (mounted.current && version === requestVersion.current) setError(err instanceof Error ? err.message : 'Unable to load equipment.'); } finally { if (mounted.current && version === requestVersion.current) setLoading(false); }
  }, [propertyId]);
  useEffect(() => { mounted.current = true; setSelected(null); setAssigning(false); setNotice(''); void load(); return () => { mounted.current = false; requestVersion.current++; }; }, [load]);
  const refreshSelected = async () => {
    if (!selected) return; setBusy(true); setError(''); try { const rental = await apiFetch<Rental>(`/equipment/rentals/${selected.id}?propertyId=${encodeURIComponent(propertyId)}`); if (mounted.current) setSelected(rental); } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to refresh rental.'); } finally { if (mounted.current) setBusy(false); }
  };
  const action = async (name: string, body: Record<string, unknown> = {}) => {
    if (!selected || busy) return false; setBusy(true); setError(''); setNotice(''); try { const rental = await apiFetch<Rental>(`/equipment/rentals/${selected.id}/${name}`, { method: 'POST', body: JSON.stringify({ propertyId, version: selected.version, ...body }) }); if (mounted.current) { setSelected(rental); setNotice(name === 'return' ? 'Equipment return recorded.' : name === 'confirm' ? 'Equipment assigned.' : 'Rental closed.'); await load(); } return true;
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to update rental.'); return false; } finally { if (mounted.current) setBusy(false); }
  };
  if (!activeProperty) return <div className="empty-state">Select a property to manage equipment.</div>;
  const filtered = rentals.filter(r => (!status || r.displayStatus === status) && `${r.reference} ${r.guestSnapshot.fullName} ${r.guestSnapshot.roomNumber}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="equipment-module"><div className="rental-toolbar"><div className="rental-grow"><h1>Equipment rentals</h1><p>{activeProperty.name}</p></div>{!assigning && <button className="primary-button" disabled={loading || !!error} onClick={() => requestNavigation(() => { setEditingDraft(null); setAssigning(true); setSelected(null); setTab('rentals'); setNotice(''); })}>New assignment</button>}</div>
    <div className="rental-toolbar"><div className="rental-tabs" aria-label="Equipment sections">{(['rentals','inventory'] as const).map(t => <button key={t} className={tab === t ? 'active' : ''} aria-pressed={tab === t} disabled={busy} onClick={() => requestNavigation(() => { setTab(t); setAssigning(false); setSelected(null); })}>{t === 'rentals' ? 'Rentals' : 'Inventory'}</button>)}</div><button className="secondary-button" disabled={loading || busy || assigning} onClick={() => { void load(); }}>Refresh</button></div>
    {error && <div role="alert" className="notice notice-error">{error} <button className="text-button" disabled={loading || busy} onClick={() => { void load(); }}>Retry</button></div>}{notice && <p role="status" className="notice">{notice}</p>}
    {loading && !stocks.length && !rentals.length ? <p role="status" className="empty-state">Loading equipment and rentals…</p> : tab === 'inventory' ? <EquipmentInventory stocks={stocks} propertyId={propertyId} currency={activeProperty.currency} manager={manager} onSaved={() => { setNotice('Equipment saved.'); void load(); }} /> : assigning ? <AssignmentForm initialRental={editingDraft} stocks={stocks} staff={staff} propertyId={propertyId} currency={activeProperty.currency} onCancel={() => requestNavigation(() => setAssigning(false))} onSaved={rental => { setAssigning(false); setSelected(rental); setNotice('Draft saved. Create a signature link before assigning equipment.'); void load(); }} /> : selected ? <><button className="text-button" disabled={busy} onClick={() => requestNavigation(() => setSelected(null))}>← All rentals</button><RentalDetail key={selected.id} rental={selected} propertyId={propertyId} busy={busy} onAction={action} onEdit={() => { setEditingDraft(selected); setAssigning(true); setNotice('Saving changes uses current inventory prices and requires a new guest signature.'); }} onRefresh={() => { void refreshSelected(); }} onAdditional={() => requestNavigation(() => { setEditingDraft(null); setSelected(null); setAssigning(true); setNotice('Select the same guest to add another equipment assignment with a new agreement.'); })} /></> : <section className="surface rental-panel"><div className="rental-toolbar"><label className="rental-grow">Search loaded rentals<input type="search" placeholder="Reference, guest or room" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['DRAFT','ACTIVE','PARTIALLY_RETURNED','RETURNED','OVERDUE','CLOSED'].map(s => <option key={s} value={s}>{statusText(s)}</option>)}</select></label></div>
      <TableScroll label="Equipment rentals"><table className="data-table"><thead><tr><th>Reference / guest</th><th>Room</th><th>Return by</th><th>Status</th><th>Assigned staff</th><th className="rental-number">Amount</th><th>Manage</th></tr></thead><tbody>{filtered.map(r => <tr key={r.id}><td><strong>{r.reference}</strong><small>{r.guestSnapshot.fullName}</small></td><td>{r.guestSnapshot.roomNumber}</td><td>{r.expectedReturnDate}</td><td><span className={`rental-status status-${r.displayStatus.toLowerCase()}`}>{statusText(r.displayStatus)}</span></td><td>{r.assignedStaffName}</td><td className="rental-number">{money(r.totalCents, r.currency)}</td><td><button className="secondary-button" onClick={() => { setSelected(r); setNotice(''); }}>Open rental</button></td></tr>)}</tbody></table></TableScroll>
      {!filtered.length && <p className="empty-state">{rentals.length ? 'No matching loaded rentals.' : 'No equipment rentals yet. Create an assignment to get started.'}</p>}{cursor && <button className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const page = await apiFetch<{ rentals: Rental[]; nextCursor: string | null }>(`/equipment/rentals?propertyId=${encodeURIComponent(propertyId)}&cursor=${encodeURIComponent(cursor)}`); if (mounted.current) { setRentals(rows => [...rows, ...page.rentals.filter(r => !rows.some(old => old.id === r.id))]); setCursor(page.nextCursor); } } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Unable to load more rentals.'); } finally { if (mounted.current) setBusy(false); } }}>Load more rentals</button>}
    </section>}
  </div>;
}
