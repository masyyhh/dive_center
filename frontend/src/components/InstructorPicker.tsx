import React, { useId, useState } from 'react';
import type { StaffMember } from '../types';
import { formatMoney } from '../utils/format';

export const InstructorPicker: React.FC<{
  role?: 'instructor' | 'photo';
  staff: StaffMember[]; selectedIds: string[]; disabled: boolean; onChange: (ids: string[]) => void;
  unitRate: number; quantity: number; discountPercent: number; currencySymbol: string;
}> = ({ role = 'instructor', staff, selectedIds, disabled, onChange, unitRate, quantity, discountPercent, currencySymbol }) => {
  const photo = role === 'photo';
  const [search, setSearch] = useState('');
  const helpId = useId();
  const visible = staff.filter(person => `${person.name} ${person.roleTitle}`.toLowerCase().includes(search.trim().toLowerCase()));
  const each = unitRate * quantity * (1 - discountPercent / 100);
  return <fieldset disabled={disabled} aria-describedby={helpId} className="staff-credit-picker space-y-2 min-w-0">
    <legend className="text-xs font-medium text-slate-500">{photo ? 'Photo staff' : 'Instructors'} · select one or more</legend>
    <p id={helpId} className="text-xs text-slate-500">Each {photo ? 'selected Photo staff member' : 'instructor'} receives {formatMoney(unitRate, currencySymbol)} per unit. For this line after discounts: <strong>{formatMoney(each, currencySymbol)} each</strong>.</p>
    {staff.length > 8 && <label className="block text-xs">Find {photo ? 'Photo staff' : 'an instructor'}<input type="search" value={search} onChange={event => setSearch(event.target.value)} className="w-full" /></label>}
    <div className="max-h-40 overflow-y-auto rounded-lg border border-purple-200 dark:border-purple-900 p-2 space-y-1">
      {visible.map(person => <label key={person.id} className="staff-credit-option flex items-center gap-2 text-xs">
        <input type="checkbox" checked={selectedIds.includes(person.id)} onChange={event => onChange(event.target.checked ? [...new Set([...selectedIds, person.id])] : selectedIds.filter(id => id !== person.id))} />
        <span>{person.name} <span className="text-slate-500">({person.roleTitle})</span></span>
      </label>)}
      {!visible.length && <p className="text-xs text-slate-500">{staff.length ? photo ? 'No matching Photo staff.' : 'No matching instructors.' : 'No eligible staff available.'}</p>}
    </div>
    <p className="text-xs text-slate-500" role="status">{selectedIds.length} selected · {photo ? 'Photo' : 'Instructor'} commission total: {formatMoney(each * selectedIds.length, currencySymbol)}</p>
  </fieldset>;
};
