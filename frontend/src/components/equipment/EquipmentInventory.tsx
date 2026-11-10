import { useState } from 'react';
import { useUnsavedChanges } from '../../context/NavigationContext';
import { apiFetch } from '../../services/api';
import { Modal } from '../Modal';
import { TableScroll } from '../TableScroll';
import { EquipmentStock, EquipmentCondition, money, statusText } from './types';
export function EquipmentInventory({ stocks, propertyId, currency, manager, onSaved }: { stocks: EquipmentStock[]; propertyId: string; currency: string; manager: boolean; onSaved: () => void }) {
  const [search, setSearch] = useState(''), [editing, setEditing] = useState<EquipmentStock | 'new' | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useUnsavedChanges(editing !== null, 'Equipment inventory changes have not been saved.', busy);
  const rows = stocks.filter(s => `${s.code} ${s.name} ${s.category} ${s.size} ${s.serialNumber || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="surface rental-panel"><div className="rental-toolbar"><h2>Equipment inventory</h2><label className="rental-search">Search equipment<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, ID, serial or size" /></label>{manager && <button className="primary-button" onClick={() => { setError(''); setEditing('new'); }}>Add equipment</button>}</div>
    <TableScroll label="Equipment inventory"><table className="data-table"><thead><tr><th>Equipment</th><th>Size / serial</th><th>Condition</th><th>Available</th><th>Assigned</th><th>Damaged</th><th className="rental-number">Rental price</th>{manager && <th>Manage</th>}</tr></thead><tbody>{rows.map(s => <tr key={s.id}><td><strong>{s.name}</strong><small>{s.code} · {s.category}{!s.isActive && ' · Inactive'}</small></td><td>{s.size}<small>{s.serialNumber || 'Bulk stock'}</small></td><td>{statusText(s.condition)}</td><td>{s.availableQuantity} / {s.quantity}</td><td>{s.assignedQuantity}</td><td>{s.damagedQuantity}</td><td className="rental-number">{money(s.priceCents, currency)}</td>{manager && <td><button className="secondary-button" disabled={s.assignedQuantity > 0} onClick={() => { setError(''); setEditing(s); }}>Edit</button></td>}</tr>)}</tbody></table></TableScroll>
    {!rows.length && <p className="empty-state">{stocks.length ? 'No matching equipment.' : 'Add physical equipment to start assigning rentals.'}</p>}
    {editing && <Modal label={editing === 'new' ? 'Add equipment' : 'Edit equipment'} busy={busy} onClose={() => setEditing(null)} error={error}><form className="rental-stock-form" onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('');
      const price = Number(form.get('price'));
      if (!Number.isFinite(price) || Math.abs(price * 100 - Math.round(price * 100)) > 0.00001) { setError('Enter a price with up to two decimal places.'); setBusy(false); return; }
      try { await apiFetch(`/equipment/inventory${editing === 'new' ? '' : `/${editing.id}`}`, { method: editing === 'new' ? 'POST' : 'PUT', body: JSON.stringify({ propertyId, code: form.get('code'), name: form.get('name'), category: form.get('category'), size: form.get('size'), serialNumber: String(form.get('serialNumber') || '') || null, quantity: Number(form.get('quantity')), priceCents: Math.round(price * 100), condition: form.get('condition') as EquipmentCondition, isActive: form.get('active') === 'on' }) }); setEditing(null); onSaved(); }
      catch (err) { setError(err instanceof Error ? err.message : 'Unable to save equipment.'); } finally { setBusy(false); }
    }}><h2>{editing === 'new' ? 'Add equipment' : 'Edit equipment'}</h2><p>Use one entry per serial number, or an equipment ID for bulk stock.</p><fieldset disabled={busy} className="rental-form-grid">
      <label>Equipment ID *<input name="code" required maxLength={80} defaultValue={editing === 'new' ? '' : editing.code} /></label>
      <label>Name *<input name="name" required maxLength={200} defaultValue={editing === 'new' ? '' : editing.name} /></label>
      <label>Category *<input name="category" required maxLength={100} defaultValue={editing === 'new' ? '' : editing.category} placeholder="e.g. Fins" /></label>
      <label>Size *<select name="size" defaultValue={editing === 'new' ? 'M' : editing.size}>{['XS','S','M','L','XL','XXL'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>Serial number<input name="serialNumber" maxLength={100} defaultValue={editing === 'new' ? '' : editing.serialNumber || ''} /></label>
      <label>Quantity *<input name="quantity" type="number" min={1} max={10000} step={1} required defaultValue={editing === 'new' ? 1 : editing.quantity} /></label>
      <label>Condition *<select name="condition" defaultValue={editing === 'new' ? 'GOOD' : editing.condition}>{['NEW','GOOD','FAIR','DAMAGED'].map(s => <option key={s} value={s}>{statusText(s)}</option>)}</select></label>
      <label>Rental price / item ({currency}) *<input name="price" type="number" min={0} max={100000} step="0.01" required defaultValue={editing === 'new' ? 0 : editing.priceCents / 100} /></label>
      <label className="rental-checkbox"><input type="checkbox" name="active" defaultChecked={editing === 'new' || editing.isActive} />Available for rental</label>
    </fieldset>{editing !== 'new' && editing.damagedQuantity > 0 && <p className="notice">Saving a serviceable condition releases quarantined units. Verify repairs first.</p>}<div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save equipment'}</button></div></form></Modal>}
  </section>;
}
