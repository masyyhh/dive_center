import React from 'react';
import { Item, Property } from '../types';
import { PersonalCommissionSummary } from './PersonalCommissionEditor';
import { formatMoney, formatUnitPrice } from '../utils/format';

export const CommissionRulesView: React.FC<{
  property: Property | null;
  items: Item[];
  loading: boolean;
  busy: boolean;
  onEdit: (item: Item) => void;
  onCopy: (item: Item) => void;
  onStaff: () => void;
}> = ({ property, items, loading, busy, onEdit, onCopy, onStaff }) => {
  const [search, setSearch] = React.useState('');
  const active = items.filter(item => item.isActive && item.propertyId === property?.id);
  const visible = active.filter(item => `${item.code} ${item.name} ${item.category?.name || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="surface p-5 space-y-4">
    <h2 className="text-lg font-bold">Commission rules · {property?.name || 'Choose a property'}</h2>
    <p>Customize each activity’s pool contribution and fixed employee payments for this property. Changes apply to new bills; saved bills retain their commission settings.</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" className="secondary-button" disabled={!property || loading || busy} onClick={onStaff}>Configure staff pool sharing</button>
      <span className="text-sm text-slate-500">Course and dive pools use percentages. Certifications and employee payments use fixed amounts per unit. Personal employee commissions are then reduced by the discount on their bill line.</span>
    </div>
    <p className="text-sm text-slate-500">The base-leader override adds 10% of course and dive pools. Set eligibility under Staff &amp; Pools. For an activity already used on bills, choose New activity with these rules to set a different pool rule.</p>
    <label className="block">Search commission rules<input className="w-full" type="search" value={search} placeholder="Name, code or category" onChange={event => setSearch(event.target.value)} /></label>
    {loading ? <p role="status">Loading commission rules…</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr><th className="p-3">Activity</th><th className="p-3">Pool contribution</th><th className="p-3">Employee payments</th><th className="p-3">Actions</th></tr></thead>
      <tbody>{visible.map(item => <tr key={item.id} className="border-t border-slate-200 dark:border-slate-800">
        <td className="p-3"><strong>{item.name}</strong><div>{item.code} · {item.category?.name}</div></td>
        <td className="p-3">{item.poolType === 'NONE' ? 'No pool' : `${{ COURSE_POOL: 'Course pool', DIVE_POOL: 'Dive pool', CERTIFICATION_POOL: 'Certifications' }[item.poolType]} · ${item.poolType === 'CERTIFICATION_POOL' ? formatMoney(item.poolContribution, property?.currencySymbol || '$') + ' / unit' : item.poolContribution + '%'}`}</td>
        <td className="p-3"><PersonalCommissionSummary autoPhotoCommission={property?.autoPhotoCommission} item={item} currencySymbol={property?.currencySymbol || '$'} />{item.includesComplimentaryMedia && <p>Automatic Photo: {formatUnitPrice(property?.autoPhotoPrice ?? 41.975, property?.currencySymbol || '$')} charge · {formatMoney(property?.autoPhotoCommission ?? 4.5, property?.currencySymbol || '$')} employee payment per unit</p>}</td>
        <td className="p-3"><div className="flex flex-wrap gap-2"><button type="button" className="secondary-button" disabled={busy} onClick={() => onEdit(item)} aria-label={`Edit commission rules for ${item.name}`}>Edit rules</button><button type="button" className="secondary-button" disabled={busy} onClick={() => onCopy(item)} aria-label={`Create new activity from ${item.name}`}>New activity with these rules</button></div></td>
      </tr>)}{!visible.length && <tr><td className="p-6 text-center" colSpan={4}>{!property ? 'Choose a property to customize commission rules.' : active.length ? 'No activities match your search.' : 'Add activities in Catalogue to configure commission rules.'}</td></tr>}</tbody>
    </table></div>}
  </div>;
};
