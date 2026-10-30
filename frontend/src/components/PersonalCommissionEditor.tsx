import React, { useId } from 'react';
import { Camera, Check } from 'lucide-react';
import { commissionRoles, CommissionSelection } from '../utils/commissionEditor';
import { formatMoney } from '../utils/format';
import { billPersonalRates } from '../utils/personalRates';

export const PersonalCommissionSummary: React.FC<{ item: { personalRatesJson?: string | null; includesComplimentaryMedia: boolean }; currencySymbol: string }> = ({ item, currencySymbol }) => {
  const payments = Object.entries(JSON.parse(billPersonalRates(item)) as Record<string, number>);
  if (item.includesComplimentaryMedia) payments.push(['automaticPhoto', 4.5]);
  return payments.length ? <div className="space-y-1">{payments.map(([role, amount]) => <div key={role} className="text-xs">
    <span className="font-semibold">{role === 'automaticPhoto' ? 'Added Photo employee' : commissionRoles.find(option => option.id === role)?.label}</span>
    <span className="text-slate-500"> · {formatMoney(amount, currencySymbol)} / unit</span>
  </div>)}</div> : <span className="text-xs text-slate-500">No employee payments</span>;
};

export const PersonalCommissionEditor: React.FC<{
  value: CommissionSelection[];
  onChange: (value: CommissionSelection[]) => void;
  combinedMedia: boolean;
  currencySymbol: string;
  showPreview?: boolean;
}> = ({ value, onChange, combinedMedia, currencySymbol, showPreview = true }) => {
  const id = useId();
  const visible = value.filter(row => !combinedMedia || !['photo', 'video'].includes(row.role));
  const payments: { label: string; amount: number }[] = visible.filter(row => row.enabled && row.amount.trim() !== '' && Number.isFinite(Number(row.amount)) && Number(row.amount) >= 0)
    .map(row => ({ label: commissionRoles.find(role => role.id === row.role)!.label, amount: Number(row.amount) }));
  if (combinedMedia) payments.push({ label: 'Photo line employee', amount: 4.5 });
  const incomplete = visible.some(row => row.enabled && (row.amount.trim() === '' || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0));
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const update = (role: CommissionSelection['role'], patch: Partial<CommissionSelection>) => onChange(value.map(row => row.role === role ? { ...row, ...patch } : row));
  return <fieldset className="commission-editor" aria-describedby={`${id}-help`}>
    <legend>Employee payments</legend>
    <p id={`${id}-help`} className="commission-intro">Choose which roles earn a fixed payment for each service unit. You’ll select the employees when creating a bill.</p>
    <div className="commission-role-list">
      {visible.map(row => {
        const role = commissionRoles.find(role => role.id === row.role)!;
        return <div key={row.role} className={`commission-role-row ${row.enabled ? 'is-enabled' : ''}`}>
          <label className="commission-role-choice" htmlFor={`${id}-${row.role}-enabled`}>
            <input id={`${id}-${row.role}-enabled`} type="checkbox" checked={row.enabled} onChange={event => update(row.role, { enabled: event.target.checked })} />
            <span><strong>{role.label}</strong><small>{role.description}</small></span>
          </label>
          {row.enabled ? <div className="commission-amount-control">
            <label htmlFor={`${id}-${row.role}-amount`}>Payment per unit</label>
            <div><span aria-hidden="true">{currencySymbol}</span><input id={`${id}-${row.role}-amount`} type="number" min="0" step="any" inputMode="decimal" required
              aria-label={`${role.label} payment per service unit`} value={row.amount} placeholder="0.00" onChange={event => update(row.role, { amount: event.target.value })} /></div>
          </div> : <span className="commission-off">No payment</span>}
        </div>;
      })}
    </div>
    {combinedMedia && <div className="commission-combined-note"><Camera size={19} aria-hidden="true" /><div><strong>Separate Photo added · $57.50 / unit <span>{formatMoney(4.5, currencySymbol)} / unit</span></strong>
      <p>Selecting this activity adds a Photo line at $57.50 per unit on top of the activity price. Select one team member on that line to receive $4.50 per unit.</p></div></div>}
    {showPreview && <div className="commission-preview" aria-live="polite" aria-atomic="true">
      <div className="commission-preview-heading"><Check size={16} aria-hidden="true" /><strong>Payment preview</strong><span>1 service unit</span></div>
      {payments.length > 0 && <dl>{payments.map(payment => <div key={payment.label}><dt>{payment.label}</dt><dd>{formatMoney(payment.amount, currencySymbol)}</dd></div>)}</dl>}
      {incomplete ? <p>Enter an amount for each checked role to complete the preview.</p> : payments.length ? <div className="commission-preview-total"><span>If every selected role is assigned</span><strong>{formatMoney(total, currencySymbol)}</strong></div> : <p>No employee payments configured. Select a role above to add one.</p>}
      <p className="commission-preview-help">Only assigned employees earn these payments. Pool percentages are calculated separately.</p>
    </div>}
  </fieldset>;
};
